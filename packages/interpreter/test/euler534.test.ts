import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/534_weakqueens.ra', import.meta.url), 'utf8');
// Independent board enumeration: compare columns and distances directly.
// No masks, packed histories, symmetry or state merging.
function counts(size: number): bigint[] {
    const values = [BigInt(size) ** BigInt(size)];
    for (let depth = 1; depth < size; depth++) {
        const columns: number[] = [];
        function visit(): bigint {
            const row = columns.length;
            if (row === size) return 1n;
            let total = 0n;
            for (let column = 0; column < size; column++) {
                let allowed = true;
                for (let previous = Math.max(0, row - depth); previous < row; previous++) {
                    const distance = Math.abs(column - columns[previous]);
                    if (distance === 0 || distance === row - previous) { allowed = false; break; }
                }
                if (allowed) { columns.push(column); total += visit(); columns.pop(); }
            }
            return total;
        }
        values.push(visit());
    }
    return values;
}
const expected = new Map(Array.from({ length: 7 }, (_, i) => [i + 1, counts(i + 1)]));
const probe = source.replace('Answer = N ** N', 'Answer = N ** N\nResults = array shape N fill 0\nResults 0 = Answer')
    .replace('    Answer += Totals sum', '    Counted = Totals sum\n    Results Depth = Counted\n    Answer += Counted');
describe.each([
    { name: 'Number', options: {} },
    { name: 'exact', options: { numberLoopCompilation: false } },
    { name: 'reference', options: { compilation: false } },
])('Euler 534 $name', ({ options }) => {
    it.each([...expected])('matches every reach on an N=%s board', (n, values) => {
        const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
        try {
            runtime.execute(probe);
            const actual = runtime.variables.get('Results');
            if (!actual || !isRankArray(actual)) throw Error('expected counts array');
            expect([...actual.items]).toEqual(values);
            expect(runtime.variables.get('Answer')).toBe(values.reduce((a, b) => a + b, 0n));
        } finally { runtime.dispose(); }
    });
});

it.each([
    { compilation: true },
    { compilation: true, numberLoopCompilation: false },
    { compilation: false },
])('matches a larger board with %j', options => {
    const runtime = new Interpreter(() => {}, { ...options, args: ['--n=10'] });
    try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(10570235486n); }
    finally { runtime.dispose(); }
});
it('retains the full wide total and the classical 14-queens endpoint', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(probe);
        const actual = runtime.variables.get('Results');
        if (!actual || !isRankArray(actual)) throw Error('expected counts array');
        expect(actual.items[13]).toBe(365596n);
        expect(runtime.variables.get('Answer')).toBe(11726115562784664n);
    } finally { runtime.dispose(); }
}, 120_000);
