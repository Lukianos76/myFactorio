import { describe, expect, it } from 'vitest';
import { INSTRUCTION_BYTES, OP, type Instruction, decodeProgram, encodeProgram } from './index.js';

describe('instruction encoding round-trips', () => {
  const program: readonly Instruction[] = [
    { op: OP.NOP, a: 0, b: 0 },
    { op: OP.LOAD_CONST, a: 3, b: 65535 },
    { op: OP.CMP, a: 255, b: 1 },
    { op: OP.HALT, a: 0, b: 0 },
  ];

  it('encodes to a fixed-width buffer and decodes back to the same instructions', () => {
    const encoded = encodeProgram(program);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    expect(encoded.value.byteLength).toBe(program.length * INSTRUCTION_BYTES);

    const decoded = decodeProgram(encoded.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value).toEqual(program);
  });

  it('rejects an operand that does not fit its field', () => {
    const result = encodeProgram([{ op: OP.LOAD_CONST, a: 256, b: 0 }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('operand-out-of-range');
  });

  it('rejects a misaligned program', () => {
    const result = decodeProgram(new Uint8Array([0, 0, 0]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unaligned-program');
  });

  it('rejects an unknown opcode instead of skipping it', () => {
    const result = decodeProgram(new Uint8Array([42, 0, 0, 0]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown-opcode');
    expect(result.error.offset).toBe(0);
  });
});
