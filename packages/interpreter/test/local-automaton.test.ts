import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction } from '../src/index.js';

const source = readFileSync(new URL('../../language/test/fixtures/305_local_automaton.ra', import.meta.url), 'utf8');

for (const compilation of [false, true]) describe(`Euler 305 local automaton (compiled=${compilation})`, () => {
    it('matches known positions and keeps engine state separate between parent calls', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(source);
            const solve = runtime.variables.get('solve');
            if (!solve || !isNativeFunction(solve)) throw new Error('missing solve function');
            // Independent oracle: scan the literal concatenation of integers.
            const digits = Array.from({ length: 1000 }, (_, index) => String(index + 1)).join('');
            for (const [need, position] of [[3, 37], [5, 81], [12, 271], [3, 37]]) {
                let offset = -1;
                for (let occurrence = 0; occurrence < need; occurrence++) offset = digits.indexOf(String(need), offset + 1);
                expect(offset + 1).toBe(position);
                expect(solve.call([BigInt(need)])).toBe(BigInt(position));
            }
            for (const name of ['State', 'PatternHits', 'PatternNext', 'id', 'block', 'partial', 'nth']) {
                expect(runtime.variables.has(name)).toBe(false);
            }
        } finally { runtime.dispose(); }
    });
});
