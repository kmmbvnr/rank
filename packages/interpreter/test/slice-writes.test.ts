import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
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
            r.execute('use algo\nA = array 10 20 30 40\nCalls = new queue\nfun Calls rhs\n Calls push 1\n return 7\nend');
            expect(r.execute('A (0 to 3) += Calls rhs')).toBe(7n);
            expect(r.execute('Calls len')).toBe(1n);
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

describe.each([false, true])('boolean fills (compilation=%s)', compilation => {
    it('fills strided and duplicate selections while preserving snapshots', () => {
        const r = new Interpreter(undefined, { compilation });
        const d = new RuntimeDiagnostics();
        try {
            r.execute('A = array shape 10 fill false\nAlias = A\nCut = A (2 to 4)');
            d.run(() => r.execute('A (2 to 8 by 2) = true\nA (array 4 4) = false'));
            expect(formatValue(r.execute('A')!)).toBe('false false true false false false true false true false');
            expect(formatValue(r.execute('Alias')!)).toBe(Array(10).fill('false').join(' '));
            expect(formatValue(r.execute('Cut')!)).toBe('false false false');
            expect(d.bulkArrayWrites).toBe(compilation ? 2 : 0);
            expect(d.bulkArrayWriteCells).toBe(compilation ? 6 : 0);
            r.execute('A (A equal true) = false');
            expect(formatValue(r.execute('A')!)).toBe(Array(10).fill('false').join(' '));
        } finally { r.dispose(); }
    });

    it('keeps bounds, empty selection and type errors on the reference contract', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('A = array shape 4 fill false');
            expect(() => r.execute('A (0 to 4) = true')).toThrow('out of bounds');
            expect(() => r.execute('A (0 to 3) = 1')).toThrow('cannot receive');
            r.execute('A (8 to 4) = true');
            expect(formatValue(r.execute('A')!)).toBe('false false false false');
            r.execute('I = array shape 4 fill 0');
            expect(() => r.execute('I (0 to 3) = true')).toThrow('cannot receive');
        } finally { r.dispose(); }
    });
});

it('keeps boolean fills observable to arbitrary host polling callbacks', () => {
    const r = new Interpreter();
    const d = new RuntimeDiagnostics();
    let polls = 0;
    try {
        r.execute('A = array shape 10000 fill false');
        const signal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => { polls++; return 0; } };
        withInterrupt(signal, () => d.run(() => r.execute('A (0 to 9999) = true')));
        expect(d.bulkArrayWrites).toBe(0);
        expect(polls).toBeGreaterThan(1);
        expect(r.execute('use sequences\nA all')).toBe(true);
    } finally { r.dispose(); }
});

it('does not infer a range from the name or host indexing hooks', () => {
    const r = new Interpreter();
    try {
        r.execute('A = array 10 20 30 40');
        r.variables.set('Host', { kind: 'sequence', plan: {
            name: '0 to 3', size: { kind: 'exact', value: 2n },
            at: () => 0n,
            *iterate() { yield 3n; yield 1n; },
        } });
        r.execute('A Host += 2');
        expect(formatValue(r.execute('A')!)).toBe('10 22 30 42');
    } finally { r.dispose(); }
});

it('declines a range proof after its iterator is replaced by a host', () => {
    const r = new Interpreter();
    try {
        r.execute('A = array 10 20 30 40\nR = 0 to 3');
        const range = r.variables.get('R') as { plan: { iterate(): IterableIterator<bigint> } };
        range.plan.iterate = function* () { yield 3n; };
        r.execute('A R += 1');
        expect(formatValue(r.execute('A')!)).toBe('10 20 30 41');
    } finally { r.dispose(); }
});

it('promotes a fixed-width integer buffer before overflowing 64 bits', () => {
    const r = new Interpreter();
    try {
        r.variables.set('A', typedArray(new BigInt64Array([9223372036854775807n, 1n])));
        r.execute('A (0 to 1) += 1');
        expect(formatValue(r.execute('A')!)).toBe('9223372036854775808 2');
    } finally { r.dispose(); }
});

it('can cancel a long bulk commit without replaying it', () => {
    const r = new Interpreter();
    const d = new RuntimeDiagnostics();
    try {
        r.execute('A = array shape 10000 fill 0');
        const signal = {
            length: 1, load: () => 0, store() {}, wait() {},
            exchange: () => d.bulkArrayWrites ? 1 : 0,
        };
        expect(() => withInterrupt(signal, () => d.run(() => r.execute('A (0 to 9999) += 1\nAfter = 1')))).toThrow(InterruptedError);
        expect(d.bulkArrayWrites).toBe(1);
        expect(r.variables.has('After')).toBe(false);
        const sum = r.execute('A sum') as bigint;
        expect(sum).toBeGreaterThan(0n);
        expect(sum).toBeLessThan(10000n);
    } finally { r.dispose(); }
});

it('establishes scalar-fill type once without scanning repeated cells', () => {
    const r = new Interpreter();
    const d = new RuntimeDiagnostics();
    try {
        d.run(() => r.execute('A = array shape 10000 fill 0\nA (0 to 9999) += 1'));
        expect(d.elementTypeScannedCells).toBe(0);
        expect(r.execute('A sum')).toBe(10000n);
        expect(() => r.execute('A (0 to 9999) = 1.0')).toThrow('cannot receive');
        r.execute('Empty = array shape 0 fill 0');
        expect(() => r.execute('Empty = array 1.0')).toThrow('cannot receive');
    } finally { r.dispose(); }
});
