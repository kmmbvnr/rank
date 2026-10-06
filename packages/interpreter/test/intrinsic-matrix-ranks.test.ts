import { readFileSync } from 'node:fs';
import { analyzeValues } from '@arrrank/language';
import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction, isRankArray, parse } from '../src/index.js';
import { derivedArray } from '../src/array-storage.js';
import { completed } from '../src/execution.js';
import { linalgModule } from '../src/modules/linalg.js';
import { RankApplication } from '../src/rank-application.js';
import { run } from './support.js';

const prefix = 'use linalg\nuse sequences\n';

describe('intrinsic matrix cells', () => {
    it('agrees with explicit rank across rectangular diagonals and configured modes', () => {
        for (const rows of [0, 2]) for (const mode of ['', '.anti', '1', '-1', '.anti 1', '.anti -1']) {
            const source = `${prefix}A = array shape ${rows} 3 4 fill 2\n`;
            expect(run(`${source}A diag ${mode} shape`)).toBe(run(`${source}A diag ${mode} rank 2 shape`));
            expect(run(`${source}A diag ${mode}`)).toBe(run(`${source}A diag ${mode} rank 2`));
            const program = parse(`${source}R = A diag ${mode}`);
            const facts = analyzeValues(program).bindings.get('R');
            const runtime = new Interpreter();
            try {
                const actual = runtime.execute(`${source}R = A diag ${mode}\nR`);
                expect(isRankArray(actual!) && actual.shape).toEqual(facts?.shape);
            } finally { runtime.dispose(); }
        }
    });

    it('distinguishes matrix extraction from explicit vector-cell construction', () => {
        const source = `${prefix}A = array 1 2 3 4 5 6 shape 2 3\n`;
        expect(run(`${source}A diag`)).toBe('1 5');
        expect(run(`${source}A diag rank 1 shape`)).toBe('2 3 3');
        expect(run(`${prefix}(array 1 2 3) diag shape`)).toBe('3 3');
        expect(() => run(`${prefix}1 diag`)).toThrow(/rank-1 vector or rank-2 matrix/);
    });

    it('keeps function aliases and explicit frame-axis selection consistent', () => {
        const source = `${prefix}A = array shape 2 3 4 fill 2\nd = diag\n`;
        expect(run(`${source}A d shape`)).toBe('2 3');
        expect(run(`${source}(A d .anti 1) shape`)).toBe('2 3');
        expect(run(`${source}A diag axis 1 rank 2 shape`)).toBe('3 2');
        expect(analyzeValues(parse(`${source}R = A d`)).bindings.get('R')?.shape).toEqual([2, 3]);
        expect(analyzeValues(parse(`${source}R = A diag axis 1 rank 2`)).bindings.get('R')?.shape).toEqual([3, 2]);
    });

    it('assembles eigenvalue/eigenvector tuples as one element per matrix cell', () => {
        const source = `${prefix}A = array 2 1 1 2 4 0 0 5 shape 2 2 2\n`;
        expect(run(`${source}A eigh shape`)).toBe('2');
        expect(run(`${source}A eigh`)).toBe(run(`${source}A eigh rank 2`));
        expect(run(`${source}e = eigh\nA e`)).toBe(run(`${source}A eigh`));
        expect(run(`${source}R = A eigh\nunpack Values Vectors = R 0\nValues`)).toBe('1 3');
        expect(run(`${source}R = A eigh\nunpack Values Vectors = R 1\nVectors shape`)).toBe('2 2');
        const facts = analyzeValues(parse(`${source}R = A eigh`)).bindings.get('R');
        expect(facts?.shape).toEqual([2]);
        expect(facts?.types).toEqual(['array']);
    });

    it('uses the same tuple assembly for user functions, including empty batches', () => {
        for (const size of [0, 2]) {
            const source = `${prefix}A = array shape ${size} 2 2 fill 1\nfun pair X rank 2\n return tuple X X\nend\n`;
            expect(run(`${source}A pair shape`)).toBe(String(size));
            expect(run(`${source}A eigh shape`)).toBe(String(size));
        }
    });

    it('validates empty matrix cells without reading values or invoking decomposition', () => {
        let reads = 0;
        let calls = 0;
        const functionOf = (name: string) => {
            const fn = linalgModule[name]({ output: () => {}, random: () => 0, seedRandom: () => {}, ownFile: () => {} });
            if (!isNativeFunction(fn)) throw new Error('expected function');
            return fn;
        };
        const application = new RankApplication((fn, args) => completed(fn.call(args)), () => {}, new Map(), () => undefined);
        for (const [name, shape, expected] of [
            ['diag', [0, 3, 4], [0, 3]], ['eigh', [0, 3, 3], [0]],
            ['det', [0, 3, 3], [0]], ['inverse', [0, 3, 3], [0, 3, 3]],
        ] as const) {
            const fn = { ...functionOf(name), call: () => { calls++; throw new Error('called nonexistent cell'); } };
            const input = derivedArray(shape, [], () => { reads++; throw new Error('read nonexistent cell'); });
            const result = application.applyIntrinsicRank(fn, [input]);
            expect('done' in result && isRankArray(result.value) && result.value.shape).toEqual(expected);
        }
        for (const name of ['eigh', 'det', 'inverse'] as const) {
            const fn = { ...functionOf(name), call: () => { calls++; throw new Error('called nonexistent cell'); } };
            expect(() => application.applyIntrinsicRank(fn, [derivedArray([0, 3, 4], [], () => 0n)]))
                .toThrow(/expects cell shape/);
        }
        expect([reads, calls]).toEqual([0, 0]);
        expect(() => run(`${prefix}(array 1 2) eigh`)).toThrow(/square rank-2/);
    });

    it('keeps matrix application consistent through compiled and interpreted function bodies', () => {
        const source = `${prefix}fun diagonal X\n return X diag\nend\nfun eigensystem X\n return X eigh\nend\nA = array 2 1 1 2 4 0 0 5 shape 2 2 2\n`;
        for (const operation of ['diagonal', 'eigensystem']) {
            const outputs = [false, true].map(enabled => {
                const runtime = new Interpreter(() => {}, {
                    blockCompilation: enabled, functionBodyCompilation: enabled,
                    scalarFunctionCompilation: enabled, tensorFusion: enabled,
                });
                try { return formatValue(runtime.execute(`${source}A ${operation}`)!); }
                finally { runtime.dispose(); }
            });
            expect(outputs[0]).toBe(outputs[1]);
            expect(outputs[0]).toBe(run(`${source}A ${operation === 'diagonal' ? 'diag' : 'eigh'}`));
        }
        expect(run(`${prefix}(array shape 2 0 3 3 fill 0) eigh shape`)).toBe('2 0');
        expect(run(`${prefix}(array shape 0 3 fill 0) diag 1 rank 1 shape`)).toBe('0 4 4');
        expect(() => run(`${prefix}(array shape 0 fill 0) diag rank 0`)).toThrow(/rank-1 vector or rank-2 matrix/);
    });

    it('preserves global reductions, leading-axis transformations and binary broadcasting', () => {
        const source = `${prefix}use numbers\nA = array 1 2 3 4 5 6 shape 2 3\n`;
        expect(run(`${source}A sum`)).toBe('21');
        expect(run(`${source}A max - (A min)`)).toBe('5');
        expect(run(`${source}A len`)).toBe('2');
        expect(run(`${source}A reverse`)).toBe('4 5 6 1 2 3');
        expect(run(`${source}A (array 2 3 4) gcd`)).toBe(run(`${source}A (array 2 3 4) gcd rank 0 0`));
        expect(run(`${source}A sort .descending`)).toBe('3 2 1 6 5 4');
    });

    it('executes the documented Euler 8 and 11 programs', () => {
        for (const [file, answer] of [['008_seriesproduct.ra', '23514624000'], ['011_gridproduct.ra', '70600674']] as const) {
            const code = readFileSync(new URL(`../../../demos/euler/${file}`, import.meta.url), 'utf8');
            expect(run(`${code}\nAnswer`)).toBe(answer);
        }
    });
});
