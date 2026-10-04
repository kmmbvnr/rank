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

/** `to` and `till` end a sequence; `from` and `after` start it. */
export type BoundMode = 'to' | 'till' | 'from' | 'after';

/** Whether the right side of `to` or `till` tests items rather than supplying a value. */
export function isBoundCondition(expression: Expression): boolean {
    return isSubjectComparisonExpression(expression)
        || (isUnaryExpression(expression) && expression.operator === 'not')
        || (isBinaryExpression(expression) && LOGICAL.has(expression.operator));
}

/** Compile `from`, `after`, `take`, `drop` and `first where` clauses, and `to`/`till` bounds. */
export function compileClauseExpression(
    expression: Expression, makeContext: () => ClauseExpressionContext,
): (() => Evaluation<RankValue>) | undefined {
    if (isTakeWhileExpression(expression)) {
        return () => { throw new RankError('take while is not a Rank clause: write `till not Condition` to keep items while Condition holds'); };
    }
    if (isCountClauseExpression(expression)) {
        const context = makeContext();
        return function* (): Execution<RankValue> {
            const source = yield* resume(context.evaluate(expression.source));
            const count = yield* resume(context.evaluate(expression.count));
            return takeDropValue(source, count, expression.operator === 'drop');
        };
    }
    // `Values till greater 5`: a condition cannot be evaluated before its subject.
    if (isBinaryExpression(expression) && (expression.operator === 'to' || expression.operator === 'till')
        && !expression.step && isBoundCondition(expression.right)) {
        return compileBound(expression.left, expression.right, expression.operator, makeContext());
    }
    if (isBoundClauseExpression(expression)) {
        const condition = expression.condition;
        if (isBinaryExpression(condition) && ['to', 'till', 'until'].includes(condition.operator)) {
            return () => { throw new RankError(`slices are written with a range: \`Values (Start ${condition.operator} End)\``); };
        }
        return compileBound(expression.source, condition, expression.operator, makeContext());
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

function compileBound(
    sourceExpression: Expression, condition: Expression, mode: BoundMode, context: ClauseExpressionContext,
): () => Evaluation<RankValue> {
    return function* (): Execution<RankValue> {
        const source = yield* resume(context.evaluate(sourceExpression));
        const bound = yield* resume(boundCondition(context, source, condition, mode));
        return applyBound(source, bound, mode);
    };
}

/** A bound value an ordered source can seek: `till Limit`, `from greater Limit`. */
interface Limit { readonly value: RankValue; readonly inclusive: boolean }

export interface Bound { readonly condition: BoundCondition; readonly limit?: Limit }

/** Seek an ordered source to a plain bound, or read the items in order. */
export function applyBound(source: RankValue, bound: Bound, mode: BoundMode): RankValue {
    const upper = mode === 'to' || mode === 'till';
    if (isRankSequence(source) && bound.limit !== undefined && typeof bound.limit.value === 'bigint') {
        const { value, inclusive } = bound.limit;
        const planned = upper
            ? source.plan.withUpperBound && boundSequence(source, value, inclusive)
            : source.plan.withLowerBound && lowerBoundSequence(source, value, inclusive);
        if (planned) return planned;
    }
    return boundValue(source, bound.condition, upper ? 'till' : 'from');
}

/**
 * A value on the right of a bound: a limit, a mask, or a function of one item.
 * `to X` keeps items at most X and `till X` those below it; `from X` starts at
 * the first item at least X and `after X` at the first above it.
 */
export function valueBound(
    value: RankValue, mode: BoundMode,
    binary: (operator: string, left: RankValue, right: RankValue) => RankValue,
): Bound {
    if (isMask(value)) {
        requireCondition(mode);
        return { condition: { mask: value } };
    }
    if (isNativeFunction(value)) {
        requireCondition(mode);
        return { condition: { test: item => value.call([item]) === true } };
    }
    if (isRankArray(value) || isRankSequence(value)) throw new RankError(`${mode} expects a value or a boolean mask`);
    // The test finds the first item on the far side of the bound.
    const operator = mode === 'to' || mode === 'after' ? 'greater' : 'atleast';
    return {
        condition: { test: item => binary(operator, item, value) === true },
        limit: { value, inclusive: mode === 'to' || mode === 'from' },
    };
}

/** `to` and `after` take a value; a condition belongs to `till` or `from`. */
function requireCondition(mode: BoundMode): void {
    if (mode === 'to') throw new RankError('to takes a value; write `till Condition` to stop before an item');
    if (mode === 'after') throw new RankError('after takes a value; write `from Condition` to start at an item');
}

function* boundCondition(
    context: ClauseExpressionContext, source: RankValue, condition: Expression, mode: BoundMode,
): Execution<Bound> {
    if (isSubjectComparisonExpression(condition) && !condition.stepOperator
        && ['greater', 'atleast'].includes(condition.operator.replace(/\s+/g, ''))) {
        requireCondition(mode);
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
        return valueBound(yield* resume(context.evaluate(condition)), mode, context.binary);
    }
    requireCondition(mode);
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
