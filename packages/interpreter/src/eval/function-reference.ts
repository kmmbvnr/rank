import { isNameExpression, isParenthesizedExpression, type Expression } from '@arrrank/language';
import { completed, type Evaluation } from '../execution.js';
import type { RankValue } from '../value.js';

interface ReferenceContext {
    resolve(name: string): RankValue;
    evaluate(expression: Expression): Evaluation<RankValue>;
}

/** A callback position refers to a named function, including a nullary one.
 * Compound expressions still execute to produce the function value. */
export function functionReference(expression: Expression, context: ReferenceContext): Evaluation<RankValue> {
    while (isParenthesizedExpression(expression)) expression = expression.value;
    return isNameExpression(expression) ? completed(context.resolve(expression.name)) : context.evaluate(expression);
}
