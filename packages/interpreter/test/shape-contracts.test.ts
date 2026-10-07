import { describe, expect, it } from 'vitest';
import { findOperation, instantiateShapeSignature, operations, type KnownShape } from '@arrrank/language';
import { derivedArray, ownedArray } from '../src/array-storage.js';
import { RankDsu } from '../src/dsu.js';
import { RankFunctionalGraph } from '../src/functional-graph.js';
import { RankMultiset } from '../src/multiset.js';
import { RankRangeSumSegment } from '../src/segment.js';
import { RankWavelet } from '../src/wavelet.js';
import { sequence } from '../src/sequence.js';
import { standardModules } from '../src/modules/index.js';
import { isNativeFunction, isRankArray, isRankSequence, type RankValue } from '../src/value.js';

const vector = (...values: RankValue[]) => ownedArray(values);
const matrix = ownedArray([2n, 0n, 0n, 4n], [2, 2]);
const moment: RankValue = { kind: 'datetime', year: 2026, month: 9, day: 28, hour: 12, minute: 30, second: 45 };
const descending: RankValue = { kind: 'label', name: 'descending' };
const file: RankValue = { kind: 'file', closed: false, handle: {
    name: 'fixture', read: () => new Uint8Array(), write: () => undefined, seek: () => undefined,
    position: () => 0, size: () => 3, flush: () => undefined, close: () => undefined,
} };

// Factories keep mutable receivers independent. The last field is the actual
// logical result shape, measured from headers without enumerating lazy values.
type Sample = readonly [string, () => RankValue[], KnownShape];
const samples: readonly Sample[] = [
    ...['ceiling', 'floor', 'lowerbound', 'upperbound'].map((name): Sample =>
        [`algo.${name}`, () => [new RankMultiset().add(1n).add(5n), 3n], []]),
    ['algo.firstatleast', () => [new RankRangeSumSegment([1n, 2n, 3n]), 3n], []],
    ['algo.missing', () => [new RankWavelet(vector(1n, 2n, 4n)), vector(0n, 2n)], []],
    ['algo.permutations', () => [vector(1n, 2n, 3n)], [6]],
    ['algo.permutations', () => [vector(1n, 1n, 1n)], [1]],
    ['algo.permutations', () => [vector()], [1]],
    ...['band', 'bor', 'bxor', 'shl', 'shr', 'bit'].map(name =>
        [`bits.${name}`, () => [3n, 1n], []] as Sample),
    ...['bnot', 'popcount'].map(name => [`bits.${name}`, () => [3n], []] as Sample),
    ['bits.binary', () => [3n], [2]],
    ['bits.binary', () => [3n, 4n], [4]],
    ...['day', 'hour', 'minute', 'month', 'second', 'weekday', 'year'].map(name =>
        [`dates.${name}`, () => [moment], []] as Sample),
    ['dates.seconds', () => [{ kind: 'duration', seconds: 90n }], []],
    ['graph.findroot', () => [new RankDsu(true), 1n], []],
    ['graph.connected', () => [new RankDsu(true), 'a', 'b'], []],
    ['graph.lengths', () => [new RankFunctionalGraph(vector(2n, 1n))], [2]],
    ['grids.neighbors', () => [matrix, 0n, 0n], [2, 2]],
    ['grids.neighbors', () => [matrix, 0n, 0n, { kind: 'label', name: 'eight' }], [3, 2]],
    ['grids.neighbors', () => [ownedArray([1n], [1, 1]), 0n, 0n], [0, 2]],
    ...['eof', 'position', 'size'].map(name => [`io.${name}`, () => [file], []] as Sample),
    ['linalg.det', () => [matrix], []],
    ['linalg.diag', () => [matrix], [2]],
    ['linalg.diag', () => [vector(1n, 2n, 3n)], [3, 3]],
    ['linalg.eigh', () => [matrix], []],
    ['linalg.matmul', () => [vector(1n, 2n), vector(3n, 4n)], []],
    ['linalg.matmul', () => [matrix, matrix], [2, 2]],
    ['linalg.matmul', () => [ownedArray(Array(24).fill(1n), [2, 3, 4]),
        ownedArray(Array(120).fill(1n), [4, 5, 6])], [2, 3, 5, 6]],
    ['linalg.inverse', () => [matrix], [2, 2]],
    ['linalg.solve', () => [matrix, vector(4n, 8n)], [2]],
    ['linalg.solve', () => [matrix, matrix], [2, 2]],
    ['numbers.abs', () => [-2n], []],
    ['numbers.atan2', () => [1n, 2n], []],
    ['numbers.binomial', () => [5n, 2n], []],
    ['numbers.binomialmod', () => [5n, 2n, 7n], []],
    ['numbers.divisors', () => [12n], [null]],
    ['numbers.gcd', () => [6n, 4n], []],
    ['numbers.isqrt', () => [9n], []],
    ['numbers.lcm', () => [vector(6n, 4n)], []],
    ['numbers.lcm', () => [6n, 4n], []],
    ...['max', 'min'].flatMap(name => [
        [`core.${name}`, () => [matrix], []],
        [`core.${name}`, () => [1n, 2n], []],
    ] as Sample[]),
    ['numbers.powmod', () => [2n, 3n, 5n], []],
    ['numbers.round', () => [matrix, 0n], [2, 2]],
    ['numbers.round', () => [ownedArray([], [0, 3]), 0n], [0, 3]],
    ['numbers.sqrt', () => [4n], []],
    ['core.sum', () => [matrix], []],
    ['core.sum', () => [vector()], []],
    ['random.seed', () => [42n], []],
    ...['all', 'any', 'count'].flatMap(name => [
        [`sequences.${name}`, () => [vector(true, false)], []],
        [`sequences.${name}`, () => [vector()], []],
    ] as Sample[]),
    ...['sort', 'argsort'].flatMap(name => [
        [`sequences.${name}`, () => [vector(3n, 1n, 2n)], [3]],
        [`sequences.${name}`, () => [vector(3n, 1n, 2n), descending], [3]],
        [`sequences.${name}`, () => [vector()], [0]],
        [`sequences.${name}`, () => ['cba'], [3]],
    ] as Sample[]),
    ['sequences.find', () => [vector(1n, 2n), 2n], []],
    ['sequences.findall', () => [vector(1n, 2n, 1n), 1n], [2]],
    ['text.join', () => [vector('a', 'b'), ','], [3]],
    ['sequences.unique', () => [vector(1n, 1n, 1n)], [1]],
    ['sequences.unique', () => [vector(1n, 2n, 3n)], [3]],
    ['sequences.unique', () => [vector()], [0]],
    ['stats.percentile', () => [vector(1n, 3n)], []],
    ['stats.percentile', () => [vector(1n, 3n), 50n], []],
    ['stats.quantile', () => [vector(1n, 3n)], []],
    ['stats.quantile', () => [vector(1n, 3n), 0.5], []],
    ['text.codepoint', () => ['a'], []],
    ['core.integer', () => ['12'], []],
    ['core.real', () => [2n], []],
    ['text.split', () => ['a,b,c', ','], [3]],
    ['text.split', () => ['', ','], [1]],
];

const shape = (value: RankValue): KnownShape => isRankArray(value) ? value.shape
    : isRankSequence(value) ? [value.plan.size.kind === 'exact' ? Number(value.plan.size.value) : null]
    : typeof value === 'string' ? [[...value].length] : [];

function builtin(key: string) {
    const [module, name] = key.split('.');
    const fn = standardModules[module][name]({
        output: () => undefined, random: () => 0.5, seedRandom: () => undefined, ownFile: () => undefined,
    });
    if (!isNativeFunction(fn)) throw new Error('expected builtin');
    return fn;
}

describe('builtin shape postconditions', () => {
    it('exercises every declared signature arity', () => {
        const covered = new Set(samples.map(([key, args]) => `${key}/${args().length}`));
        const missing = operations.flatMap(operation => (operation.shape ?? []).map(signature =>
            `${operation.module}.${operation.name}/${signature.args.length}`)).filter(key => !covered.has(key));
        expect(missing).toEqual([]);
    });

    it.each(samples)('%s agrees with its signature on a real call', (key, makeArgs, expected) => {
        const [, name] = key.split('.');
        const args = makeArgs();
        const signature = findOperation(name)!.shape!.find(candidate => candidate.args.length === args.length)!;
        const predicted = instantiateShapeSignature(signature, args.map(shape));
        const actual = shape(builtin(key).call(args));
        expect(actual).toEqual(expected);
        if (signature.result === null) expect(predicted).toBeUndefined();
        else {
            expect(predicted).toBeDefined();
            expect(actual.length).toBe(predicted!.length);
            predicted!.forEach((n, axis) => { if (n !== null) expect(actual[axis]).toBe(n); });
        }
    });

    it('checks lazy array and sequence shapes without reading their cells', () => {
        let reads = 0;
        const values = [1.25, 2.75];
        const array = derivedArray([2], [], i => { reads++; return values[i]; });
        const source = sequence({ name: 'probe', size: { kind: 'exact', value: 2n },
            *iterate() { reads++; yield* values; } });
        for (const input of [array, source]) {
            const signature = findOperation('round')!.shape![0];
            const predicted = instantiateShapeSignature(signature, [shape(input), []]);
            expect(shape(builtin('numbers.round').call([input, 0n]))).toEqual(predicted);
        }
        expect(reads).toBe(0);
    });
});
