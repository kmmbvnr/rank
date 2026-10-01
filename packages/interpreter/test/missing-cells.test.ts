import { describe, expect, it } from 'vitest';
import { createArraySnapshot, hasMaskedCells, isPresentAt, maskedCells, readArrayItem } from '../src/array-storage.js';
import { mapMaskedArrays } from '../src/masked-kernels.js';
import { MISSING } from '../src/value.js';
import { run } from './support.js';

describe('missing cells (.NA)', () => {
    it('is a value that prints as written and has its own type', () => {
        expect(run('.NA')).toBe('.NA');
        expect(run('array 1.0 2.0 .NA')).toBe('1 2 .NA');
        expect(run('.NA type')).toBe('.missing');
        expect(run('.NA is .missing')).toBe('true');
        expect(run('1 is .missing')).toBe('false');
        expect(run('X = .NA\nX')).toBe('.NA');
    });

    it('propagates through arithmetic and comparison', () => {
        expect(run('.NA + 1')).toBe('.NA');
        expect(run('2 * .NA')).toBe('.NA');
        expect(run('-.NA')).toBe('.NA');
        expect(run('.NA greater 1')).toBe('.NA');
        expect(run('.NA equal .NA')).toBe('.NA');
        expect(run('(array 1.0 .NA 3.0) + 1')).toBe('2 .NA 4');
        expect(run('(array 1 2) + .NA')).toBe('.NA .NA');
        expect(run('(array 1.0 .NA 3.0) greater 2')).toBe('false .NA true');
    });

    it('follows three-valued logic', () => {
        expect(run('false and .NA')).toBe('false');
        expect(run('.NA and false')).toBe('false');
        expect(run('true and .NA')).toBe('.NA');
        expect(run('true or .NA')).toBe('true');
        expect(run('.NA or true')).toBe('true');
        expect(run('false or .NA')).toBe('.NA');
        expect(run('true xor .NA')).toBe('.NA');
        expect(run('not .NA')).toBe('.NA');
    });

    it('raises .Missing where a definite value is required', () => {
        expect(() => run('if .NA\n    1\nend')).toThrowError('missing value');
        expect(run('X = (.NA and true) default false\nX')).toBe('false');
    });

    it('is filled by default, and present masks it', () => {
        expect(run('.NA default 0')).toBe('0');
        expect(run('(array 1.0 .NA 3.0) default 0.0')).toBe('1 0 3');
        expect(run('(array 1.0 .NA 3.0) present')).toBe('true false true');
        expect(run('.NA present')).toBe('false');
        expect(run('5 present')).toBe('true');
        expect(run('use sequences\n(array 1.0 .NA 3.0) present false find')).toBe('1');
    });

    it('is skipped by reductions', () => {
        expect(run('(array 1 .NA 3) sum')).toBe('4');
        expect(run('(array 1.5 .NA 3.0) sum')).toBe('4.5');
        expect(run('(array 4 .NA 3) min')).toBe('3');
        expect(run('(array 4 .NA 3) max')).toBe('4');
        expect(run('use stats\n(array 1.0 .NA 5.0) mean')).toBe('3');
        expect(run('use stats\n(array 1.0 .NA 5.0 9.0) median')).toBe('5');
        expect(run('.NA 1 min')).toBe('.NA');
    });

    it('keeps nan a number apart from missing', () => {
        expect(run('use numbers\n(array 1.0 nan .NA) present')).toBe('true true false');
        expect(run('use numbers\n(array 1.0 nan .NA) isnan')).toBe('false true false');
    });
});

describe('missing cells in typed storage', () => {
    const cells = (...items: (number | bigint | typeof MISSING)[]) => createArraySnapshot(items);

    it('keeps real cells in a buffer with a validity bitmap', () => {
        const array = cells(1.5, MISSING, 3);
        const masked = maskedCells(array);
        expect(masked?.values).toEqual(new Float64Array([1.5, 0, 3]));
        expect(masked && isPresentAt(masked.validity, 1)).toBe(false);
        expect(masked && isPresentAt(masked.validity, 2)).toBe(true);
        expect(readArrayItem(array, 1)).toBe(MISSING);
        expect(readArrayItem(array, 2)).toBe(3);
        // Reading the plain view restores `.NA` cells and ends the typed form.
        expect(array.items).toEqual([1.5, MISSING, 3]);
        expect(maskedCells(array)).toBeUndefined();
    });

    it('keeps integer cells with a bitmap and leaves other arrays alone', () => {
        expect(hasMaskedCells(cells(1n, MISSING))).toBe(true);
        expect(maskedCells(cells(1n, MISSING))).toBeUndefined();
        expect(hasMaskedCells(cells(1, 2, 3))).toBe(false);
        expect(hasMaskedCells(cells(1, 2n, MISSING))).toBe(false);
        expect(hasMaskedCells(createArraySnapshot([true, MISSING]))).toBe(false);
    });

    it('computes real arithmetic on the buffers and combines the bitmaps', () => {
        const left = cells(1, MISSING, 3, 4);
        const right = cells(10, 20, MISSING, 40);
        const sum = mapMaskedArrays(left, right, 0)!;
        expect(maskedCells(sum)?.values[0]).toBe(11);
        expect(maskedCells(sum)?.values[3]).toBe(44);
        expect(sum.items).toEqual([11, MISSING, MISSING, 44]);
        expect(mapMaskedArrays(left, 2, 2)!.items).toEqual([2, MISSING, 6, 8]);
        expect(mapMaskedArrays(left, right, 6)!.items).toEqual([false, MISSING, MISSING, false]);
        // A real zero divisor still goes to the general path, a missing one does not.
        expect(mapMaskedArrays(cells(1, 2), cells(0, MISSING), 3)).toBeUndefined();
        expect(mapMaskedArrays(cells(1, 2), cells(1, MISSING), 3)!.items).toEqual([1, MISSING]);
    });

    it('agrees with the plain path through the language', () => {
        const size = 70;
        const text = Array.from({ length: size }, (_, index) => index % 7 === 3 ? '.NA' : `${index}.5`).join(' ');
        const expected = Array.from({ length: size }, (_, index) => index % 7 === 3 ? '.NA' : `${index + 2}.5`).join(' ');
        expect(run(`X = array ${text}\nX + 2`)).toBe(expected);
        expect(run(`use sequences\nX = array ${text}\n(X + 2) present count`)).toBe(String(size - 10));
        expect(run(`X = array ${text}\n(X default 0.0) sum`)).toBe(run(`X = array ${text}\nX sum`));
        expect(run(`X = array ${text}\nX max`)).toBe('69.5');
        expect(run(`X = array ${text}\nX min`)).toBe('0.5');
        expect(run(`use stats\nX = array ${text}\nX mean`)).toBe(run(`use stats\nX = array ${text}\n(X default 0.0) sum / 60`));
    });
});

describe('a whole array holds data without a value as .NA', () => {
    const lookup = 'use tables\nIds = array 2 1 9\nKeys = array 1 2 2\nNames = array "Ada" "Bea" "Later"\n'
        + 'Found = Ids Keys Names lookup\n';

    it('shows a lookup with no match as .NA, while one read of it still raises', () => {
        expect(run(`${lookup}Found`)).toBe('Bea Ada .NA');
        expect(run(`${lookup}Found present`)).toBe('true true false');
        expect(run(`${lookup}Found default "?"`)).toBe('Bea Ada ?');
        expect(() => run(`${lookup}Found 2`)).toThrowError('lookup key not found');
        expect(run(`${lookup}Found 2 default ""`)).toBe('');
    });

    it('propagates a missing lookup through arithmetic', () => {
        const numbers = 'use tables\nUse = array 1 2 3\nKeys = array 1 3\nValues = array 10.0 30.0\n'
            + 'Found = Use Keys Values lookup\n';
        expect(run(`${numbers}Found + 1.0`)).toBe('11 .NA 31');
        expect(run(`${numbers}Found sum`)).toBe('40');
    });

    it('keeps a missing index for choose, floor and find an error for the whole array', () => {
        expect(() => run('use sequences\n(array 0 5) (array 10 20) choose')).toThrowError();
        expect(run('use sequences\n(array 0 5) (array 10 20) choose default -1')).toBe('10 -1');
    });

    it('does not keep a row or element whose condition has no value', () => {
        expect(run('X = array 1.0 .NA 3.0\nX (X greater 0.5)')).toBe('1 3');
        expect(run('X = array 1.0 .NA 3.0\nX (X greater 2.0)')).toBe('3');
        expect(run('X = array 1.0 .NA 3.0\nX filter greater 0.5')).toBe('1 3');
    });

    it('names the missing value when a number is required', () => {
        expect(() => run('use numbers\n.NA 4 gcd')).toThrowError('missing value');
        expect(run('use numbers\n(array 4.0 .NA 9.0) sqrt')).toBe('2 .NA 3');
    });
});

describe('a name that holds .NA keeps one type', () => {
    it('settles on the type of its first value', () => {
        expect(run('X = .NA\nX = 1.5\nX')).toBe('1.5');
        expect(run('Y = 2.0\nY = .NA\nY = 3.5\nY')).toBe('3.5');
        expect(() => run('X = .NA\nX = 1.5\nX = "a"')).toThrowError('X has type real and cannot receive text');
        expect(() => run('Y = 2.0\nY = .NA\nY = "a"')).toThrowError('Y has type real and cannot receive text');
    });

    it('does so inside a function and a loop', () => {
        expect(run('fun f\n  Best = .NA\n  for I in 1 to 3\n    Best = I\n  end\n  return Best\nend\nf')).toBe('3');
    });
});
