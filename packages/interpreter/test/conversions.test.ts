import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankArray } from '../src/index.js';

for (const compiled of [true, false]) describe(`explicit conversions (compiled=${compiled})`, () => {
    function runtime() {
        return new Interpreter(() => undefined, {
            scalarCompilation: compiled, scalarEntryCompilation: compiled,
            scalarFunctionCompilation: compiled, blockCompilation: compiled,
            integerLoopCompilation: compiled, tensorFusion: compiled,
        });
    }

    it('requires explicit conversions when reassigning integer and real variables', () => {
        const r = runtime();
        r.execute('Whole = 1\nFraction = 2.7');
        expect(() => r.execute('Whole = Fraction')).toThrow('cannot receive real');
        expect(r.variables.get('Whole')).toBe(1n);
        expect(r.execute('Whole = Fraction integer')).toBe(2n);
        expect(() => r.execute('Fraction = Whole')).toThrow('cannot receive integer');
        expect(r.variables.get('Fraction')).toBe(2.7);
        expect(r.execute('Fraction = Whole real')).toBe(2);
        expect(formatValue(r.execute('Fraction type')!)).toBe('.real');
        expect(r.execute('1 + 2.0')).toBe(3);
    });

    it('truncates toward zero while round retains its own rounding and type', () => {
        const r = runtime();
        expect(r.execute('2.9 integer')).toBe(2n);
        expect(r.execute('(-2.9) integer')).toBe(-2n);
        expect(r.execute('(-0.9) integer')).toBe(0n);
        expect(r.execute('2 integer')).toBe(2n);
        expect(r.execute('2.5 real')).toBe(2.5);
        expect(r.execute('use numbers\n2.9 round 0 integer')).toBe(3n);
        expect(formatValue(r.execute('2.9 round 0 type')!)).toBe('.real');
    });

    it('parses complete decimal strings and keeps integer parsing exact', () => {
        const r = runtime();
        expect(r.execute('"9007199254740993" integer')).toBe(9007199254740993n);
        expect(r.execute('"+00012" integer')).toBe(12n);
        expect(r.execute('"-2.75" real')).toBe(-2.75);
        expect(r.execute('"1.25e2" real')).toBe(125);
        expect(r.execute('".5" real')).toBe(0.5);
        expect(r.execute('"-2.75" real integer')).toBe(-2n);
        for (const text of ['', ' ', '2.0', '12x', '0x10']) {
            expect(() => r.execute(`${JSON.stringify(text)} integer`)).toThrow('invalid integer text');
        }
        for (const text of ['', ' ', ' 2', '2 ', '2x', '0x10', 'NaN', 'Infinity']) {
            expect(() => r.execute(`${JSON.stringify(text)} real`)).toThrow('invalid real text');
        }
    });

    it('rejects unsupported types and nonfinite or overflowing conversions', () => {
        const r = runtime();
        expect(() => r.execute('true integer')).toThrow('integer expects');
        expect(() => r.execute('false real')).toThrow('real expects');
        expect(() => r.execute('use numbers\ninfinity integer')).toThrow('finite real');
        expect(() => r.execute('"1e999" real')).toThrow('finite range');
        expect(() => r.execute('(10 ** 400) real')).toThrow('finite range');
        // Precision loss is part of an explicit binary64 conversion, never an assignment coercion.
        expect(r.execute('9007199254740993 real')).toBe(9007199254740992);
    });

    it('uses rank explicitly for arrays, sequences and individual text digits', () => {
        const r = runtime();
        r.execute('A = array shape 2 2\n 1.9 (-2.9)\n 3.0 4.5\nend');
        const integers = r.execute('A integer rank 0')!;
        expect(isRankArray(integers)).toBe(true);
        if (!isRankArray(integers)) return;
        expect(integers.shape).toEqual([2, 2]);
        expect(integers.items).toEqual([1n, -2n, 3n, 4n]);
        expect(formatValue(r.execute('1 to 3 real rank 0 array')!)).toBe('1 2 3');
        expect(formatValue(r.execute('"1203" integer rank 0')!)).toBe('1 2 0 3');
        expect(r.execute('"1203" integer')).toBe(1203n);
    });

    it('supports text conversion and formatting without importing text operations', () => {
        const r = runtime();
        expect(r.execute('2.75 text')).toBe('2.75');
        expect(r.execute('2.75 text ".1f"')).toBe('2.8');
        expect(r.execute('true text')).toBe('true');
        expect(r.execute('2.75 text real')).toBe(2.75);
        expect(() => r.execute('"abc" reverse')).toThrow('use text');
    });

    it('preserves record types, function aliases, overrides and one evaluation per conversion', () => {
        const r = runtime();
        r.execute('Row = record\n .count = 1\nend');
        expect(() => r.execute('Row .count = 2.5')).toThrow('cannot receive real');
        expect(r.execute('Row .count = 2.5 integer')).toBe(2n);
        r.execute('Cast = real\nCalls = array 0\nfun next\n Calls 0 += 1\n return 2\nend');
        expect(r.execute('next Cast')).toBe(2);
        expect(r.execute('Calls 0')).toBe(1n);
        r.execute('fun real Value\n return Value + 10\nend');
        expect(r.execute('2 real')).toBe(12n);
        expect(r.execute('2 Cast')).toBe(2);
    });
});
