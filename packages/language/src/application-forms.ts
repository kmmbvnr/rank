import { isNameExpression, type Expression } from './generated/ast.js';
import { findOperation, type Operation } from './operations.js';

export interface AxisReductionForm {
    readonly kind: 'axis-reduction';
    readonly source: Expression;
    readonly operation: Operation;
    readonly axes: readonly Expression[];
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
