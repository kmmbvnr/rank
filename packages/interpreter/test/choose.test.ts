import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankArray } from '../src/index.js';
import { sequence } from '../src/sequence.js';
import { chooseValue } from '../src/modules/sequences.js';
import { readArrayItem } from '../src/array-storage.js';

for (const compilation of [false, true]) describe(`choose boolean comparisons (compilation=${compilation})`, () => {
    it.each([1023, 1024, 1226, 4096])('preserves boolean branches at %i cells', size => {
        for (const mixedMask of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute('use sequences\n'
                    + `X = (0 till ${size}) copy\n`
                    + `M = ${mixedMask ? '(X mod 5) equal 0' : 'X less 0'}\n`
                    + 'A = (X mod 3) equal 0\nB = (X mod 2) equal 0\nC = M choose A B');
                const expected = Array.from({ length: size }, (_, i) =>
                    mixedMask && i % 5 === 0 ? i % 3 === 0 : i % 2 === 0);
                expect(formatValue(runtime.execute('C')!)).toBe(expected.join(' '));
                expect(runtime.execute('(M and C) count')).toBe(BigInt(expected.filter((value, i) =>
                    mixedMask && i % 5 === 0 && value).length));
            } finally { runtime.dispose(); }
        }
    });
});

describe('choose', () => {
    it('accepts the condition before choose without a module import', () => {
        const runtime = new Interpreter();
        expect(formatValue(runtime.execute('true choose "yes" "no"')!)).toBe('yes');
        expect(formatValue(runtime.execute('false choose "yes" "no"')!)).toBe('no');
        expect(formatValue(runtime.execute('2 greater 1 choose (3 + 4) 0')!)).toBe('7');
        runtime.execute('Mask = array true false true\nValues = array 2 4 6');
        expect(formatValue(runtime.execute('Mask choose Values 0')!)).toBe('2 0 6');
        expect(formatValue(runtime.execute('1 choose (array 10 20 30)')!)).toBe('20');
        expect(formatValue(runtime.execute('true choose false true choose 3 4')!)).toBe('4');
        expect(formatValue(runtime.execute('true true false choose 3 4 choose')!)).toBe('3');
    });

    it('selects scalar values and broadcasts arrays lazily', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences\nMask = array true false true\n'
            + 'Yes = array 2 4 6\nOut = Mask Yes 0 choose');
        expect(formatValue(runtime.execute('Out')!)).toBe('2 0 6');
        expect(formatValue(runtime.execute('true "yes" "no" choose')!)).toBe('yes');
        runtime.execute('Grid = (array true false false true) reshape 2 2\n'
            + 'Rates = (array 10 20) reshape 1 2\n'
            + 'Picked = Grid Rates 0 choose');
        expect(formatValue(runtime.execute('Picked 0 0')!)).toBe('10');
        expect(formatValue(runtime.execute('Picked 0 1')!)).toBe('0');
        expect(formatValue(runtime.execute('Picked 1 1')!)).toBe('20');
        expect(() => runtime.execute('(array true false) (array 1 2 3) 0 choose'))
            .toThrowError('shape mismatch');
    });

    it('does not read an unselected missing branch, but keeps a missing mask missing', () => {
        const runtime = new Interpreter();
        runtime.execute('use json\nuse sequences\nuse tables\n'
            + 'Rows = "[{\\"mask\\":true,\\"yes\\":2},'
            + '{\\"mask\\":false,\\"no\\":5},'
            + '{\\"yes\\":7}]" json\n'
            + 'Out = (Rows .mask) (Rows .yes) (Rows .no) choose');
        expect(formatValue(runtime.execute('Out 0')!)).toBe('2');
        expect(formatValue(runtime.execute('Out 1')!)).toBe('5');
        expect(formatValue(runtime.execute('Out 2 default 0')!)).toBe('0');
        expect(formatValue(runtime.execute('Out 2')!)).toBe('.NA');
        runtime.execute("Deferred' = (Rows .mask) (Rows .yes) (Rows .no) choose");
        expect(() => runtime.execute('Deferred 2')).toThrowError('missing object key');
    });
});

describe('choose by index', () => {
    const show = (source: string): string => {
        const runtime = new Interpreter();
        return formatValue(runtime.execute(`use sequences\n${source}`)!);
    };

    it('reads each cell from the choice its index names', () => {
        expect(show('(array 1 0 2) (array 10 20 30) choose')).toBe('20 10 30');
        expect(show('(array 1 0) (array (array 1 2) (array 3 4)) choose')).toBe('3 2');
        expect(show('1 (array 10 20 30) choose')).toBe('20');
    });

    it('broadcasts a column index over the rows of matrix choices', () => {
        const matrices = 'M = (array (array 1 2) (array 3 4)) copy\nChoices = array M (M * 10)\n';
        expect(show(`${matrices}(array 1 0) Choices choose`)).toBe('10 2 30 4');
        // A stacked tensor offers its leading cells as the choices.
        expect(show(`${matrices}(array 1 0) (Choices copy) choose`)).toBe('10 2 30 4');
    });

    it('reads only the chosen value at each cell', () => {
        const runtime = new Interpreter();
        runtime.execute('use json\nuse sequences\nuse tables\n'
            + 'Rows = "[{\\"a\\":2},{\\"b\\":5}]" json\n'
            + 'Out = (array 0 1) (array (Rows .a) (Rows .b)) choose');
        expect(formatValue(runtime.execute('Out')!)).toBe('2 5');
        expect(() => runtime.execute('(array 1 1) (array (Rows .a) (Rows .b)) choose copy'))
            .toThrowError('missing object key');
    });

    it('rejects indices outside the choices and non-integer indices', () => {
        expect(() => show('(array 0 5) (array 10 20) choose')).toThrowError('choose index out of bounds: 5');
        expect(() => show('(array 0 -1) (array 10 20) choose')).toThrowError('choose index out of bounds: -1');
        expect(() => show('(array true false) (array 10 20) choose')).toThrowError('choose expects integer indices');
        expect(() => show('0 5 choose')).toThrowError('choose expects an array of choices');
        expect(() => show('(array 0 1 0) (array (array 1 2) (array 3 4)) choose')).toThrowError('shape mismatch');
    });
});

for (const compilation of [false, true]) describe(`choose with sequences (compilation=${compilation})`, () => {
    function show(source: string): string {
        const runtime = new Interpreter(() => {}, { compilation });
        try { return formatValue(runtime.execute('use sequences\n' + source)!); }
        finally { runtime.dispose(); }
    }

    it('accepts the issue example, deferred bindings and inline range expressions', () => {
        for (const binding of ['=', "' ="]) {
            expect(show(`Q ${binding} 1 to 6\nE ${binding} Q mod 2 equal 0\nH ${binding} E choose (Q // 2) (Q + 0)\nH`))
                .toBe('1 1 3 2 5 3');
        }
        expect(show('(1 to 6) mod 2 equal 0 choose ((1 to 6) // 2) ((1 to 6) + 0)'))
            .toBe('1 1 3 2 5 3');
        expect(show("Mask' = (1 to 6) mod 2 equal 0\nMask choose 7 9")).toBe('9 7 9 7 9 7');
    });

    it('broadcasts sequence operands with arrays and singleton dimensions', () => {
        expect(show('(array false true false true false true) choose ((1 to 6) // 2) (1 to 6)'))
            .toBe('1 1 3 2 5 3');
        expect(show("Mask' = (1 to 3) greater 1\nMask choose (array 10 20 30) 0")).toBe('0 20 30');
        expect(show("Mask' = (1 to 3) greater 1\nM = array shape 2 3 fill 7\nMask choose M 0"))
            .toBe('0 7 7 0 7 7');
        expect(show('(array true false true) choose (8 to 8) (1 to 3)')).toBe('8 2 8');
        expect(show('(array true false true) choose (10 - (1 to 3)) 0')).toBe('9 0 7');
        expect(show('(array true false true) choose ((1 to 3) + (10 to 12)) 0')).toBe('11 0 15');
    });

    it('does not compute unselected addressable sequence cells', () => {
        expect(show("Q' = -1 to 1\nMask' = Q equal 0\nMask choose 0 (6 // Q)"))
            .toBe('-6 0 6');
        expect(show("Q' = -1 to 1\nMask' = Q not equal 0\nMask choose (6 // Q) 0"))
            .toBe('-6 0 6');
        expect(() => show("Q' = -1 to 1\nMask' = Q equal 0\nMask choose (6 // Q) 0"))
            .toThrow('zero');
    });

    it('reports shape and condition errors and supports empty sequences', () => {
        expect(() => show('(1 to 3) equal 2 choose (1 to 2) 0')).toThrow('shape mismatch');
        expect(() => show('(1 to 3) choose (array 1 2 3) 0')).toThrow('boolean condition');
        expect(show('((0 till 0) equal 0 choose 1 2) shape')).toBe('0');
    });

    it('stacks finite generator masks and branch cells like copy', () => {
        expect(show('fun mask\n yield true\n yield false\nend\nmask choose (array 1 2) 0')).toBe('1 0');
        expect(show('fun rows\n yield array 1 2\n yield array 3 4\nend\n(array true false) choose rows 0'))
            .toBe('1 0 3 0');
    });

    it('preserves whole-stream selection for a scalar condition', () => {
        expect(show('true choose (1 to 3) (1 to #)')).toBe('1 2 3');
    });
});

describe('choose sequence boundaries', () => {
    it('does not traverse addressable scalar sources to construct or read a selected cell', () => {
        const reads: bigint[] = [];
        const source = sequence({
            name: 'addressable', replay: 'pure', scalarItems: true,
            size: { kind: 'exact', value: 3n },
            at(index) { reads.push(index); return index + 1n; },
            *iterate() { throw new Error('unexpected traversal'); },
        });
        const result = chooseValue(sequence({
            name: 'mask', replay: 'pure', scalarItems: true,
            size: { kind: 'exact', value: 3n },
            at: index => index === 1n,
            *iterate() { throw new Error('unexpected mask traversal'); },
        }), source, 0n);
        expect(reads).toEqual([]);
        expect(result).toMatchObject({ shape: [3] });
        if (!isRankArray(result)) throw new Error('expected array');
        expect(readArrayItem(result, 0)).toBe(0n);
        expect(reads).toEqual([]);
        expect(readArrayItem(result, 1)).toBe(2n);
        expect(reads).toEqual([1n]);
    });

    it('consumes an unknown-size single-pass mask once', () => {
        let passes = 0;
        const mask = sequence({
            name: 'mask', singlePass: true, size: { kind: 'unknown' },
            *iterate() {
                if (++passes > 1) throw new Error('mask replayed');
                yield true;
                yield false;
            },
        });
        const result = chooseValue(mask, 7n, 9n);
        expect(formatValue(result)).toBe('7 9');
        expect(formatValue(result)).toBe('7 9');
        expect(passes).toBe(1);
    });

    it('rejects a known infinite mask without starting its iterator', () => {
        let started = false;
        const mask = sequence({
            name: 'infinite mask', size: { kind: 'infinite' },
            *iterate() { started = true; yield true; },
        });
        expect(() => chooseValue(mask, 1n, 0n)).toThrow('infinite sequence');
        expect(started).toBe(false);
    });
});
