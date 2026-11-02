import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, parse } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/336_maximix.ra', import.meta.url), 'utf8');
const program = parse(source);
const helpers = { ...program, statements: program.statements.filter(statement =>
    statement.$type === 'UseStatement' || statement.$type === 'FunctionStatement') };

// Forward sorting is independent of the demo's backward construction.
function maximixOrders(n: number): string[] {
    const result: string[] = [];
    const word = Array.from({ length: n }, (_, i) => i);
    function visit(position: number): void {
        if (position === n) {
            const sorted = [...word];
            let reversals = 0;
            for (let i = 0; i < n - 1; i++) {
                const j = sorted.indexOf(i);
                if (j === i) continue;
                if (j !== n - 1) {
                    sorted.splice(j, n - j, ...sorted.slice(j).reverse());
                    reversals++;
                }
                sorted.splice(i, n - i, ...sorted.slice(i).reverse());
                reversals++;
            }
            if (reversals === 2 * n - 3) result.push(word.map(i => String.fromCharCode(65 + i)).join(''));
            return;
        }
        for (let j = position; j < n; j++) {
            [word[position], word[j]] = [word[j], word[position]];
            visit(position + 1);
            [word[position], word[j]] = [word[j], word[position]];
        }
    }
    visit(0);
    return result.sort();
}
const expected = Array.from({ length: 7 }, (_, i) => maximixOrders(i + 2));

describe.each([false, true])('Euler 336 (compilation=%s)', compilation => {
    it('matches all small ranks and both ends of the larger ordering', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram(helpers, []);
            for (let n = 2; n <= 8; n++) {
                const words = expected[n - 2];
                const ranks = n <= 7 ? words.map((_, i) => i + 1) : [1, 2, words.length / 2, words.length];
                for (const rank of ranks) expect(runtime.execute(`${n} maximix ${rank}`), `${n}/${rank}`).toBe(words[rank - 1]);
            }
            expect(runtime.execute('6 maximix 10')).toBe('DFAECB');
        } finally { runtime.dispose(); }
    });

    it('rejects ranks outside the generated ordering', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram(helpers, []);
            for (const n of [2, 3, 6, 8]) {
                const count = expected[n - 2].length;
                for (const rank of [-1, 0, count + 1, count + 99]) {
                    expect(() => runtime.execute(`${n} maximix ${rank}`)).toThrow();
                }
            }
        } finally { runtime.dispose(); }
    });

    it('preserves Unicode suffix reversal at every code-point boundary', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram(helpers, []);
            for (const text of ['', 'ABC', 'A😀é', '\ud800X\udfff']) {
                const points = [...text];
                for (let i = 0; i <= points.length; i++) {
                    expect(runtime.execute(`"${text}" revsuffix ${i}`))
                        .toBe(points.slice(0, i).join('') + points.slice(i).reverse().join(''));
                }
            }
        } finally { runtime.dispose(); }
    });
});

it('solves the full maximix order with compiled text-array generation', () => {
    const runtime = new Interpreter(() => {});
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.executeProgram(helpers, []);
        expect(diagnostics.run(() => runtime.execute('11 maximix 2011'))).toBe('CAGBIHEFJDK');
        expect(diagnostics.compiledLoops).toBeGreaterThan(0);
        expect(diagnostics.cowCopies).toBe(0);
    } finally { runtime.dispose(); }
});
