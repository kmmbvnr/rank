import { RankError } from '../errors.js';
import { sequenceValues } from '../sequence.js';
import {
    isRankSequence,
    type RankArray,
    type RankValue,
} from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const randomModule: RuntimeModule = {
    shuffle: context => native('shuffle', [1, 2], arguments_ => shuffleValue(
        arguments_[0],
        arguments_[1],
        0,
        context.random,
    )),
};

/** Return an eager copy with complete cells reordered along one axis. */
export function shuffleValue(
    value: RankValue,
    seed?: RankValue,
    axis = 0,
    defaultRandom: () => number = Math.random,
): RankArray {
    const source = shuffleSource(value);
    if (axis < 0 || axis >= source.shape.length) {
        throw new RankError(`shuffle axis out of bounds: ${axis}`, 'DimensionMismatch');
    }

    const random = seed === undefined ? defaultRandom : seededRandom(seed);
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

function shuffleSource(value: RankValue): RankArray {
    if (typeof value === 'object' && value.kind === 'array') return value;
    if (isRankSequence(value)) {
        const items = [...sequenceValues(value, 'shuffle')];
        return { kind: 'array', items, shape: [items.length] };
    }
    throw new RankError('shuffle expects an array or finite sequence');
}

function seededRandom(seed: RankValue): () => number {
    if (typeof seed !== 'bigint') throw new RankError('shuffle seed must be an integer');
    let state = Number(BigInt.asUintN(32, seed));
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 0x100000000;
    };
}
