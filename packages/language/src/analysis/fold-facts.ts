import type { FoldModifiers } from '../application-forms.js';
import type { Expression } from '../generated/ast.js';
import type { Types } from './types.js';
import type { ValueFacts } from './value-domain.js';

/** Shape transfer shared by symbolic folds and named callbacks; no callback is executed. */
export function foldShapeFacts(
    scan: boolean, form: FoldModifiers, source: ValueFacts,
    infer: (expression: Expression) => ValueFacts, cells?: Types,
): ValueFacts | undefined {
    if (source.rank === undefined) return undefined;
    const sourceRank = source.rank;
    if ((form.axis || form.axes) && source.types.join() !== 'array') return undefined;
    const integer = (expression: Expression): number | undefined => {
        const value = infer(expression).integer;
        const number = value === undefined ? NaN : Number(value);
        return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
    };
    const rank = form.rank && integer(form.rank);
    if (form.rank && (rank === undefined || rank > source.rank)) return undefined;
    const axes = form.axes?.map(integer);
    const axis = form.axis ? integer(form.axis) : rank === undefined ? undefined : source.rank - rank;
    const shape = source.shape ?? Array(source.rank).fill(null) as null[];
    if (scan) {
        if (rank === 0 || form.axis && axis === undefined || axis !== undefined && axis >= sourceRank) return undefined;
        if (axis === undefined && source.rank !== 1) return undefined;
        if (source.types.join() === 'array' && (form.axis || form.rank) && form.seed && infer(form.seed).rank !== 0) return undefined;
        const output = [...shape];
        const along = axis ?? 0;
        if (form.seed && output[along] !== null) output[along]!++;
        return { types: [source.types.join() === 'sequence' && !form.axis ? 'sequence' : 'array'],
            rank: output.length, shape: output, ...(cells?.length ? { elements: cells } : {}) };
    }
    if (axes?.some(axis => axis === undefined || axis >= sourceRank) || axes && new Set(axes).size !== axes.length) return undefined;
    const frame = axes ? shape.filter((_, index) => !axes.includes(index))
        : rank === undefined ? [] : shape.slice(0, source.rank - rank);
    return frame.length ? { types: ['array'], rank: frame.length, shape: frame,
        ...(cells?.length ? { elements: cells } : {}) }
        : cells?.length ? { types: cells, rank: 0, shape: [] } : undefined;
}
