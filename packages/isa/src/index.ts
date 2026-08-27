import { type Result, ok, err } from '@myfactorio/kernel';

/**
 * The instruction vocabulary shared by rules-compiler (which emits) and sim (which decodes).
 *
 * It is a package rather than a subpath of the compiler for one concrete reason: as a subpath it
 * needed a bespoke lint rule to stop sim dragging the whole compiler into the worker bundle. As a
 * package there is no path at all. See ADR-0005.
 *
 * DISPOSABLE. No game element exists yet, so no encoding choice here can be justified against a
 * real requirement. There is no forward-compatibility promise on this encoding, and none is
 * needed, because bytecode is a compilation artefact recomputed on every pack load and is NEVER
 * written to disk. The `save-no-isa` rule keeps that true mechanically. See ADR-0006.
 */

export const OP = {
  HALT: 0,
  NOP: 1,
  LOAD_CONST: 2,
  CMP: 3,
} as const;

export type Opcode = (typeof OP)[keyof typeof OP];

export const OPCODE_NAMES: Readonly<Record<Opcode, string>> = {
  [OP.HALT]: 'HALT',
  [OP.NOP]: 'NOP',
  [OP.LOAD_CONST]: 'LOAD_CONST',
  [OP.CMP]: 'CMP',
};

/** opcode u8 | a u8 | b u16 little-endian. */
export const INSTRUCTION_BYTES = 4;
export const MAX_OPERAND_A = 0xff;
export const MAX_OPERAND_B = 0xffff;

export interface Instruction {
  readonly op: Opcode;
  readonly a: number;
  readonly b: number;
}

export type IsaErrorCode = 'unaligned-program' | 'unknown-opcode' | 'operand-out-of-range';

export interface IsaError {
  readonly code: IsaErrorCode;
  readonly message: string;
  readonly offset: number;
}

function isOpcode(value: number): value is Opcode {
  return value === OP.HALT || value === OP.NOP || value === OP.LOAD_CONST || value === OP.CMP;
}

export function encodeProgram(instructions: readonly Instruction[]): Result<Uint8Array, IsaError> {
  const bytes = new Uint8Array(instructions.length * INSTRUCTION_BYTES);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < instructions.length; i += 1) {
    const instruction = instructions[i]!;
    const offset = i * INSTRUCTION_BYTES;

    if (instruction.a < 0 || instruction.a > MAX_OPERAND_A) {
      return err({
        code: 'operand-out-of-range',
        message: `Operand a=${instruction.a} does not fit in a u8 at instruction ${i}.`,
        offset,
      });
    }
    if (instruction.b < 0 || instruction.b > MAX_OPERAND_B) {
      return err({
        code: 'operand-out-of-range',
        message: `Operand b=${instruction.b} does not fit in a u16 at instruction ${i}.`,
        offset,
      });
    }

    view.setUint8(offset, instruction.op);
    view.setUint8(offset + 1, instruction.a);
    view.setUint16(offset + 2, instruction.b, true);
  }

  return ok(bytes);
}

export function decodeProgram(bytes: Uint8Array): Result<readonly Instruction[], IsaError> {
  if (bytes.byteLength % INSTRUCTION_BYTES !== 0) {
    return err({
      code: 'unaligned-program',
      message: `Program length ${bytes.byteLength} is not a multiple of ${INSTRUCTION_BYTES}.`,
      offset: bytes.byteLength - (bytes.byteLength % INSTRUCTION_BYTES),
    });
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const instructions: Instruction[] = [];

  for (let offset = 0; offset < bytes.byteLength; offset += INSTRUCTION_BYTES) {
    const op = view.getUint8(offset);
    if (!isOpcode(op)) {
      return err({ code: 'unknown-opcode', message: `Unknown opcode ${op} at byte ${offset}.`, offset });
    }
    instructions.push({ op, a: view.getUint8(offset + 1), b: view.getUint16(offset + 2, true) });
  }

  return ok(instructions);
}
