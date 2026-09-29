import {
    flattenApplication, isApplicationExpression, isBinaryExpression, isBoundClauseExpression,
    isCountClauseExpression, isFirstIndexWhereExpression, isFirstWhereExpression, isNameExpression,
    isSubjectComparisonExpression, isTakeWhileExpression, isUnaryExpression, type Expression,
} from '@arrrank/language';
import { resume, type Evaluation, type Execution } from './execution.js';
import { ownedArray } from './array-storage.js';
import { RankError } from './errors.js';
import { LocalFrame } from './frame.js';
import { TABLE_INPUT, collectionExpression } from './table-expression.js';
import { boundSequence, boundValue, firstWhereValue, isPositionalMask, lowerBoundSequence, takeDropValue,
    type BoundCondition } from './sequence.js';
import { isNativeFunction, isRankArray, isRankSequence, isRankSequenceMask, type RankValue } from './value.js';

export interface ClauseExpressionContext {
    localFrame: LocalFrame | undefined;
    evaluate(expression: Expression): Evaluation<RankValue>;
    binary(operator: string, left: RankValue, right: RankValue): RankValue;
    findVariable(name: string): RankValue | undefined;
}

const LOGICAL = new Set(['and', 'or', 'xor']);

/** Compile `from`, `till`, `take`, `drop` and `first where` clauses. */
export function compileClauseExpression(
    expression: Expression, makeContext: () => ClauseExpressionContext,
): (() => Evaluation<RankValue>) | undefined {
    if (isTakeWhileExpression(expression)) {
        return () => { throw new RankError('take while is gone: write `till not Condition` to keep items while Condition holds'); };
    }
    if (isCountClauseExpression(expression)) {
        const context = makeContext();
        return function* (): Execution<RankValue> {
            const source = yield* resume(context.evaluate(expression.source));
            const count = yield* resume(context.evaluate(expression.count));
            return takeDropValue(source, count, expression.operator === 'drop');
        };
    }
    if (isBoundClauseExpression(expression)) {
        const context = makeContext();
        const mode = expression.operator;
        return function* (): Execution<RankValue> {
            const condition = expression.condition;
            if (isBinaryExpression(condition) && (condition.operator === 'to' || condition.operator === 'until')) {
                throw new RankError(`slices are written with a range: \`Values (Start ${condition.operator} End)\``);
            }
            const source = yield* resume(context.evaluate(expression.source));
            const bound = yield* resume(boundCondition(context, source, condition, mode));
            if (isRankSequence(source) && bound.limit !== undefined && typeof bound.limit.value === 'bigint') {
                // An ordered source seeks to a bound instead of reading up to it.
                const { value, inclusive } = bound.limit;
                const planned = mode === 'till'
                    ? source.plan.withUpperBound && boundSequence(source, value, inclusive)
                    : source.plan.withLowerBound && lowerBoundSequence(source, value, inclusive);
                if (planned) return planned;
            }
            return boundValue(source, bound.condition, mode);
        };
    }
    if (isFirstWhereExpression(expression) || isFirstIndexWhereExpression(expression)) {
        const context = makeContext();
        return function* (): Execution<RankValue> {
            const source = yield* resume(context.evaluate(expression.source));
            const mask = yield* resume(conditionMask(context, source, expression.mask));
            if (!isMask(mask)) throw new RankError('first where needs a condition or a boolean mask');
            return firstWhereValue(source, mask, isFirstIndexWhereExpression(expression));
        };
    }
    return undefined;
}

/** A bound value from `till Limit` or `till greater Limit`, which an ordered source can seek. */
interface Limit { readonly value: RankValue; readonly inclusive: boolean }

/**
 * A plain value is a bound, since a sequence need never equal it:
 * `till Limit` keeps items at most `Limit`, `from Limit` starts at the first at
 * least `Limit`. Anything else is a condition on each item, or a mask.
 */
function* boundCondition(
    context: ClauseExpressionContext, source: RankValue, condition: Expression, mode: 'from' | 'till',
): Execution<{ condition: BoundCondition; limit?: Limit }> {
    if (isSubjectComparisonExpression(condition)
        && ['greater', 'atleast'].includes(condition.operator.replace(/\s+/g, ''))) {
        const value = yield* resume(context.evaluate(condition.right));
        const strict = condition.operator === 'greater';
        const operator = strict ? 'greater' : 'atleast';
        return {
            condition: { test: item => context.binary(operator, item, value) === true },
            // `till greater X` keeps X; `from greater X` skips it.
            limit: { value, inclusive: mode === 'till' ? strict : !strict },
        };
    }
    if (!isPredicate(context, condition)) {
        const value = yield* resume(context.evaluate(condition));
        if (isMask(value)) return { condition: { mask: value } };
        if (isRankArray(value) || isRankSequence(value)) throw new RankError(`${mode} expects a boolean mask`);
        const operator = mode === 'till' ? 'greater' : 'atleast';
        return {
            condition: { test: item => context.binary(operator, item, value) === true },
            limit: { value, inclusive: true },
        };
    }
    const mask = yield* resume(conditionMask(context, source, condition));
    if (isRankSequenceMask(mask) && mask.source === source) return { condition: { test: item => mask.predicate.test(item) } };
    return { condition: { mask } };
}

/** Evaluate a condition whose subject is the clause's source. */
function* conditionMask(context: ClauseExpressionContext, source: RankValue, condition: Expression): Execution<RankValue> {
    if (!isPredicate(context, condition)) return yield* resume(context.evaluate(condition));
    // Text compares whole, so its condition is asked of each character.
    if (typeof source === 'string') {
        const flags: RankValue[] = [];
        for (const character of source) flags.push(yield* resume(subjectCondition(context, character, condition)));
        return ownedArray(flags);
    }
    return yield* resume(subjectCondition(context, source, condition));
}

function* subjectCondition(context: ClauseExpressionContext, subject: RankValue, condition: Expression): Execution<RankValue> {
    const previous = context.localFrame;
    const frame = new LocalFrame(previous);
    frame.set(TABLE_INPUT, subject);
    context.localFrame = frame;
    try {
        return yield* resume(context.evaluate(collectionExpression(condition)));
    } finally {
        context.localFrame = previous;
    }
}

/** Whether a condition tests each item rather than supplying a value or a mask. */
function isPredicate(context: ClauseExpressionContext, condition: Expression): boolean {
    if (isSubjectComparisonExpression(condition)) return true;
    if (isBinaryExpression(condition)) return LOGICAL.has(condition.operator)
        && (isPredicate(context, condition.left) || isPredicate(context, condition.right));
    if (isUnaryExpression(condition)) return condition.operator === 'not' && isPredicate(context, condition.operand);
    const parts = isApplicationExpression(condition) ? flattenApplication(condition) : [condition];
    const call = parts.findIndex(part => isNameExpression(part) && isFunction(context, part.name));
    if (call <= 0) return call === 0;
    // Data before a function is its data-first arguments: `5 near` tests each item.
    const name = parts[call];
    const bound = isNameExpression(name) ? context.findVariable(name.name) : undefined;
    return bound !== undefined && isNativeFunction(bound) && bound.arities.includes(call + 1);
}

function isFunction(context: ClauseExpressionContext, name: string): boolean {
    const bound = context.findVariable(name);
    return bound === undefined ? /^[a-z]/.test(name) : isNativeFunction(bound);
}

function isMask(value: RankValue): boolean {
    if (isRankSequenceMask(value) || isPositionalMask(value)) return true;
    if (isRankArray(value)) {
        if (value.shape.some(axis => axis === 0)) return true;
        return typeof (value.itemAt?.(0) ?? value.items[0]) === 'boolean';
    }
    return false;
}
