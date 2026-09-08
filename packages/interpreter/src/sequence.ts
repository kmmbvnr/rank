import { RankError } from './errors.js';
import {
    isRankSequence,
    type RankSequence,
    type RankSequenceMask,
    type RankValue,
    type SequencePlan,
    type SequencePredicate,
} from './value.js';

export function sequence(plan: SequencePlan): RankSequence {
    return { kind: 'sequence', plan };
}

export function sequenceMask(
    source: RankSequence,
    predicate: SequencePredicate,
): RankSequenceMask {
    return { kind: 'sequence-mask', source, predicate };
}

export function filterSequence(
    source: RankSequence,
    predicate: SequencePredicate,
): RankSequence {
    const planned = source.plan.withFilter?.(predicate);
    if (planned) return sequence(planned);

    const sourcePlan = source.plan;
    return sequence({
        name: `${sourcePlan.name} where ${predicate.name}`,
        finite: sourcePlan.finite,
        *iterate() {
            for (const value of sourcePlan.iterate()) {
                if (predicate.test(value)) yield value;
            }
        },
    });
}

export function boundSequence(
    source: RankSequence,
    limit: bigint,
    inclusive: boolean,
): RankSequence {
    const planned = source.plan.withUpperBound?.(limit, inclusive);
    if (!planned) {
        throw new RankError(`${source.plan.name} does not support ${inclusive ? 'to' : 'until'}`);
    }
    return sequence(planned);
}

export function mapSequence(
    source: RankSequence,
    name: string,
    operation: (value: RankValue) => RankValue,
): RankSequence {
    const sourcePlan = source.plan;
    return sequence({
        name: `${sourcePlan.name} ${name}`,
        finite: sourcePlan.finite,
        *iterate() {
            for (const value of sourcePlan.iterate()) yield operation(value);
        },
    });
}

export function zipSequences(
    left: RankSequence,
    right: RankSequence,
    name: string,
    operation: (left: RankValue, right: RankValue) => RankValue,
): RankSequence {
    return sequence({
        name: `${left.plan.name} ${name} ${right.plan.name}`,
        finite: left.plan.finite && right.plan.finite,
        *iterate() {
            const a = left.plan.iterate();
            const b = right.plan.iterate();
            while (true) {
                const nextA = a.next();
                const nextB = b.next();
                if (nextA.done || nextB.done) return;
                yield operation(nextA.value, nextB.value);
            }
        },
    });
}

export function sequenceValues(value: RankValue, operation: string): Iterable<RankValue> {
    if (!isRankSequence(value)) return [value];
    if (!value.plan.finite) {
        throw new RankError(`${operation} requires a bounded sequence`);
    }
    return { [Symbol.iterator]: () => value.plan.iterate() };
}

export function reduceSequence(value: RankSequence, operation: string): RankValue | undefined {
    return value.plan.reduce?.(operation);
}
