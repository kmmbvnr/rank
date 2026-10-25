import { normalizeAxis } from '../axis-index.js';
import type { ApplicationForm } from '../application-forms.js';
import type { Expression } from '../generated/ast.js';
import type { ValueFacts } from './value-domain.js';

/** Validate axes only when the source rank is known, without executing callbacks. */
export function axisDiagnostics(form: ApplicationForm, expression: Expression,
    infer: (expression: Expression) => ValueFacts): { node: Expression; kind: 'DimensionMismatch'; message: string }[] {
    const diagnostics: { node: Expression; kind: 'DimensionMismatch'; message: string }[] = [];
    const check = (source: Expression, axes: readonly (number | Expression)[] | undefined, cellRank?: Expression, operation = 'reduce') => {
        const rank = infer(source).rank;
        if (rank === undefined) return;
        const cell = cellRank && infer(cellRank).integer;
        if (cell !== undefined && (Number(cell) < 0 || Number(cell) > rank)) {
            diagnostics.push({ node: cellRank!, kind: 'DimensionMismatch', message: `rank ${cell} exceeds value rank ${rank}` });
            return;
        }
        if (!axes) {
            if (cell !== undefined && Number(cell) <= rank && Number(cell) >= 0 && rank - Number(cell) !== 1)
                diagnostics.push({ node: cellRank!, kind: 'DimensionMismatch', message:
                    `${operation} rank ${cell} requires an explicit axis unless exactly one axis remains outside the input cell; use axis N for scalar cells or rank R axis N for input cells` });
            return;
        }
        const seen = new Set<number>();
        for (const axis of axes) {
            const literal = typeof axis === 'number' ? axis : infer(axis).integer;
            if (literal === undefined) continue;
            const index = normalizeAxis(Number(literal), rank);
            const node = typeof axis === 'number' ? expression : axis;
            let message: string | undefined;
            if (!Number.isSafeInteger(Number(literal)) || index < 0 || index >= rank) message = `axis ${literal} is invalid for rank ${rank}`;
            else if (seen.has(index)) message = 'axis numbers must be unique';
            if (message) diagnostics.push({ node, kind: 'DimensionMismatch', message });
            seen.add(index);
        }
        if (cell !== undefined && Number(cell) + axes.length > rank) {
            diagnostics.push({ node: cellRank!, kind: 'DimensionMismatch',
                message: `${operation} input cell rank plus traversal axis count exceeds tensor rank` });
        }
    };
    switch (form.kind) {
        case 'reduce': case 'named-reduce': check(form.source, form.axes, form.rank); break;
        case 'scan': case 'named-scan': check(form.source, form.axis === undefined ? undefined : [form.axis], form.rank, 'scan'); break;
        case 'rank': check(form.parts[0], form.axes); break;
        case 'comparison-rank': check(form.left, form.axes); check(form.right, form.axes); break;
        case 'axis-metric': {
            const left = infer(form.left).rank, right = infer(form.right).rank;
            if (left !== undefined && right !== undefined) check(left >= right ? form.left : form.right, form.axes);
            break;
        }
        case 'axis-matmul': check(form.left, [form.axes[0]]); check(form.right, [form.axes[1]]); break;
        case 'window': case 'axis-reduction': case 'axis-transpose': case 'axis-quantile':
            check(form.source, form.axes); break;
        case 'axis-length': case 'axis-shift': case 'axis-shuffle': case 'axis-argsort':
            check(form.source, form.axis === undefined ? undefined : [form.axis]); break;
    }
    return diagnostics;
}
