import { MissingValueError, RankError } from './errors.js';
import {
    compareOrderedValues,
    orderedKind,
    type OrderedKind,
} from './ordered.js';
import { ResourceSummary } from './resource-summary.js';
import {
    isRankArray,
    isRankQueue,
    isRankSequence,
    type RankValue,
} from './value.js';

interface WaveletLevel {
    readonly zeros: number;
    readonly prefixZeros: Int32Array;
    prefixSums?: Numeric[];
}

type Numeric = bigint | number;

/** An immutable wavelet matrix over comparable scalar values. */
export class RankWavelet {
    private readonly resources = new ResourceSummary();
    private readonly levels: WaveletLevel[] = [];
    private readonly sorted: RankValue[];
    private prefixSums?: Numeric[];
    private readonly numericValues?: Numeric[];
    private readonly positiveIntegers: boolean;
    private readonly valueKind?: OrderedKind;
    readonly kind = 'wavelet' as const;
    readonly size: number;

    constructor(value: RankValue) {
        const values = waveletValues(value);
        this.size = values.length;
        this.resources.track(this);
        this.valueKind = values.length > 0
            ? orderedKind(values[0]) : undefined;
        this.positiveIntegers = values.every(item =>
            typeof item === 'bigint'
                ? item > 0n
                : typeof item === 'number'
                    && Number.isInteger(item)
                    && item > 0);
        for (const item of values) {
            if (orderedKind(item) !== this.valueKind) {
                throw new RankError(
                    'wavelet values must have one comparable type',
                );
            }
        }

        const sorted = [...values].sort((a, b) =>
            this.compare(a, b));
        this.sorted = sorted.filter((item, index) =>
            index === 0
            || this.compare(sorted[index - 1], item) !== 0);

        if (this.valueKind === 'numeric') {
            this.numericValues = values as Numeric[];
        }

        let order = values.map(item =>
            lowerBound(this.sorted, item, this.compare.bind(this)));
        const bits = Math.ceil(
            Math.log2(Math.max(1, this.sorted.length)),
        );
        for (let bit = bits - 1; bit >= 0; bit -= 1) {
            const prefixZeros = new Int32Array(this.size + 1);
            const zeros: number[] = [];
            const ones: number[] = [];
            for (let index = 0; index < order.length; index += 1) {
                const rank = order[index];
                const zero = ((rank >>> bit) & 1) === 0;
                prefixZeros[index + 1] = prefixZeros[index]
                    + (zero ? 1 : 0);
                (zero ? zeros : ones).push(rank);
            }
            this.levels.push({
                zeros: zeros.length,
                prefixZeros,
            });
            order = zeros.concat(ones);
        }
    }

    sum(
        left: bigint,
        right: bigint,
        low: RankValue,
        high: RankValue,
    ): Numeric {
        const first = this.position(left);
        const last = this.position(right);
        if (first > last) {
            throw new RankError(
                'wavelet range start must not exceed its end',
            );
        }
        if (this.valueKind !== 'numeric') {
            throw new RankError(
                'sumwithin expects numeric wavelet values',
            );
        }
        this.ensureSums();
        if (this.compare(low, high) > 0) {
            throw new RankError(
                'wavelet value start must not exceed its end',
            );
        }
        const compare = this.compare.bind(this);
        const below = lowerBound(this.sorted, low, compare);
        const through = upperBound(this.sorted, high, compare);
        return subtractNumeric(
            this.sumLessThan(first, last + 1, through),
            this.sumLessThan(first, last + 1, below),
        );
    }

    missing(left: bigint, right: bigint): Numeric {
        const first = this.position(left);
        const last = this.position(right);
        if (first > last) {
            throw new RankError(
                'wavelet range start must not exceed its end',
            );
        }
        if (!this.positiveIntegers) {
            throw new RankError(
                'missing expects positive integer wavelet values',
            );
        }
        this.ensureSums();
        const compare = this.compare.bind(this);
        let reach: Numeric = 1n;
        while (true) {
            const through = upperBound(this.sorted, reach, compare);
            const total = this.sumLessThan(
                first, last + 1, through,
            );
            const next = addNumeric(total, 1n);
            if (next === reach) return reach;
            reach = next;
        }
    }

    count(
        left: bigint,
        right: bigint,
        low: RankValue,
        high: RankValue,
    ): bigint {
        const first = this.position(left);
        const last = this.position(right);
        if (first > last) {
            throw new RankError(
                'wavelet range start must not exceed its end',
            );
        }
        if (this.compare(low, high) > 0) {
            throw new RankError(
                'wavelet value start must not exceed its end',
            );
        }
        const compare = this.compare.bind(this);
        const below = lowerBound(this.sorted, low, compare);
        const through = upperBound(this.sorted, high, compare);
        return BigInt(
            this.lessThan(first, last + 1, through)
            - this.lessThan(first, last + 1, below),
        );
    }

    private lessThan(
        start: number,
        end: number,
        rank: number,
    ): number {
        if (rank <= 0) return 0;
        if (rank >= this.sorted.length) return end - start;
        let result = 0;
        for (let level = 0; level < this.levels.length; level += 1) {
            const data = this.levels[level];
            const leftZeros = data.prefixZeros[start];
            const rightZeros = data.prefixZeros[end];
            const bit = this.levels.length - level - 1;
            if (((rank >>> bit) & 1) === 0) {
                start = leftZeros;
                end = rightZeros;
            } else {
                result += rightZeros - leftZeros;
                start = data.zeros + start - leftZeros;
                end = data.zeros + end - rightZeros;
            }
        }
        return result;
    }

    private sumLessThan(
        start: number,
        end: number,
        rank: number,
    ): Numeric {
        if (rank <= 0) return 0n;
        if (rank >= this.sorted.length) {
            return subtractNumeric(
                this.prefixSums![end],
                this.prefixSums![start],
            );
        }
        let result: Numeric = 0n;
        for (let level = 0; level < this.levels.length; level += 1) {
            const data = this.levels[level];
            const leftZeros = data.prefixZeros[start];
            const rightZeros = data.prefixZeros[end];
            const bit = this.levels.length - level - 1;
            if (((rank >>> bit) & 1) === 0) {
                start = leftZeros;
                end = rightZeros;
            } else {
                result = addNumeric(result, subtractNumeric(
                    data.prefixSums![end],
                    data.prefixSums![start],
                ));
                start = data.zeros + start - leftZeros;
                end = data.zeros + end - rightZeros;
            }
        }
        return result;
    }

    private ensureSums(): void {
        if (this.prefixSums) return;
        let values = [...this.numericValues!];
        this.prefixSums = numericPrefix(values);
        for (const level of this.levels) {
            const prefix = Array<Numeric>(this.size + 1);
            prefix[0] = 0n;
            const zeros: Numeric[] = [];
            const ones: Numeric[] = [];
            for (let index = 0; index < values.length; index += 1) {
                const zero = level.prefixZeros[index + 1]
                    > level.prefixZeros[index];
                prefix[index + 1] = zero
                    ? addNumeric(prefix[index], values[index])
                    : prefix[index];
                (zero ? zeros : ones).push(values[index]);
            }
            level.prefixSums = prefix;
            values = zeros.concat(ones);
        }
    }

    private position(index: bigint): number {
        if (index < 0n || index >= BigInt(this.size)) {
            throw new MissingValueError(
                `wavelet index out of bounds: ${index}`,
            );
        }
        return Number(index);
    }

    private compare(left: RankValue, right: RankValue): number {
        const kind = this.valueKind ?? orderedKind(left);
        return compareOrderedValues(left, right, kind);
    }
}

function numericPrefix(values: readonly Numeric[]): Numeric[] {
    const prefix = Array<Numeric>(values.length + 1);
    prefix[0] = 0n;
    for (let index = 0; index < values.length; index += 1) {
        prefix[index + 1] = addNumeric(prefix[index], values[index]);
    }
    return prefix;
}

function addNumeric(left: Numeric, right: Numeric): Numeric {
    return typeof left === 'bigint' && typeof right === 'bigint'
        ? left + right
        : Number(left) + Number(right);
}

function subtractNumeric(left: Numeric, right: Numeric): Numeric {
    return typeof left === 'bigint' && typeof right === 'bigint'
        ? left - right
        : Number(left) - Number(right);
}

function waveletValues(value: RankValue): RankValue[] {
    if (isRankArray(value)) {
        if (value.shape.length !== 1) {
            throw new RankError('wavelet expects a rank-1 value');
        }
        return Array.from({ length: value.shape[0] }, (_, index) =>
            value.itemAt?.(index) ?? value.items[index]);
    }
    if (isRankQueue(value)) return [...value.items];
    if (typeof value === 'string') return [...value];
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError('wavelet requires a bounded sequence');
        }
        return [...value.plan.iterate()];
    }
    throw new RankError('wavelet expects a rank-1 value');
}

type Compare = (left: RankValue, right: RankValue) => number;

function lowerBound(
    values: readonly RankValue[],
    target: RankValue,
    compare: Compare,
): number {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (compare(values[middle], target) < 0) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function upperBound(
    values: readonly RankValue[],
    target: RankValue,
    compare: Compare,
): number {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (compare(values[middle], target) <= 0) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}
