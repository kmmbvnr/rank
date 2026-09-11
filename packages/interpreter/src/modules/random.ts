import { RankError } from '../errors.js';
import { sequenceValues } from '../sequence.js';
import {
    isRankArray,
    isRankSequence,
    type RankArray,
    type RankValue,
} from '../value.js';
import { expectInteger, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const randomModule: RuntimeModule = {
    seed: context => native('seed', 1, arguments_ => {
        const value = arguments_[0];
        if (typeof value !== 'bigint') {
            throw new RankError('seed expects an integer');
        }
        context.seedRandom(value);
        return value;
    }),
    shuffle: context => native('shuffle', [1, 2], arguments_ => shuffleValue(
        arguments_[0],
        arguments_[1],
        0,
        context.random,
    )),
    choices: context => native('choices', 2, arguments_ => choicesValue(
        arguments_[0],
        arguments_[1],
        context.random,
    )),
    uniform: context => native('uniform', 3, arguments_ => uniformValue(
        arguments_[0],
        arguments_[1],
        arguments_[2],
        context.random,
    )),
};

/** Fill an eager tensor from a continuous uniform distribution. */
export function uniformValue(
    shapeValue: RankValue,
    lowValue: RankValue,
    highValue: RankValue,
    random: () => number = Math.random,
): RankArray {
    if (!isRankArray(shapeValue) || shapeValue.shape.length !== 1) {
        throw new RankError('uniform shape must be a rank-1 integer array');
    }
    const shape = Array.from({ length: shapeValue.shape[0] }, (_, index) => {
        const value = shapeValue.itemAt?.(index) ?? shapeValue.items[index];
        if (typeof value !== 'bigint') {
            throw new RankError('uniform shape must be a rank-1 integer array');
        }
        if (value < 0n) {
            throw new RankError(`uniform dimension must be nonnegative: ${value}`);
        }
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError(`uniform dimension is too large: ${value}`);
        }
        return Number(value);
    });
    const low = finiteBound(lowValue, 'lower');
    const high = finiteBound(highValue, 'upper');
    if (low > high) {
        throw new RankError('uniform lower bound must not exceed upper bound');
    }
    const size = uniformSize(shape);
    const width = high - low;
    const items = Array.from({ length: size }, () => low + random() * width);
    return { kind: 'array', items, shape };
}

function finiteBound(value: RankValue, side: string): number {
    if (typeof value !== 'bigint' && typeof value !== 'number') {
        throw new RankError(`uniform ${side} bound must be numeric`);
    }
    const result = Number(value);
    if (!Number.isFinite(result)) {
        throw new RankError(`uniform ${side} bound must be finite`);
    }
    return result;
}

function uniformSize(shape: readonly number[]): number {
    let size = 1;
    for (const dimension of shape) {
        if (dimension !== 0 && size > 0xffffffff / dimension) {
            throw new RankError('uniform shape is too large');
        }
        size *= dimension;
    }
    return size;
}

/** Draw complete leading-axis cells independently with replacement. */
export function choicesValue(
    value: RankValue,
    countValue: RankValue,
    random: () => number = Math.random,
): RankArray {
    const source = randomSource(value, 'choices');
    const integer = expectInteger(countValue);
    if (integer < 0n) throw new RankError('choices count must be nonnegative');
    if (integer > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError(`choices count is too large: ${integer}`);
    }
    const count = Number(integer);
    const axisSize = source.shape[0];
    if (count > 0 && axisSize === 0) {
        throw new RankError('choices cannot draw from an empty input');
    }

    const cellShape = source.shape.slice(1);
    const cellSize = cellShape
        .reduce((product, dimension) => product * dimension, 1);
    const items: RankValue[] = [];
    for (let draw = 0; draw < count; draw += 1) {
        const sourceCell = Math.floor(random() * axisSize);
        const start = sourceCell * cellSize;
        for (let offset = 0; offset < cellSize; offset += 1) {
            const index = start + offset;
            items.push(source.itemAt?.(index) ?? source.items[index]);
        }
    }
    return { kind: 'array', items, shape: [count, ...cellShape] };
}

/** Return an eager copy with complete cells reordered along one axis. */
export function shuffleValue(
    value: RankValue,
    seed?: RankValue,
    axis = 0,
    defaultRandom: () => number = Math.random,
): RankArray {
    const source = randomSource(value, 'shuffle');
    if (axis < 0 || axis >= source.shape.length) {
        throw new RankError(`shuffle axis out of bounds: ${axis}`, 'DimensionMismatch');
    }

    const random = seed === undefined ? defaultRandom : randomFromSeed(expectSeed(seed));
    const order = Array.from({ length: source.shape[axis] }, (_, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [order[index], order[other]] = [order[other], order[index]];
    }

    const stride = source.shape
        .slice(axis + 1)
        .reduce((product, dimension) => product * dimension, 1);
    const axisSize = source.shape[axis];
    const size = source.shape.reduce((product, dimension) => product * dimension, 1);
    const items = Array.from({ length: size }, (_, outputIndex) => {
        const coordinate = Math.floor(outputIndex / stride) % axisSize;
        const sourceCoordinate = order[coordinate];
        const sourceIndex = outputIndex + (sourceCoordinate - coordinate) * stride;
        return source.itemAt?.(sourceIndex) ?? source.items[sourceIndex];
    });
    return { kind: 'array', items, shape: [...source.shape] };
}

function randomSource(value: RankValue, operation: string): RankArray {
    if (typeof value === 'object' && value.kind === 'array') return value;
    if (isRankSequence(value)) {
        const items = [...sequenceValues(value, operation)];
        return { kind: 'array', items, shape: [items.length] };
    }
    throw new RankError(`${operation} expects an array or finite sequence`);
}

function expectSeed(seed: RankValue): bigint {
    if (typeof seed !== 'bigint') throw new RankError('shuffle seed must be an integer');
    return seed;
}

export function randomFromSeed(seed: bigint): () => number {
    let state = Number(BigInt.asUintN(32, seed));
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 0x100000000;
    };
}
