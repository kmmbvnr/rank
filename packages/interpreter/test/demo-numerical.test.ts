import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isNativeFunction, isRankQueue, type RankArray } from '../src/index.js';
import { createArraySnapshot } from '../src/array-storage.js';

describe('numerical demo host oracles', () => {
    it('returns a distance matrix from the unchanged Cody pair-distances demo', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(readFileSync(new URL('../../../demos/cody/43007_pd.ra', import.meta.url), 'utf8'));
            const fn = runtime.variables.get('pair_distances');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing demo function');
            const points: RankArray = { kind: 'array', items: [0n, 0n, 3n, 4n, 0n, 4n], shape: [3, 2] };
            const result = fn.call([points]);
            expect(result).toMatchObject({ kind: 'array', shape: [3, 3] });
            if (!result || typeof result !== 'object' || result.kind !== 'array') throw new Error('expected array');
            expect(result.items).toEqual([0, 5, 4, 5, 0, 3, 4, 3, 0]);
        } finally { runtime.dispose(); }
    });

    it('returns scalar dot products for each matrix row in DeepML 001', () => {
        const runtime = new Interpreter();
        runtime.execute(readFileSync(new URL('../../../demos/deepml/001_matmul.ra', import.meta.url), 'utf8'));
        const fn = runtime.variables.get('matrix_dot_vector');
        if (!fn || !isNativeFunction(fn)) throw new Error('missing demo function');
        const array = (items: bigint[], shape: number[]): RankArray => ({ kind: 'array', items, shape });
        for (const [matrix, vector, shape, expected] of [
            [[1n, 2n, 2n, 4n], [1n, 2n], [2, 2], [5n, 10n]],
            [[1n, 2n, 3n, 4n, 5n, 6n], [2n, 0n, -1n], [2, 3], [-1n, 2n]],
        ] as const) {
            const result = fn.call([array([...matrix], [...shape]), array([...vector], [vector.length])]);
            if (!isRankQueue(result)) throw new Error('expected queue');
            expect(result.items).toEqual(expected);
        }
        runtime.dispose();
    });

    it('keeps the CSES maximum-subarray result across cached compiled entries and a changed array', () => {
        const source = readFileSync(new URL('../../../demos/cses/sortnsrch/008_maxsubarray.ra', import.meta.url), 'utf8');
        const definition = source.slice(source.indexOf('fun max_subarray'));
        const results = [false, true].map(integerLoopCompilation => {
            const runtime = new Interpreter(undefined, { integerLoopCompilation });
            const stats = new RuntimeDiagnostics();
            try {
                runtime.execute(definition);
                const fn = runtime.variables.get('max_subarray');
                if (!fn || !isNativeFunction(fn)) throw new Error('missing demo function');
                const input = createArraySnapshot([-2n, 1n, -3n, 4n, -1n, 2n, 1n, -5n, 4n]);
                const first = stats.run(() => fn.call([input]));
                const second = stats.run(() => fn.call([input]));
                input.items[3] = 10n;
                const changed = stats.run(() => fn.call([input]));
                return { first, second, changed, scans: stats.loopElementScans, loops: stats.compiledLoops };
            } finally { runtime.dispose(); }
        });
        expect(results[0]).toMatchObject({ first: 6n, second: 6n, changed: 12n });
        expect({ ...results[1], scans: 0, loops: 0 }).toEqual(results[0]);
        expect(results[1]).toMatchObject({ scans: 2, loops: 3 });
    });
});
