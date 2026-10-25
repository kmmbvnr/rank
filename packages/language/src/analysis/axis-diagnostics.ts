import { normalizeAxis } from '../axis-index.js';
import type { ApplicationForm } from '../application-forms.js';
import { flattenApplication } from '../expressions.js';
import { isNameExpression, isBinaryExpression, isForStatement, type Expression } from '../generated/ast.js';
import type { ValueFacts } from './value-domain.js';

/** Validate axes only when the source rank is known, without executing callbacks. */
export function axisDiagnostics(form: ApplicationForm, expression: Expression,
    infer: (expression: Expression) => ValueFacts): { node: Expression; kind: 'DimensionMismatch'; message: string }[] {
    const diagnostics: { node: Expression; kind: 'DimensionMismatch'; message: string }[] = [];
    const check = (source: Expression, axes: readonly (number | Expression)[] | undefined, cellRank?: Expression) => {
        const rank = infer(source).rank;
        if (rank === undefined || !axes) return;
        const seen = new Set<number>();
        for (const axis of axes) {
            const literal = typeof axis === 'number' ? axis : infer(axis).integer;
            if (literal === undefined) continue;
            const index = normalizeAxis(Number(literal), rank);
            const node = typeof axis === 'number' ? expression : axis;
            let message: string | undefined;
            if (!Number.isSafeInteger(Number(literal)) || index < 0 || index >= rank) message = `axis ${literal} is invalid for rank ${rank}`;
            else if (seen.has(index)) message = 'axis numbers must be unique';
            else if (cellRank) {
                const cell = infer(cellRank).integer;
                if (cell !== undefined && index >= rank - Number(cell)) message = 'reduce axis must be outside the trailing input cell';
            }
            if (message) diagnostics.push({ node, kind: 'DimensionMismatch', message });
            seen.add(index);
        }
    };
    const parent = expression.$container;
    if (isBinaryExpression(parent) && parent.operator === 'in' && parent.right === expression
        && isForStatement(parent.$container)) {
        const parts = flattenApplication(expression);
        if (isNameExpression(parts[1]) && parts[1].name === 'axis') {
            const end = parts.findIndex(part => isNameExpression(part) && part.name === 'rank');
            check(parts[0], parts.slice(2, end < 0 ? undefined : end));
            return diagnostics;
        }
    }
    switch (form.kind) {
        case 'reduce': case 'named-reduce': check(form.source, form.axes, form.rank); break;
        case 'scan': case 'named-scan': check(form.source, form.axis === undefined ? undefined : [form.axis]); break;
        case 'rank': check(form.parts[0], form.axes); break;
        case 'comparison-rank': check(form.left, form.axes); check(form.right, form.axes); break;
        case 'axis-metric': {
            const left = infer(form.left).rank, right = infer(form.right).rank;
            if (left !== undefined && right !== undefined) check(left >= right ? form.left : form.right, form.axes);
            break;
        }
        case 'axis-matmul': check(form.left, [form.axes[0]]); check(form.right, [form.axes[1]]); break;
        case 'window': case 'axis-reduction': case 'axis-transpose': case 'axis-quantile':
        case 'axis-covariance': case 'axis-correlation': check(form.source, form.axes); break;
        case 'axis-selection': case 'axis-length': case 'axis-shift': case 'axis-shuffle': case 'axis-argsort':
            check(form.source, form.axis === undefined ? undefined : [form.axis]); break;
        case 'plain': {
            // Loop iterables have a source and cell axes, without a called function.
            const parts = flattenApplication(expression);
            if (isNameExpression(parts[1]) && parts[1].name === 'axis') {
                const end = parts.findIndex(part => isNameExpression(part) && part.name === 'rank');
                check(parts[0], parts.slice(2, end < 0 ? undefined : end));
            }
            break;
        }
    }
    return diagnostics;
}
