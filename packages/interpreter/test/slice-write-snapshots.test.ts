import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { arrayForWrite, createArraySnapshot, holdArraySource, isSharedArray, noteArrayBinding } from '../src/array-storage.js';
import { withInterrupt } from '../src/interrupt.js';
import { applySelectors } from '../src/value-selection.js';
import { semanticArrayType, setSemanticArrayType } from '../src/semantic-array-type.js';

describe.each([false, true])('dense selection snapshots with compilation %s', compiled => {
    const session = () => new Interpreter(undefined, { integerLoopCompilation: compiled,
        scalarCompilation: compiled, tensorCellCompilation: compiled });

    it('retains a named derived slice without copying the source on every write', () => {
        const runtime = session();
        const diagnostics = new RuntimeDiagnostics();
        try {
            const value = diagnostics.run(() => runtime.execute(`use sequences
Limit = 10000
A = 0 to Limit array
for P in primes to Limit
 Hits = P to Limit by P
 Cut = A Hits // P
 A Hits -= Cut
end
A sum`));
            expect(value).toBe(30397486n);
            expect(diagnostics.cowCopies).toBe(0);
            expect(diagnostics.cowCopiedCells).toBe(0);
            expect(diagnostics.selectionSnapshots).toBeGreaterThan(1000);
            expect(diagnostics.selectionSnapshotCells).toBeLessThan(30000);
            // One source scan plus work proportional to selected cells, rather
            // than one 10,001-cell scan per prime.
            expect(diagnostics.elementTypeScannedCells).toBeLessThan(100000);
        } finally { runtime.dispose(); }
    });

    it.each([65535, 65536, 65537])('snapshots %s selected cells without retaining the source', size => {
        const runtime = session();
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(`use sequences\nA = 0 to ${size} array`);
            const source = runtime.variables.get('A');
            diagnostics.run(() => runtime.execute(`S = A (0 to ${size - 1})\nA 0 = 99`));
            expect(runtime.execute('S 0')).toBe(0n);
            expect(runtime.variables.get('A')).toBe(source);
            expect(isSharedArray(source!)).toBe(false);
            expect(diagnostics.cowCopiedCells).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('keeps named operands, aliases, and repeated positions independent', () => {
        const runtime = session();
        try {
            runtime.execute(`use sequences
A = 0 to 9 array
Alias = A
Hits = array 2 4 2
Cut = A Hits // 2
A Hits -= Cut
A 0 = 99`);
            expect(runtime.execute('Cut sum')).toBe(4n);
            expect(runtime.execute('Alias sum')).toBe(45n);
            expect(runtime.execute('A 2')).toBe(1n);
            expect(runtime.execute('A 4')).toBe(2n);
        } finally { runtime.dispose(); }
    });

    it('reads overlapping RHS positions before changing any destination', () => {
        const runtime = session();
        try {
            runtime.execute('use sequences\nA = 0 to 5 array\nA (array 1 2 3) = A (array 0 1 2)');
            expect((runtime.variables.get('A') as RankArray).items).toEqual([0n, 0n, 1n, 2n, 4n, 5n]);
            runtime.execute('B = array 1 2 3\nB (array 1 1 2) += B (array 0 2 1)');
            expect((runtime.variables.get('B') as RankArray).items).toEqual([1n, 5n, 5n]);
        } finally { runtime.dispose(); }
    });

    it('snapshots a contiguous row and an empty slice', () => {
        const runtime = session();
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`use sequences
A = (0 to 11 array) reshape 3 4 copy
Row = A 1
Empty = A (array shape 0 fill 0) #
A 1 0 = 99`));
            expect(runtime.execute('Row sum')).toBe(22n);
            expect(runtime.execute('Empty len')).toBe(0n);
            expect(diagnostics.cowCopies).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('keeps host writes live until the first Rank write, then detaches every retained reader', () => {
        const runtime = session();
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = array 2 4 6 8\nS = A (array 0 2)\nT = A (array 0 3) * 2');
            const source = runtime.variables.get('A') as RankArray;
            expect(runtime.execute('S sum')).toBe(8n);
            source.items[0] = 10n;
            expect(runtime.execute('S sum')).toBe(16n);
            diagnostics.run(() => runtime.execute('A 0 = 99'));
            expect(runtime.variables.get('A')).toBe(source);
            expect(runtime.execute('S sum')).toBe(16n);
            expect(runtime.execute('T sum')).toBe(36n);
            source.items[0] = 20n;
            expect(runtime.execute('S sum')).toBe(16n);
            expect(runtime.execute('T sum')).toBe(36n);
            expect(diagnostics.cowCopies).toBe(0);
            expect(diagnostics.selectionSnapshots).toBe(2);
            expect(diagnostics.selectionSnapshotCells).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('protects readers before a compiled region mutates raw storage', () => {
        const runtime = session();
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = 0 to 9 array\nS = A (array 0 9)');
            diagnostics.run(() => runtime.execute('for I in 0 to 9\n A I += 1\nend'));
            expect(runtime.execute('S sum')).toBe(9n);
            expect(runtime.execute('A sum')).toBe(55n);
            expect(diagnostics.cowCopies).toBe(0);
            expect(diagnostics.selectionSnapshotCells).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('can retry an interrupted snapshot without losing ownership protection', () => {
        const runtime = session();
        try {
            runtime.execute('use sequences\nA = 0 to 10000 array\nS = A (0 till 5000)');
            const source = runtime.variables.get('A')!;
            const signal = new Int32Array(new SharedArrayBuffer(4));
            signal[0] = 1;
            expect(() => withInterrupt(signal, () => arrayForWrite(source))).toThrow();
            expect(isSharedArray(source)).toBe(true);
            runtime.execute('A 0 = 99');
            expect(runtime.execute('S sum')).toBe(12497500n);
        } finally { runtime.dispose(); }
    });

    it.each(['getter', 'read-only cell'])('falls back after the host installs a %s', change => {
        const runtime = session();
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = array 2 4 6\nS = A (array 0 2)');
            const source = runtime.variables.get('A') as RankArray;
            Object.defineProperty(source.items, '0', change === 'getter'
                ? { get() { return 10n; } } : { value: 10n, writable: false });
            diagnostics.run(() => runtime.execute('A 0 = 99'));
            expect(runtime.execute('S sum')).toBe(16n);
            expect(runtime.execute('A 0')).toBe(99n);
            expect(runtime.variables.get('A')).not.toBe(source);
            expect(diagnostics.cowCopies).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('preserves arbitrary-precision integers and rejects invalid writes before mutation', () => {
        const runtime = session();
        try {
            runtime.variables.set('Source', createArraySnapshot([1n << 100n, 2n, 1n << 110n]));
            runtime.execute('A = Source\nS = A (array 0 2)\nA 0 = 0');
            expect((runtime.variables.get('S') as RankArray).items).toEqual([1n << 100n, 1n << 110n]);
            const source = runtime.variables.get('A') as RankArray;
            const before = [...source.items];
            expect(() => runtime.execute('A (array 0 2) /= 2')).toThrow(/array elements/);
            expect(() => runtime.execute('A (array 0 2) = array 1 2 3')).toThrow(/shape mismatch/);
            expect(source.items).toEqual(before);
        } finally { runtime.dispose(); }
    });

    it('does not force lazy or host getters and preserves an unresolved semantic type', () => {
        const runtime = session();
        let reads = 0;
        try {
            runtime.variables.set('Lazy', { kind: 'array', shape: [3], items: [],
                itemAt(index: number) { reads++; return BigInt(index); } });
            runtime.execute('S = Lazy (array 0 2)');
            expect(reads).toBe(0);
            expect(runtime.execute('S 1')).toBe(2n);
            const host: RankArray = { kind: 'array', shape: [3], items: [1n, 2n, 3n] };
            Object.defineProperty(host.items, '0', { get() { reads++; return 1n; } });
            runtime.variables.set('Host', host);
            const before = reads;
            runtime.execute('H = Host (array 0 2)');
            expect(reads).toBe(before);
            const stored = createArraySnapshot([1n, 2n, 3n]);
            setSemanticArrayType(stored, { key: 'unresolved' });
            runtime.variables.set('Stored', stored);
            runtime.execute('T = Stored (array 0 2)');
            expect(semanticArrayType(runtime.variables.get('T') as RankArray).key).toBe('unresolved');
        } finally { runtime.dispose(); }
    });
});

it('preserves additional captured sources when a selection can detach its direct source', () => {
    const source = createArraySnapshot([1n, 2n]);
    const captured = createArraySnapshot([3n]);
    noteArrayBinding(source);
    noteArrayBinding(captured);
    const selection = applySelectors([source, createArraySnapshot([0n])]) as RankArray;
    holdArraySource(selection, captured);
    noteArrayBinding(selection);
    expect(arrayForWrite(captured)).not.toBeUndefined();
    expect(arrayForWrite(source)).toBeUndefined();
    source.items[0] = 9n;
    expect(selection.itemAt!(0)).toBe(1n);
});
