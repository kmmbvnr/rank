import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction, isRankQueue, type RankArray } from '../src/index.js';

describe('numerical demo host oracles', () => {
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
});
