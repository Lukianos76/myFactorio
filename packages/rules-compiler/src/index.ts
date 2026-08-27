import { type ContentId, type Result, ok, err, parseContentId } from '@myfactorio/kernel';
import { type Instruction, type IsaError, OP, encodeProgram } from '@myfactorio/isa';
import type { Rule } from '@myfactorio/rules-schema';

/**
 * Rules in, flat tables and bytecode out.
 *
 * The output is deliberately dumb: parallel typed arrays and a byte buffer, nothing that holds a
 * reference to a rule object. That is what lets the result cross into the worker as a shared
 * buffer later without any of this package following it.
 */
export interface CompiledRules {
  readonly ruleIds: readonly ContentId[];
  /** Every rule's constants, concatenated. */
  readonly constantPool: Int32Array;
  /** Length ruleIds.length + 1: rule i owns constantPool[offsets[i] .. offsets[i + 1]). */
  readonly constantOffsets: Uint32Array;
  readonly program: Uint8Array;
}

export type CompileErrorCode = 'invalid-rule-id' | 'duplicate-rule' | 'constant-pool-overflow' | 'encoding-failed';

export interface CompileError {
  readonly code: CompileErrorCode;
  readonly message: string;
  readonly ruleIndex: number;
}

const MAX_CONSTANTS = 0xffff;

export function compileRules(rules: readonly Rule[]): Result<CompiledRules, CompileError> {
  const ruleIds: ContentId[] = [];
  const constants: number[] = [];
  const offsets = new Uint32Array(rules.length + 1);
  const instructions: Instruction[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]!;

    const parsed = parseContentId(rule.id);
    if (!parsed.ok) {
      return err({ code: 'invalid-rule-id', message: parsed.error.message, ruleIndex: index });
    }
    if (seen.has(parsed.value)) {
      return err({
        code: 'duplicate-rule',
        message: `Rule ${parsed.value} is declared more than once.`,
        ruleIndex: index,
      });
    }
    seen.add(parsed.value);
    ruleIds.push(parsed.value);

    offsets[index] = constants.length;
    for (const constant of rule.constants) {
      if (constants.length >= MAX_CONSTANTS) {
        return err({
          code: 'constant-pool-overflow',
          message: `Constant pool exceeds ${MAX_CONSTANTS} entries.`,
          ruleIndex: index,
        });
      }
      instructions.push({ op: OP.LOAD_CONST, a: 0, b: constants.length });
      constants.push(constant);
    }
  }
  offsets[rules.length] = constants.length;

  instructions.push({ op: OP.HALT, a: 0, b: 0 });

  const program = encodeProgram(instructions);
  if (!program.ok) {
    return err({
      code: 'encoding-failed',
      message: (program.error satisfies IsaError).message,
      ruleIndex: -1,
    });
  }

  return ok({
    ruleIds,
    constantPool: Int32Array.from(constants),
    constantOffsets: offsets,
    program: program.value,
  });
}
