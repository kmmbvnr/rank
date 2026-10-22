import type { Expression, ValueFacts } from '@arrrank/language';
import { RankError } from './errors.js';
import { completed, mapResult, resume, runExecution, type Evaluation, type Execution } from './execution.js';
import { checkpoint } from './interrupt.js';
import type { RankValue } from './value.js';

/** A replayable expression, separate from a single-pass resource. Evaluation
 * constructs its native sequence/tensor result; it does not materialize it. */
export interface RankPlan {
    readonly kind: 'plan';
    readonly expression?: Expression;
    readonly dependencies: ReadonlyMap<string, RankValue>;
    readonly result?: ValueFacts;
    evaluate(): Evaluation<RankValue>;
}

export function isRankPlan(value: RankValue): value is RankPlan {
    return typeof value === 'object' && value.kind === 'plan';
}

/** Demand never retains a result, including after failure or cancellation. */
export function demand(value: RankValue): Evaluation<RankValue> {
    return isRankPlan(value) ? demandPlan(value) : completed(value);
}

/** Synchronous callbacks share the same demand contract and stack driver. */
export function demandValue(value: RankValue): RankValue {
    return isRankPlan(value) ? runExecution(demand(value)) : value;
}

function* demandPlan(value: RankValue): Execution<RankValue> {
    const active = new Set<RankPlan>();
    while (isRankPlan(value)) {
        checkpoint('evaluating plan');
        if (active.has(value)) throw new RankError('cyclic deferred result', 'RecursionLimit');
        active.add(value);
        value = yield* resume(value.evaluate());
    }
    return value;
}

/** Type/shape evidence can survive demands, but computed results cannot. */
export function checkPlan(plan: RankPlan, check: (value: RankValue) => RankValue): RankPlan {
    return { ...plan, evaluate: () => mapResult(demand(plan), check) };
}
