import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/526_largestprime.ra', import.meta.url), 'utf8');
const definitions = source.slice(0, source.indexOf('\nAnswer ='));
// Independent exhaustive largest-prime-factor sieve, without residue pruning,
// primality assumptions, Rank array operations or the demo's bounding argument.
function maxima(limit: number) {
    const factors = new Uint32Array(limit + 9), result = new Uint32Array(limit + 1);
    for (let prime = 2; prime < factors.length; prime++) {
        if (factors[prime]) continue;
        for (let n = prime; n < factors.length; n += prime) factors[n] = prime;
    }
    let score = 0, best = 0;
    for (let n = 2; n <= 10; n++) score += factors[n];
    for (let n = 2; n <= limit; n++) {
        best = Math.max(best, score);
        result[n] = best;
        score += factors[n + 9] - factors[n];
    }
    return result;
}
const expected = maxima(1_000_000);
const modes = [{ name: 'Number', options: {} },
    { name: 'exact compiled', options: { numberLoopCompilation: false } },
    { name: 'reference', options: { compilation: false } }];
describe.each(modes)('Euler 526 $name', ({ options }) => {
    it('matches an exhaustive oracle at the small-search and wheel boundaries', () => {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.execute(definitions);
            const solve = runtime.variables.get('solve');
            if (!solve || !isNativeFunction(solve)) throw new Error('missing solve');
            for (const limit of [0, 1, 2, 3, 9, 100, 9999, 10000, 10001,
                20003, 720719, 720720, 720721, 1000000]) {
                expect(solve.call([BigInt(limit)]), `L=${limit}`).toBe(BigInt(expected[limit]));
            }
        } finally { runtime.dispose(); }
    }, 120_000);
    it.each([[1_000_000_000n, 4896292593n], [100_000_000_000n, 491010576113n]])(
        'finds the exact maximum at %s rather than only the favored prime pattern', (limit, answer) => {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--l=${limit}`] });
            try {
                runtime.execute(source);
                expect(answerOf(runtime)).toBe(answer);
            } finally { runtime.dispose(); }
        }, 120_000);
});

it('certifies the full Euler 526 maximum with exact wide bounds', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(source);
        expect(answerOf(runtime)).toBe(49601160286750947n);
    } finally { runtime.dispose(); }
}, 120_000);
