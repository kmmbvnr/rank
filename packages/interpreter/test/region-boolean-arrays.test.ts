import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, isNativeFunction, isRankArray } from '../src/index.js';
import { arrayValues, derivedArray } from '../src/array-storage.js';

const head = 'use sequences\nA = (array 2 4 6 8)\nB = (array 10 20 30 40)\n';
function run(source: string, compiled = true) {
    const r = new Interpreter(() => {}, { integerLoopCompilation: compiled }), d = new RuntimeDiagnostics();
    try {
        return d.run(() => {
            const value = r.execute(source)!;
            return { result: isRankArray(value) ? { shape: value.shape, cells: [...arrayValues(value)] } : value,
                loops: d.compiledLoops };
        });
    } finally { r.dispose(); }
}
function compare(source: string) {
    const actual = run(source), reference = run(source, false);
    expect(actual.result).toEqual(reference.result);
    expect(actual.loops).toBeGreaterThan(0);
}

describe('region comparison masks and choose', () => {
    it.each(['less', 'at most', 'greater', 'at least', 'equal', 'not equal'])('keeps %s masks boolean', op => {
        compare(head + `for P in 1 to 3\n Mask = A ${op} P\nend`);
    });
    it('compiles mask, gathers and choose without changing array types', () => {
        compare(head + 'for P in 1 to 3\n Mask = A at most (P * 2)\n Ix = A // 2 - 1\n Va = B (Ix min 3)\n Vb = A (Ix min 3)\n Chosen = Mask choose Va Vb\nend');
    });
    it.each(['=', '+=', '-=', '*='])('preserves repeated-index %s writes and snapshots', op => {
        compare(head + `Alias = A\nfor P in 1 to 2\n Mask = A less 5\n Rhs = Mask choose A B\n Ix = array 1 1 2 3\n A Ix ${op} Rhs\nend\nconcat A Alias`);
    });
    it('preserves shape broadcasting, empty arrays and scalar choose branches', () => {
        compare(head + 'for P in 1 to 2\n Mask = A less P\n Rhs = Mask choose 7 B\nend');
        compare('use sequences\nA = array shape 0 fill 0\nfor P in 1 to 2\n Mask = A less P\n Rhs = Mask choose A 0\nend');
        compare('use sequences\nA = (array 1 2) reshape 2 1\nB = (array 4 5 6) reshape 1 3\nfor P in 1 to 2\n Mask = A less 2\n Rhs = Mask choose A B\nend');
    });
    it('retains exact values beyond Number precision', () => {
        compare('use sequences\nA = array 9007199254740993 18014398509481987\nfor P in 1 to 2\n Mask = A greater P\n Rhs = Mask choose A 1\nend');
    });
    it('retains final indexed-write results', () => {
        compare(head + 'Ix = array 0 2\nJx = array 1 3\nfor P in 1 to 2\n Mask = A less 5\n Rhs = Mask choose A B\n A Ix = Rhs Jx\nend');
    });
    it.each([
        'A (array 0 7) = (array 1 2)',
        'A (array 0 1) = (array 1 2 3)',
        'A (array -1 0) = (array 1 2)',
        'A (array 0 7) = (array 1 2) // 0',
    ])('keeps errors and preceding writes for %s', write => {
        const outcomes = [true, false].map(compiled => {
            const r = new Interpreter(() => {}, { integerLoopCompilation: compiled });
            try {
                r.execute(head);
                let message = '';
                try { r.execute('for P in 1 to 2\n Mask = A less 5\n A 0 = P\n ' + write + '\nend'); }
                catch (error) { message = (error as Error).message; }
                expect(message).not.toBe('');
                return { message, a: formatValue(r.execute('A')!) };
            } finally { r.dispose(); }
        });
        expect(outcomes[0]).toEqual(outcomes[1]);
    });
    it('uses the compiled bulk write for error ordering and partial state', () => {
        const outcomes = [true, false].map(compiled => {
            const code: string[] = [];
            const r = new Interpreter(() => {}, { integerLoopCompilation: compiled,
                onIntegerLoopCompiled: source => code.push(source) });
            try {
                r.execute(head + 'Ix = array 0 8\nZeros = array 0 0\n');
                let error = '';
                try { r.execute('for P in 1 to 2\n Mask = A less P\n A 0 = P\n A Ix = (A Ix) // Zeros\nend'); }
                catch (e) { error = (e as Error).message; }
                expect(error).toContain('out of bounds');
                if (compiled) expect(code.some(source => source.includes('arrayValues.write'))).toBe(true);
                return { error, state: formatValue(r.execute('A')!) };
            } finally { r.dispose(); }
        });
        expect(outcomes[0]).toEqual(outcomes[1]);
    });
    it('retains lazy unselected choose operands', () => {
        compare(head + 'Zeros = array shape 4 fill 0\nfor P in 1 to 2\n Mask = A greater 0\n Rhs = Mask choose B (A // Zeros)\nend');
    });
    it('leaves scalar-condition choose on its rank-dependent ordinary path', () => {
        for (const condition of ['true', 'false']) {
            const source = head + `for P in 1 to 2\n Chosen = ${condition} choose 7 A\nend`;
            expect(run(source).result).toEqual(run(source, false).result);
        }
    });
    it('accepts an entry boolean mask without converting it to integers', () => {
        compare(head + 'Mask = A less 5\nfor P in 1 to 2\n Rhs = Mask choose A B\nend');
    });
    it('guards a replaced native choose implementation', () => {
        const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
        try {
            r.execute(head);
            const fn = r.execute('choose');
            if (!isNativeFunction(fn!)) throw Error('expected builtin');
            Object.defineProperty(fn, 'call', { value: () => 77n });
            expect(d.run(() => r.execute('for P in 1 to 2\n Mask = A less P\n Rhs = Mask choose A B\nend'))).toBe(77n);
            expect(d.compiledLoops).toBe(0);
        } finally { r.dispose(); }
    });
    it('keeps untracked effectful inputs on the ordinary path', () => {
        const outcomes = [true, false].map(compiled => {
            const r = new Interpreter(() => {}, { integerLoopCompilation: compiled }), reads: number[] = [];
            try {
                r.variables.set('A', derivedArray([2], [], i => { reads.push(i); return BigInt(i); }));
                const result = r.execute('for P in 1 to 2\n Mask = A less P\n Rhs = Mask choose A 7\nend');
                return { result: formatValue(result!), reads };
            } finally { r.dispose(); }
        });
        expect(outcomes[0]).toEqual(outcomes[1]);
    });
    it('compiles both Euler 642 prime loops with unchanged answers', () => {
        const source = readFileSync(new URL('../../../demos/euler/642_largestprimefactors.ra', import.meta.url), 'utf8')
            .replace('N integer = 201820182018', 'N integer = 10000');
        const result = run(source);
        expect(result.result).toBe(10118280n);
        expect(result.loops).toBe(2);
    });
});
