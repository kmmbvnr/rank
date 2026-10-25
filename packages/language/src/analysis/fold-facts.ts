import { foldAxisPartition } from '../fold-axes.js';
import { normalizeAxis } from '../axis-index.js';
import type { FoldModifiers } from '../application-forms.js';
import type { Expression } from '../generated/ast.js';
import type { Types } from './types.js';
import type { ValueFacts } from './value-domain.js';

/** Shape transfer shared by symbolic folds and named callbacks; no callback is executed. */
export function foldShapeFacts(
    scan: boolean, form: FoldModifiers, source: ValueFacts,
    infer: (expression: Expression) => ValueFacts, cells?: Types, preservesCell = false,
): ValueFacts | undefined {
    if (source.rank === undefined) return undefined;
    const sourceRank = source.rank;
    if ((form.axis || form.axes) && source.types.join() !== 'array') return undefined;
    const integer = (expression: Expression, axis = false): number | undefined => {
        const value = infer(expression).integer;
        const number = value === undefined ? NaN : axis ? normalizeAxis(Number(value), sourceRank) : Number(value);
        return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
    };
    const rank = form.rank && integer(form.rank);
    if (form.rank && (rank === undefined || rank > source.rank)) return undefined;
    const axes = form.axes?.map(part => integer(part, true));
    if (form.rank && !form.axis && !form.axes && sourceRank - rank! !== 1) return undefined;
    const axis = form.axis ? integer(form.axis, true) : rank === undefined ? undefined : 0;
    const shape = source.shape ?? Array(source.rank).fill(null) as null[];
    if (scan) {
        if (form.axis && axis === undefined || axis !== undefined && axis >= sourceRank) return undefined;
        if ((rank ?? 0) + 1 > sourceRank) return undefined;
        const { frameAxes, cellAxes } = foldAxisPartition(sourceRank, rank ?? 0, [axis ?? 0]);
        const prefixAxes = [...frameAxes, axis ?? 0].sort((a, b) => a - b);
        if (axis === undefined && source.rank !== 1) return undefined;
        if (rank && source.types.join() !== 'array') return undefined;
        const tensor = source.types.join() === 'array' && !!(form.axis || form.rank);
        const seed = form.seed && infer(form.seed);
        if (tensor && seed && seed.types.join() !== 'array' && seed.rank !== 0) return undefined;
        const stateShape = tensor && seed ? seed.shape ?? (seed.rank === 0 ? [] : undefined)
            : cellAxes.map(axis => shape[axis]);
        if (!stateShape) return undefined;
        const output = [...prefixAxes.map(axis => shape[axis]), ...stateShape];
        const along = prefixAxes.indexOf(axis ?? 0);
        if (form.seed && output[along] !== null) output[along]!++;
        return { types: [source.types.join() === 'sequence' && !form.axis ? 'sequence' : 'array'],
            rank: output.length, shape: output, ...(cells?.length ? { elements: cells } : {}) };
    }
    if (axes?.some(axis => axis === undefined || axis >= sourceRank) || axes && new Set(axes).size !== axes.length) return undefined;
    // Positive input cells may produce an accumulator of any rank. Do not
    // claim a scalar result without analysing the callback and seed.
    if (rank !== undefined && rank > 0) {
        if (!preservesCell || !cells?.length || source.types.join() !== 'array') return undefined;
        const traversal = (axes ?? [0]) as number[];
        if (rank + traversal.length > sourceRank) return undefined;
        const { frameAxes, cellAxes } = foldAxisPartition(sourceRank, rank, traversal);
        const frame = frameAxes.map(axis => shape[axis]);
        const traversed = traversal.map(axis => shape[axis]);
        if (form.seed && (frame.includes(0) || traversed.includes(0))) {
            return frame.length ? { types: ['array'], rank: frame.length, shape: frame, elements: cells }
                : { types: cells, rank: 0, shape: [] };
        }
        if (form.seed && (frame.includes(null) || traversed.includes(null))) return undefined;
        const output = [...frame, ...cellAxes.map(axis => shape[axis])];
        return { types: ['array'], rank: output.length, shape: output, elements: cells };
    }
    if (form.seed && infer(form.seed).rank !== 0) return undefined;
    if (!cells?.length) return undefined;
    const frame = axes ? shape.filter((_, index) => !axes.includes(index)) : [];
    return frame.length ? { types: ['array'], rank: frame.length, shape: frame,
        ...(cells?.length ? { elements: cells } : {}) }
        : cells?.length ? { types: cells, rank: 0, shape: [] } : undefined;
}
