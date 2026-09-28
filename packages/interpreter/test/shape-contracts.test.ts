import { describe, expect, it } from 'vitest';
import { findOperation, instantiateShapeSignature } from '@arrrank/language';
import { ownedArray } from '../src/array-storage.js';
import { standardModules } from '../src/modules/index.js';
import { isNativeFunction, isRankArray, type RankValue } from '../src/value.js';

const vector = (...values: bigint[]) => ownedArray(values);
const matrix = ownedArray([2n, 0n, 0n, 4n], [2, 2]);
const samples: readonly [string, RankValue[]][] = [
    ['sort', [vector(3n, 1n, 2n)]],
    ['sort', [vector()]],
    ['argsort', [vector(3n, 1n, 2n)]],
    ['unique', [vector(1n, 1n, 1n)]],
    ['unique', [vector(1n, 2n, 3n)]],
    ['unique', [vector()]],
    ['det', [matrix]],
    ['inverse', [matrix]],
    ['solve', [matrix, vector(4n, 8n)]],
    ['solve', [matrix, matrix]],
    ['sum', [matrix]],
    ['sum', [vector()]],
    ['round', [matrix, 0n]],
    ['integer', ['12']],
    ['real', [2n]],
    ['abs', [-2n]],
    ['bnot', [2n]],
    ['atan2', [1n, 2n]],
    ['max', [matrix]],
    ['max', [1n, 2n]],
    ['quantile', [vector(1n, 3n), 0.5]],
    ['split', ['a,b,c', ',']],
];

const shape = (value: RankValue): readonly number[] => isRankArray(value) ? value.shape
    : typeof value === 'string' ? [[...value].length] : [];

describe('builtin shape postconditions', () => {
    it.each(samples)('%s agrees with its signature on a real call', (name, args) => {
        const operation = findOperation(name)!;
        const signature = operation.shape!.find(candidate => candidate.args.length === args.length)!;
        expect(signature).toBeDefined();
        const predicted = instantiateShapeSignature(signature, args.map(shape));
        expect(predicted).toBeDefined();
        const fn = standardModules[operation.module][name]({
            output: () => undefined, random: () => 0.5, seedRandom: () => undefined, ownFile: () => undefined,
        });
        if (!isNativeFunction(fn)) throw new Error('expected builtin');
        const actual = shape(fn.call(args));
        expect(actual.length).toBe(predicted!.length);
        predicted!.forEach((n, axis) => { if (n !== null) expect(actual[axis]).toBe(n); });
    });
});
