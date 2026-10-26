import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, type RankArray } from '../src/index.js';
import { readArrayItem, typedArray, storedScalarKinds, writeComputedSelection } from '../src/array-storage.js';
import { withDemandBudget } from '../src/interrupt.js';

describe.each([false, true])('computed array writes (compilation=%s)', compilation => {
    function fixture(source: string, values?: { A?: Int32Array | Float64Array; B?: Int32Array | Float64Array }) {
        const r = new Interpreter(undefined, { compilation });
        const d = new RuntimeDiagnostics();
        r.execute('use sequences\nuse numbers');
        for (const [name, cells] of Object.entries(values ?? {})) if (cells) {
            r.variables.set(`Seed${name}`, typedArray(cells));
            r.execute(`${name} = Seed${name}`);
        }
        try { d.run(() => r.execute(source)); }
        catch (error) { r.dispose(); throw error; }
        return { r, d };
    }

    it('fuses independent arithmetic with unique affine addressing', () => {
        const { r, d } = fixture(`A = array shape 10000 fill 1
K = 2 to 100 array
At' = 2 * K
A At += 2 * K + 3
Done = true`);
        try {
            expect(r.execute('A sum')).toBe(20395n);
            expect(d.fusedArrayUpdates).toBe(compilation ? 1 : 0);
        } finally { r.dispose(); }
    });

    it('reads aligned original cells for a totient update', () => {
        const a = Int32Array.from({ length: 256 }, (_, i) => i);
        const { r, d } = fixture('I = 2 to 254 by 2 array\nA I -= A I // 2\nDone = true', { A: a });
        try {
            const result = r.variables.get('A') as RankArray;
            for (let i = 0; i < 256; i++) expect(readArrayItem(result, i)).toBe(BigInt(i && i % 2 === 0 ? i / 2 : i));
            expect(d.fusedArrayUpdates).toBe(compilation ? 1 : 0);
        } finally { r.dispose(); }
    });

    it('updates disjoint real rows and preserves an alias', () => {
        const r = new Interpreter(undefined, { compilation }), d = new RuntimeDiagnostics();
        const original = Float64Array.from({ length: 384 }, (_, i) => i + 0.5);
        r.variables.set('Input', typedArray(original.slice(), [3, 128]));
        try {
            r.execute('A = Input\nAlias = A\nRow = 1\nSource = 0\nFactor = 0.25');
            d.run(() => r.execute('A Row -= Factor * A Source\nDone = true'));
            for (let i = 0; i < 128; i++) {
                expect(readArrayItem(r.variables.get('A') as RankArray, 128 + i)).toBe(original[128 + i] - 0.25 * original[i]);
                expect(readArrayItem(r.variables.get('Alias') as RankArray, 128 + i)).toBe(original[128 + i]);
            }
            expect(d.fusedArrayUpdates).toBe(compilation ? 1 : 0);
        } finally { r.dispose(); }
    });

    it('widens after a written prefix without repeating it or corrupting aligned reads', () => {
        const a = new Int32Array(128).fill(2);
        a[31] = 2147483647;
        const { r, d } = fixture('I = 0 till 128 array\nAlias = A\nA I += A I\nDone = true', { A: a.slice() });
        try {
            const result = r.variables.get('A') as RankArray;
            for (let i = 0; i < 128; i++) expect(readArrayItem(result, i)).toBe(BigInt(a[i]) * 2n);
            expect(r.execute('Alias 31')).toBe(2147483647n);
            expect(d.fusedArrayUpdateWidenings).toBe(compilation ? 1 : 0);
        } finally { r.dispose(); }
    });

    it('keeps wide intermediate arithmetic exact even when the final RHS is small', () => {
        const { r, d } = fixture('I = 0 till 128 array\nScale = 2147483647\nA I += B * Scale - B * (Scale - 1)\nDone = true',
            { A: new Int32Array(128).fill(1), B: new Int32Array(128).fill(3) });
        try {
            expect(r.execute('A sum')).toBe(512n);
            expect(d.fusedArrayUpdateWidenings).toBe(compilation ? 1 : 0);
        } finally { r.dispose(); }
    });

    it('retains snapshot semantics for overlapping shifted reads', () => {
        const { r, d } = fixture('I = 0 till 128 array\nJ = 1 to 128 array\nA I += A J\nDone = true',
            { A: Int32Array.from({ length: 256 }, (_, i) => i) });
        try {
            const result = r.variables.get('A') as RankArray;
            for (let i = 0; i < 128; i++) expect(readArrayItem(result, i)).toBe(BigInt(i * 2 + 1));
            expect(d.fusedArrayUpdates).toBe(0);
        } finally { r.dispose(); }
    });

    it('retains last-replacement behavior for repeated indices', () => {
        const { r, d } = fixture('I = array shape 128 fill 0\nB = 0 till 128 array\nA I += B\nDone = true',
            { A: new Int32Array(128).fill(10) });
        try {
            expect(r.execute('A 0')).toBe(137n);
            expect(r.execute('A 1')).toBe(10n);
            expect(d.fusedArrayUpdates).toBe(0);
        } finally { r.dispose(); }
    });

    it('preserves an observed assignment result through the last loop statement', () => {
        const r = new Interpreter(undefined, { compilation }), d = new RuntimeDiagnostics();
        try {
            r.execute('use sequences\nA = array shape 128 fill 1\nI = 0 till 128 array\nB = 0 till 128 array');
            const result = d.run(() => r.execute('for N in 1 to 1\n A I += B\nend'));
            expect(formatValue(result!)).toBe(Array.from({ length: 128 }, (_, i) => i).join(' '));
            expect(d.fusedArrayUpdates).toBe(0);
        } finally { r.dispose(); }
    });

    it('leaves the array unchanged on a zero divisor', () => {
        const r = new Interpreter(undefined, { compilation }), d = new RuntimeDiagnostics();
        try {
            r.execute('use sequences\nA = array shape 128 fill 1\nI = 0 till 128 array');
            expect(() => d.run(() => r.execute('A I -= A I // 0\nDone = true'))).toThrow(/zero/);
            expect(r.execute('A sum')).toBe(128n);
            expect(d.fusedArrayUpdates).toBe(0);
        } finally { r.dispose(); }
    });

    it('keeps real scalar-kind evidence current after producing infinities', () => {
        const { r, d } = fixture('I = 0 till 128 array\nA I *= 2.0\nDone = true',
            { A: new Float64Array(128).fill(1e308) });
        try {
            expect(r.execute('A 0')).toBe(Infinity);
            expect(storedScalarKinds(r.variables.get('A') as RankArray, true)).toEqual(['numeric-limit']);
            expect(d.fusedArrayUpdates).toBe(compilation ? 1 : 0);
        } finally { r.dispose(); }
    });
});

it('keeps dynamic-code failures on the ordinary evaluator', () => {
    const r = new Interpreter(), d = new RuntimeDiagnostics();
    r.execute('use sequences\nA = array shape 128 fill 1\nI = 0 till 128 array\nB = 0 till 128 array');
    const block = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw Error('CSP'); });
    try {
        d.run(() => r.execute('A I += B * 2\nDone = true'));
        expect(r.execute('A sum')).toBe(16384n);
        expect(d.fusedArrayUpdates).toBe(0);
    } finally { block.mockRestore(); r.dispose(); }
});

it('publishes exactly the completed write chunks on bounded cancellation', () => {
    const a = typedArray(new Int32Array(10000));
    expect(() => withDemandBudget(4096, () => writeComputedSelection(a, 10000, 0, 1, (cells, start, end) => {
        for (let i = start; i < end; i++) cells[i] += 1;
        return end;
    }, (_, old) => (old as bigint) + 1n))).toThrow(/budget/);
    expect(readArrayItem(a, 4095)).toBe(1n);
    expect(readArrayItem(a, 4096)).toBe(0n);
});
