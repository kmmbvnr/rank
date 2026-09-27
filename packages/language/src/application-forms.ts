import { isLabelLiteral, isNameExpression, type Expression } from './generated/ast.js';
import { findOperation, type Operation } from './operations.js';

export interface AxisReductionForm {
    readonly kind: 'axis-reduction';
    readonly source: Expression;
    readonly operation: Operation;
    readonly axes: readonly Expression[];
}

export interface SortDirectionForm {
    readonly kind: 'sort-direction';
    readonly operation: Operation;
    readonly direction: Expression;
}

/** Recognize a trailing sort direction, including invalid labels for runtime diagnostics. */
export function sortDirectionForm(
    parts: readonly Expression[], standard: (name: string) => boolean = () => true,
): SortDirectionForm | undefined {
    const direction = parts.at(-1);
    if (parts.length <= 2 || !direction || !(isLabelLiteral(direction)
        || isNameExpression(direction) && /^[A-Z]/.test(direction.name))) return undefined;
    const operation = parts.slice(0, -1).find(part => isNameExpression(part)
        && standard(part.name) && findOperation(part.name)?.sortDirection);
    if (!operation || !isNameExpression(operation)) return undefined;
    return { kind: 'sort-direction', operation: findOperation(operation.name)!, direction };
}

/** Recognize a reduction form without evaluating its axes or consulting runtime values. */
export function axisReductionForm(
    parts: readonly Expression[],
    standard: (name: string) => boolean = () => true,
): AxisReductionForm | undefined {
    if (parts.length < 4 || !isNameExpression(parts[1])
        || !isNameExpression(parts[2]) || parts[2].name !== 'axis'
        || !standard(parts[1].name)) return undefined;
    const operation = findOperation(parts[1].name);
    if (!operation?.axisReduction) return undefined;
    return { kind: 'axis-reduction', source: parts[0], operation, axes: parts.slice(3) };
}
