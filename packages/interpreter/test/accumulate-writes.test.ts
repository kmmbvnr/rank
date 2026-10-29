import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { typedArray, ownedArray } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

const prefix = 'use sequences\nuse numbers\n';
const cases: [string, string, string][] = [
    ['broadcast addition', 'H Ix += 1 .accumulate', '10 13 11 10 10'],
    ['filled weights', 'H Ix += array shape 4 fill 2 .accumulate', '10 16 12 10 10'],
    ['shaped weights', 'H Ix += array 2 3 4 5 shape 4 .accumulate', '10 20 14 10 10'],
    ['weighted addition', 'H Ix += array 2 3 4 5 .accumulate', '10 20 14 10 10'],
    ['weighted subtraction', 'H Ix -= array 2 3 4 5 .accumulate', '10 0 6 10 10'],
    ['broadcast subtraction', 'H Ix -= 2 .accumulate', '10 4 8 10 10'],
    ['weighted multiplication', 'H Ix *= array 2 3 4 5 .accumulate', '10 300 40 10 10'],
    ['broadcast multiplication', 'H Ix *= 2 .accumulate', '10 80 20 10 10'],
    ['unchanged plain addition', 'H Ix += 1', '10 11 11 10 10'],
    ['unchanged plain subtraction', 'H Ix -= array 2 3 4 5', '10 5 6 10 10'],
    ['unchanged plain multiplication', 'H Ix *= array 2 3 4 5', '10 50 40 10 10'],
    ['expression RHS', 'H Ix += (1 to 4) * 2 .accumulate', '10 24 16 10 10'],
    ['scalar selector', 'H 1 *= 2 .accumulate', '10 20 10 10 10'],
    ['empty selector', 'H (array shape 0 fill 0) += 1 .accumulate', '10 10 10 10 10'],
    ['range selector', 'H (1 till 4) += 2 .accumulate', '10 12 12 12 10'],
    ['mask selector', 'H (H equal 10) -= 2 .accumulate', '8 8 8 8 8'],
];

describe.each([false, true])('accumulating writes (compilation=%s)', compilation => {
    const runtime = () => new Interpreter(undefined, { compilation });
    it.each(cases)('%s', (_name, body, expected) => {
        const r = runtime();
        try {
            r.execute(prefix + 'H = array shape 5 fill 10\nIx = array 1 1 2 1');
            r.execute(body);
            expect(formatValue(r.execute('H')!)).toBe(expected);
        } finally { r.dispose(); }
    });

    it.each(['+=', '-=', '*='])('handles repeated cells on multiple axes for %s', operator => {
        const r = runtime();
        try {
            r.execute(`A = array shape 2 2 fill 2\nA (array 0 0) (array 1 1) ${operator} 2 .accumulate`);
            const expected = operator === '+=' ? 10n : operator === '-=' ? -6n : 32n;
            expect(r.execute('A 0 1')).toBe(expected);
            expect(r.execute('A 1 1')).toBe(2n);
        } finally { r.dispose(); }
    });

    it.each(['+=', '-=', '*='])('snapshots selectors, RHS and aliases for %s', operator => {
        const r = runtime();
        try {
            r.execute(`A = array 2 0 2\nAlias = A\nCut = A (0 to 2)\nDerived = A * 2\nA A ${operator} A .accumulate`);
            expect(formatValue(r.execute('A')!)).toBe(operator === '+=' ? '2 0 6' : operator === '-=' ? '2 0 -2' : '0 0 8');
            expect(formatValue(r.execute('Alias')!)).toBe('2 0 2');
            expect(formatValue(r.execute('Cut')!)).toBe('2 0 2');
            expect(formatValue(r.execute('Derived')!)).toBe('4 0 4');
        } finally { r.dispose(); }
    });

    it.each(['+=', '-=', '*='])('handles real reductions for %s', operator => {
        const r = runtime();
        try {
            r.execute(`A = array 10.0 20.0\nA (array 1 1) ${operator} array 2.0 3.0 .accumulate`);
            expect(r.execute('A 1')).toBe(operator === '+=' ? 25 : operator === '-=' ? 15 : 120);
        } finally { r.dispose(); }
    });

    it('evaluates the RHS once, returns it and validates selectors first', () => {
        const r = runtime();
        try {
            r.execute('use algo\nA = array 10 20\nCalls = new queue\nfun Calls rhs\n Calls push 1\n return 2\nend');
            expect(r.execute('A (array 0 0) += Calls rhs .accumulate')).toBe(2n);
            expect(r.execute('Calls len')).toBe(1n);
            expect(r.execute('A 0')).toBe(14n);
            expect(() => r.execute('A (array 0 9) += Calls rhs .accumulate')).toThrow(/bounds/);
            expect(r.execute('Calls len')).toBe(1n);
        } finally { r.dispose(); }
    });

    it.each([
        ['A (array 0 2) += 1 .accumulate', /bounds/],
        ['A (array 0 -1) += 1 .accumulate', /nonnegative/],
        ['A (array 0 0) += array 1 .accumulate', /shape mismatch/],
        ['A (array 0 0) += array 1.0 2.0 .accumulate', /cannot receive/],
        ['A (array 0 0) += array 1 "x" .accumulate', /numeric|homogeneous|element type/],
    ])('leaves the array intact on failure: %s', (body, error) => {
        const r = runtime();
        try {
            r.execute('A = array 10 20');
            expect(() => r.execute(body)).toThrow(error);
            expect(formatValue(r.execute('A')!)).toBe('10 20');
        } finally { r.dispose(); }
    });

    it.each(['=', '/=', '//=', '**=', 'mod=', 'and=', 'or=', 'xor='])('rejects %s accumulation', operator => {
        const r = runtime();
        try {
            r.execute('A = array 10 20');
            expect(() => r.execute(`A (array 0 0) ${operator} 2 .accumulate`)).toThrow(/accumulate supports only/);
            expect(formatValue(r.execute('A')!)).toBe('10 20');
        } finally { r.dispose(); }
    });

    it('rejects unindexed and nonnumeric targets', () => {
        const r = runtime();
        try {
            r.execute('use algo\nA = array "x" "y"\nC = new counter\nN = 1');
            expect(() => r.execute('A (array 0 0) += "z" .accumulate')).toThrow(/numeric/);
            expect(() => r.execute('C 0 += 1 .accumulate')).toThrow(/numeric array target/);
            expect(() => r.execute('N += 1 .accumulate')).toThrow(/indexed array assignment/);
        } finally { r.dispose(); }
    });

    it('captures reversed stored weights before writing', () => {
        const r = runtime();
        try {
            r.execute('A = array 2 3 4 5\nA (array 0 0 1 1) += A (3 to 0 by -1) .accumulate');
            expect(formatValue(r.execute('A')!)).toBe('11 8 4 5');
        } finally { r.dispose(); }
    });

    it('reads opaque RHS cells once in order and preserves the target on a late error', () => {
        const r = runtime();
        const reads: number[] = [];
        try {
            r.execute('A = array 10 20');
            r.variables.set('Weights', { kind: 'array', shape: [2], items: [], itemAt: index => {
                reads.push(index);
                if (index === 1) throw new Error('late weight failure');
                return 2n;
            } });
            expect(() => r.execute('A (array 0 0) += Weights .accumulate')).toThrow('late weight failure');
            expect(reads).toEqual([0, 1]);
            expect(formatValue(r.execute('A')!)).toBe('10 20');
        } finally { r.dispose(); }
    });

    it('keeps exact integers across fixed-width overflow', () => {
        const r = runtime();
        try {
            r.variables.set('A', typedArray(new BigInt64Array([9223372036854775807n])));
            r.execute('A (array 0 0) += 1 .accumulate');
            expect(r.execute('A 0')).toBe(9223372036854775809n);
            r.execute('A (array 0 0) *= 18446744073709551616 .accumulate');
            expect(r.execute('A 0')).toBe(9223372036854775809n * (1n << 128n));
        } finally { r.dispose(); }
    });

    it('handles scalar and vector accumulating writes in loops', () => {
        const r = runtime();
        try {
            expect(r.execute(`use sequences
fun N histogram
 A = array shape 2 fill 0
 for I in 1 to N
  A (array 0 0 1) += 1 .accumulate
  A 1 -= 1 .accumulate
 end
 return A sum
end
5 histogram`)).toBe(10n);
        } finally { r.dispose(); }
    });
});

it('uses the integer bulk writer for duplicate accumulation and retains a reference path', () => {
    for (const compilation of [false, true]) {
        const r = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => r.execute('A = array 10\nA (array 0 0) += 2 .accumulate'));
            expect(r.execute('A 0')).toBe(14n);
            expect(diagnostics.bulkArrayWrites).toBe(compilation ? 1 : 0);
        } finally { r.dispose(); }
    }
});

it('cancels an accumulating write without replaying it', () => {
    const r = new Interpreter();
    const d = new RuntimeDiagnostics();
    try {
        r.execute('A = array 0\nIx = array shape 10000 fill 0');
        const signal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => d.bulkArrayWrites ? 1 : 0 };
        expect(() => withInterrupt(signal, () => d.run(() => r.execute('A Ix += 1 .accumulate\nAfter = 1')))).toThrow(InterruptedError);
        expect(r.variables.has('After')).toBe(false);
        const value = r.execute('A 0') as bigint;
        expect(value).toBeGreaterThan(0n);
        expect(value).toBeLessThan(10000n);
    } finally { r.dispose(); }
});

it.each(['+=', '-=', '*='] as const)('matches a scalar oracle for dense repeated %s, including negative and zero factors', operator => {
    for (const operand of [0n, 1n, -1n, 2n, -3n]) {
        const input = [0n, 1n, -7n, 9223372036854775807n];
        const indices = Array.from({ length: 128 }, (_, i) => (i * 13 + (i >> 2)) % input.length);
        const expected = [...input];
        for (const index of indices) expected[index] = operator === '+=' ? expected[index] + operand
            : operator === '-=' ? expected[index] - operand : expected[index] * operand;
        for (const compilation of [false, true]) {
            const r = new Interpreter(undefined, { compilation });
            try {
                r.variables.set('A', typedArray(BigInt64Array.from(input)));
                r.variables.set('Ix', typedArray(BigInt64Array.from(indices, BigInt)));
                r.variables.set('Operand', operand);
                r.execute(`A Ix ${operator} Operand .accumulate`);
                for (let index = 0; index < input.length; index++) expect(r.execute(`A ${index}`)).toBe(expected[index]);
            } finally { r.dispose(); }
        }
    }
});

it.each(['+=', '-=', '*='] as const)('reduces dense weighted %s exactly across Number and int64 boundaries', operator => {
    const patterns = [[1n, -2n, 3n], [9007199254740991n, 1n, -9007199254740991n],
        [9223372036854775807n, -9223372036854775808n, 3n], [1n << 80n, 0n, -7n]];
    for (const pattern of patterns) {
        const indices = Array.from({ length: 64 }, (_, i) => (i * 13 + (i >> 2)) % 4);
        const weights = indices.map((_, i) => pattern[i % pattern.length]);
        const expected = [0n, 1n, -3n, 9223372036854775807n];
        const original = [...expected];
        for (let i = 0; i < indices.length; i++) {
            const index = indices[i], value = weights[i];
            expected[index] = operator === '+=' ? expected[index] + value
                : operator === '-=' ? expected[index] - value : expected[index] * value;
        }
        for (const compilation of [false, true]) {
            const r = new Interpreter(undefined, { compilation });
            try {
                r.variables.set('A', typedArray(BigInt64Array.from(original)));
                r.variables.set('Ix', typedArray(BigInt64Array.from(indices, BigInt)));
                r.variables.set('Weights', ownedArray(weights));
                r.execute(`A Ix ${operator} Weights .accumulate`);
                for (let index = 0; index < expected.length; index++) expect(r.execute(`A ${index}`)).toBe(expected[index]);
            } finally { r.dispose(); }
        }
    }
});
