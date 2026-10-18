import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';

const samples: [string, string, string][] = [
    ['contiguous scalar', 'A (0 to 3) += 5', '15 25 35 45'],
    ['stride scalar', 'A (0 to 3 by 2) *= 3', '30 20 90 40'],
    ['descending', 'A (3 to 0 by -1) -= 2', '8 18 28 38'],
    ['exclusive', 'A (0 till 3) = 7', '7 7 7 40'],
    ['whole axis', 'A # += 1', '11 21 31 41'],
    ['open range', 'A (1 to # by 2) += 2', '10 22 30 42'],
    ['empty', 'A (1 till 1) = 9', '10 20 30 40'],
    ['huge empty endpoints', 'A (99999999999999999999 till 0) += 9', '10 20 30 40'],
    ['huge single stride', 'A (0 to 1 by 99999999999999999999) += 9', '19 20 30 40'],
    ['index scalar', 'A (array 3 1) += 5', '10 25 30 45'],
    ['duplicate scalar', 'A (array 0 0) += 1', '11 20 30 40'],
    ['duplicate vector', 'A (array 0 0) += array 1 2', '12 20 30 40'],
    ['duplicate assign', 'A (array 0 0) = array 1 2', '2 20 30 40'],
    ['overlap', 'A (array 3 2 1 0) = A', '40 30 20 10'],
    ['overlap compound', 'A (array 3 2 1 0) += A', '50 50 50 50'],
    ['lazy overlap', 'A (0 to 3) -= A // 2', '5 10 15 20'],
    ['saved lazy operand', 'Cut = A (0 to 3) // 2\nA (0 to 3) -= Cut', '5 10 15 20'],
    ['mask', 'A (A greater 20) += 7', '10 20 37 47'],
    ['BigInt', 'A (0 to 3) *= 18446744073709551616', '184467440737095516160 368934881474191032320 553402322211286548480 737869762948382064640'],
];

describe.each([false, true])('slice writes (compilation=%s)', compilation => {
    it.each(samples)('%s', (_name, body, expected) => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('A = array 10 20 30 40');
            r.execute(body);
            expect(formatValue(r.execute('A')!)).toBe(expected);
        } finally { r.dispose(); }
    });

    it.each([
        ['A (array 0 5) = 9', 'out of bounds'],
        ['A (0 to 5 by 2) = 9', 'axis 0: 4'],
        ['A (3 to -1 by -2) += 9', 'nonnegative'],
        ['A (array 0 1) = array 1.0 2.0', 'cannot receive'],
        ['A (array 0 1) //= array 2 0', 'division by zero'],
        ['A (0 to 3) = array 1 2', 'shape mismatch'],
    ])('does not change cells on failure: %s', (body, error) => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('A = array 10 20 30 40');
            expect(() => r.execute(body)).toThrow(error);
            expect(formatValue(r.execute('A')!)).toBe('10 20 30 40');
        } finally { r.dispose(); }
    });

    it('protects aliases, retained slices and derived caches', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('A = array 10 20 30 40\nAlias = A\nCut = A (1 to 3)\nTwice = A * 2\nSeen = Twice sum');
            r.execute('A (0 to 3) += 1');
            expect(formatValue(r.execute('Alias')!)).toBe('10 20 30 40');
            expect(formatValue(r.execute('Cut')!)).toBe('20 30 40');
            expect(r.execute('Twice sum')).toBe(200n);
            expect(r.execute('A sum')).toBe(104n);
        } finally { r.dispose(); }
    });

    it('retains selected values without a whole-array alias', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('A = array 10 20 30 40\nCut = A (1 to 2)');
            r.execute('A (0 to 3) += 1');
            expect(formatValue(r.execute('Cut')!)).toBe('20 30');
            expect(r.execute('A sum')).toBe(104n);
        } finally { r.dispose(); }
    });

    it('evaluates RHS once and returns the original RHS', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('A = array 10 20 30 40\nCalls = array 0\nfun rhs\n Calls 0 += 1\n return 7\nend');
            expect(r.execute('A (0 to 3) += rhs')).toBe(7n);
            expect(r.execute('Calls 0')).toBe(1n);
        } finally { r.dispose(); }
    });

    it('checks the complete selector before evaluating RHS', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('A = array 10 20 30 40');
            expect(() => r.execute('A (0 to 5) = 1 // 0')).toThrow('axis 0: 4');
        } finally { r.dispose(); }
    });

    it('freezes a selector derived from the destination', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('A = array 2 1 0\nA A += 1');
            expect(formatValue(r.execute('A')!)).toBe('3 2 1');
        } finally { r.dispose(); }
    });
});

it('executes the guarded bulk path and preserves a reference path', () => {
    for (const compilation of [false, true]) {
        const r = new Interpreter(undefined, { compilation });
        const d = new RuntimeDiagnostics();
        try {
            d.run(() => r.execute('A = array shape 100 fill 0\nA (0 to 99) += 1\nA (array 0 0) += 2'));
            expect(d.bulkArrayWrites).toBe(compilation ? 2 : 0);
            expect(d.bulkArrayWriteCells).toBe(compilation ? 102 : 0);
            expect(r.execute('A sum')).toBe(102n);
        } finally { r.dispose(); }
    }
});
