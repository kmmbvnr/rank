import type { IntrinsicRank } from '../operations.js';
import { rankedOperandShapes } from './operation-shape.js';
import { stableRecordField, UNKNOWN_VALUE, type ValueFacts } from './value-domain.js';

/** Map abstract cell facts through a callback without evaluating any cells.
 * Result types do not establish callback purity or safe lazy readers. */
export function rankedFunctionFacts(operands: readonly ValueFacts[], ranks: readonly IntrinsicRank[],
    invoke: (cells: readonly ValueFacts[]) => ValueFacts, axes?: readonly number[]): ValueFacts {
    const partition = rankedFunctionInputs(operands, ranks, axes);
    if (!partition) return UNKNOWN_VALUE;
    const { inputs, frame } = partition;
    if (!frame.length) return invoke(operands);
    // Runtime never invokes the callback for an empty frame, and retains only that frame.
    if (frame.includes(0)) return { types: ['array'], rank: frame.length, shape: frame };
    const result = invoke(inputs);
    if (result.bottom || !result.types.length) return UNKNOWN_VALUE;
    // Arrays stack their axes; other values (including text) are boxed cells.
    if (result.types.join() === 'array') {
        // An unknown frame may be empty: runtime then omits the result cell axes.
        if (result.rank === undefined || result.rank > 0 && frame.includes(null)) return { types: ['array'] };
        const shape = [...frame, ...result.shape ?? Array(result.rank).fill(null)];
        return { types: ['array'], rank: shape.length, shape, elements: result.elements };
    }
    if (result.types.includes('array')) return { types: ['array'] };
    return { types: ['array'], rank: frame.length, shape: frame, elements: result.types };
}

/** Cell facts used by both result inference and the independent effect analysis. */
export function rankedFunctionInputs(operands: readonly ValueFacts[], ranks: readonly IntrinsicRank[],
    axes?: readonly number[]) {
    const partition = rankedOperandShapes(operands, ranks, axes);
    if (!partition) return undefined;
    const { cells, frame } = partition;
    const inputs = operands.map((source, i): ValueFacts => {
        const shape = cells[i];
        if (!shape || source.types.join() !== 'array' || shape.length === source.rank) return source;
        if (!shape.length) return stableRecordField({ types: source.elements ?? [] });
        return { types: ['array'], rank: shape.length, shape, elements: source.elements,
            ...(source.eagerScalarCells ? { eagerScalarCells: true as const } : {}),
            ...(source.callbackFreeScalarCells ? { callbackFreeScalarCells: true as const } : {}) };
    });
    return { inputs, frame };
}
