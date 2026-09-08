import { MissingValueError, RankError } from './errors.js';
import {
    isRankSequence,
    type RankSequence,
    type RankSequenceMask,
    type RankValue,
    type SequencePlan,
    type SequencePredicate,
    type SequenceSize,
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
        size: filteredSize(sourcePlan.size),
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

export function atSequence(source: RankSequence, index: bigint): RankValue {
    if (index < 0n) throw new RankError('sequence index must be nonnegative');
    if (source.plan.size.kind === 'exact' && index >= source.plan.size.value) {
        throw new MissingValueError(`sequence index out of bounds: ${index}`);
    }

    const planned = source.plan.at?.(index);
    if (planned !== undefined) return planned;

    let current = 0n;
    for (const value of source.plan.iterate()) {
        if (current === index) return value;
        current += 1n;
    }
    throw new MissingValueError(`sequence index out of bounds: ${index}`);
}

export function mapSequence(
    source: RankSequence,
    name: string,
    operation: (value: RankValue) => RankValue,
): RankSequence {
    const sourcePlan = source.plan;
    return sequence({
        name: `${sourcePlan.name} ${name}`,
        size: sourcePlan.size,
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
        size: zippedSize(left.plan.size, right.plan.size),
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
    if (value.plan.size.kind === 'infinite') {
        throw new RankError(`${operation} requires a bounded sequence`);
    }
    return { [Symbol.iterator]: () => value.plan.iterate() };
}

export function reduceSequence(value: RankSequence, operation: string): RankValue | undefined {
    return value.plan.reduce?.(operation);
}

function filteredSize(size: SequenceSize): SequenceSize {
    return size.kind === 'infinite' ? size : { kind: 'unknown' };
}

function zippedSize(left: SequenceSize, right: SequenceSize): SequenceSize {
    if (left.kind === 'exact' && right.kind === 'exact') {
        return { kind: 'exact', value: left.value < right.value ? left.value : right.value };
    }
    if (left.kind === 'exact' && right.kind === 'infinite') return left;
    if (right.kind === 'exact' && left.kind === 'infinite') return right;
    if (left.kind === 'infinite' && right.kind === 'infinite') return left;
    return { kind: 'unknown' };
}
