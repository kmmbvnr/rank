import { MISSING, type RankValue } from './value.js';

const PROPAGATING = new Set([
    '+', '-', '*', '/', '//', '%', '**', 'min', 'max',
    'less', 'greater', 'atleast', 'atmost', 'equal', 'notequal', 'multipleby', 'xor',
]);

const known = (value: RankValue) => value === MISSING || typeof value === 'boolean';

/**
 * A binary operator with `.NA` as at least one scalar operand, or undefined
 * when the operator has no rule for it (the caller then reports its usual type
 * error). Arithmetic and comparison propagate; `and`/`or` follow three-valued
 * logic, so `false and .NA` is false and `true or .NA` is true.
 */
export function missingBinary(operator: string, left: RankValue, right: RankValue): RankValue | undefined {
    if (operator === 'and' || operator === 'or') {
        if (!known(left) || !known(right)) return undefined;
        const decisive = operator === 'or';
        return left === decisive || right === decisive ? decisive : MISSING;
    }
    return PROPAGATING.has(operator) ? MISSING : undefined;
}
