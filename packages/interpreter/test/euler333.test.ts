import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, parse } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/333_specialpartitions.ra', import.meta.url), 'utf8');
const program = parse(source);
const helpers = { ...program, statements: program.statements.filter(statement =>
    statement.$type === 'UseStatement' || statement.$type === 'FunctionStatement') };

// Enumerate increasing powers of two and strictly decreasing powers of three,
// independently of the demo's parity recurrence. Include the empty partition.
function enumerate(limit: number): bigint[] {
    const counts = Array<bigint>(limit).fill(0n);
    if (!limit) return counts;
    const max = Math.floor(Math.log2(limit));
    function walk(i: number, j: number, sum: number): void {
        if (i > max) { counts[sum]++; return; }
        walk(i + 1, j, sum);
        let value = 2 ** i;
        for (let k = 0; k < j && sum + value < limit; k++, value *= 3) {
            walk(i + 1, k, sum + value);
        }
    }
    walk(0, 1000, 0);
    return counts;
}

describe.each([false, true])('Euler 333 layered counts (compilation=%s)', compilation => {
    it('matches every enumerated count around powers of two and three', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const reference = enumerate(1001);
        try {
            runtime.executeProgram(helpers, []);
            for (const limit of [0, 1, 2, 3, 4, 8, 9, 10, 26, 27, 28, 31, 32, 33, 80, 81, 82, 99, 100, 101, 999, 1000, 1001]) {
                const counts = runtime.execute(`${limit} partitioncounts`);
                if (counts === undefined || !isRankArray(counts)) throw new Error('missing counts');
                expect(counts.shape).toEqual([limit]);
                expect([...counts.items]).toEqual(reference.slice(0, limit));
            }
        } finally { runtime.dispose(); }
    });

    it('keeps saved results and repeated solves independent without CoW copies', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.executeProgram(helpers, []);
            diagnostics.run(() => runtime.execute('Saved = 1000 partitioncounts\nAgain = 1000 partitioncounts'));
            expect(diagnostics.cowCopies).toBe(0);
            expect(runtime.variables.get('Saved')).not.toBe(runtime.variables.get('Again'));
            expect(runtime.execute('Saved 100')).toBe(enumerate(101)[100]);
            runtime.execute('Again 100 = 0');
            expect(runtime.execute('Saved 100')).toBe(enumerate(101)[100]);
            expect(runtime.execute('0 solve')).toBe(0n);
            expect(runtime.execute('100 solve')).toBe(233n);
            expect(runtime.execute('1000 solve')).toBe(4600n);
            expect(runtime.execute('100 solve')).toBe(233n);
        } finally { runtime.dispose(); }
    });
});
