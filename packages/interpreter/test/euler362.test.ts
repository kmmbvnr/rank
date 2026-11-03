import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, isRankIndex } from '../src/index.js';

it('keeps the full Euler 362 answer without memoizing terminal factor states', () => {
    const runtime = new Interpreter(() => {});
    try {
        const source = readFileSync(new URL('../../../demos/euler/362_squarefree.ra', import.meta.url), 'utf8');
        expect(runtime.execute(source)).toBe(457895958010n);
        const cache = runtime.variables.get('C');
        expect(cache !== undefined && isRankIndex(cache)).toBe(true);
        if (cache !== undefined && isRankIndex(cache)) expect(cache.entries.size).toBeLessThan(600000);
    } finally { runtime.dispose(); }
}, 60_000);
