import { RankError } from '../errors.js';
import { reduceSequence, sequence, sequenceMask, sequenceValues } from '../sequence.js';
import {
    isRankArray,
    isRankSequence,
    type RankValue,
    type SequencePlan,
    type SequencePredicate,
} from '../value.js';
import { expectInteger, mapValue, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const numbersModule: RuntimeModule = {
    sum: () => native('sum', 1, arguments_ => {
        const value = arguments_[0];
        if (isRankSequence(value)) {
            const planned = reduceSequence(value, 'sum');
            if (planned !== undefined) return expectInteger(planned);
        }
        const items = isRankArray(value) ? value.items : sequenceValues(value, 'sum');
        let total = 0n;
        for (const item of items) total += expectInteger(item);
        return total;
    }),
    max: () => native('max', 1, arguments_ => {
        const value = arguments_[0];
        if (isRankSequence(value)) {
            const planned = reduceSequence(value, 'max');
            if (planned !== undefined) return expectInteger(planned);
        }
        const items = isRankArray(value) ? value.items : sequenceValues(value, 'max');
        let largest: bigint | undefined;
        for (const item of items) {
            const integer = expectInteger(item);
            if (largest === undefined || integer > largest) largest = integer;
        }
        if (largest === undefined) throw new RankError('max requires at least one value');
        return largest;
    }),
    gcd: () => native('gcd', 2, arguments_ =>
        greatestCommonDivisor(expectInteger(arguments_[0]), expectInteger(arguments_[1]))),
    lcm: () => native('lcm', [1, 2], arguments_ => {
        if (arguments_.length === 2) {
            return leastCommonMultiple(
                expectInteger(arguments_[0]),
                expectInteger(arguments_[1]),
            );
        }
        const value = arguments_[0];
        const items = isRankArray(value) ? value.items : sequenceValues(value, 'lcm');
        let result = 1n;
        for (const item of items) result = leastCommonMultiple(result, expectInteger(item));
        return result;
    }),
    factors: () => native('factors', 1, arguments_ => {
        const value = expectInteger(arguments_[0]);
        if (value < 1n) throw new RankError('factors expects a positive integer');
        return sequence(factorPlan(value));
    }),
    odd: () => predicateFunction('odd', value => expectInteger(value) % 2n !== 0n),
    even: () => predicateFunction('even', value => expectInteger(value) % 2n === 0n),
};

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
    let a = absolute(left);
    let b = absolute(right);
    while (b !== 0n) [a, b] = [b, a % b];
    return a;
}

function leastCommonMultiple(left: bigint, right: bigint): bigint {
    if (left === 0n || right === 0n) return 0n;
    return absolute(left / greatestCommonDivisor(left, right) * right);
}

function absolute(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function factorPlan(value: bigint): SequencePlan {
    return {
        name: `factors of ${value}`,
        size: { kind: 'unknown' },
        *iterate() {
            let remaining = value;
            for (let divisor = 2n; divisor * divisor <= remaining; divisor += divisor === 2n ? 1n : 2n) {
                while (remaining % divisor === 0n) {
                    yield divisor;
                    remaining /= divisor;
                }
            }
            if (remaining > 1n) yield remaining;
        },
    };
}

function predicateFunction(name: string, test: (value: RankValue) => boolean) {
    const predicate: SequencePredicate = { name, optimizationKey: name, test };
    return native(name, 1, arguments_ => {
        const value = arguments_[0];
        return isRankSequence(value)
            ? sequenceMask(value, predicate)
            : mapValue(value, test);
    });
}
