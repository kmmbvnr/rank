import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, parse } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/337_totientstairs.ra', import.meta.url), 'utf8');
const program = parse(source);
const helpers = { ...program, statements: program.statements.filter(statement =>
    statement.$type === 'UseStatement' || statement.$type === 'FunctionStatement') };

// Direct coprime counting and predecessor enumeration share neither the
// demo's sieve nor its Fenwick tree, parity compression or reused storage.
function prefixCounts(limit: number): bigint[] {
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    const phi = Array.from({ length: limit + 1 }, (_, n) => {
        let count = 0;
        for (let k = 1; k <= n; k++) if (gcd(n, k) === 1) count++;
        return count;
    });
    const ways = Array<bigint>(limit + 1).fill(0n);
    for (let n = 6; n <= limit; n++) {
        if (n === 6) { ways[n] = 1n; continue; }
        for (let k = phi[n] + 1; k < n; k++) {
            if (phi[k] < phi[n]) ways[n] = (ways[n] + ways[k]) % 100000000n;
        }
    }
    let sum = 0n;
    return ways.map(value => sum = (sum + value) % 100000000n);
}
const expected = prefixCounts(300);

describe.each([false, true])('Euler 337 (compilation=%s)', compilation => {
    it('matches every direct prefix through 200 and odd/even larger bounds', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram(helpers, []);
            for (const limit of [...Array.from({ length: 201 }, (_, n) => n), 255, 256, 257, 299, 300]) {
                expect(runtime.execute(`${limit} stairs`), `Limit=${limit}`).toBe(expected[limit]);
            }
        } finally { runtime.dispose(); }
    });

    it('keeps repeated solves independent and matches the supplied checkpoints', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram(helpers, []);
            runtime.execute('Saved = 100 stairs');
            expect(runtime.execute('10 stairs')).toBe(4n);
            expect(runtime.execute('10000 stairs')).toBe(73808307n);
            expect(runtime.execute('Saved')).toBe(82073668n);
            expect(runtime.execute('1 stairs')).toBe(0n);
            expect(runtime.execute('6 stairs')).toBe(1n);
            expect(runtime.execute('100 stairs')).toBe(82073668n);
        } finally { runtime.dispose(); }
    });
});

it('solves the default input in one private numeric region with compact storage', () => {
    const output: string[] = [];
    const runtime = new Interpreter(text => output.push(text.trim()));
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.executeProgram(program, []));
        expect(output.at(-1)).toBe('85068035');
        expect(runtime.variables.get('Answer')).toBe(85068035n);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.cowCopies).toBe(0);
        expect(diagnostics.typedUnpacks).toBe(0);
        expect(diagnostics.typedArrayPublishedCells).toBeLessThanOrEqual(30000003);
    } finally { runtime.dispose(); }
}, 20000);
