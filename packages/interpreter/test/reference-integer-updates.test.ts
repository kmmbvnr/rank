import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, RuntimeDiagnostics, withDemandBudget, withInterrupt, type RankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

const cases = [
    ['0 to 255', Array.from({ length: 256 }, (_, i) => i)],
    ['255 to 0 by -1', Array.from({ length: 256 }, (_, i) => 255 - i)],
    ['array 4 1 4 2', [4, 1, 4, 2]],
] as const;
const operators = ['=', '+=', '-=', '*='] as const;
for (const [selector, positions] of cases) for (const operator of operators) {
    it(`updates native reference cells: ${selector} ${operator}`, () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        const original = Array.from({ length: 256 }, (_, i) => BigInt(i - 128));
        const rhs = positions.map((_, i) => i % 2 ? 2147483647n : -2147483648n);
        runtime.variables.set('Input', typedArray(Int32Array.from(original, Number), [256]));
        runtime.variables.set('Values', typedArray(Int32Array.from(rhs, Number), [rhs.length]));
        runtime.execute('A = Input\nSnapshot = A');
        const expected = [...original];
        positions.forEach((at, i) => {
            expected[at] = operator === '=' ? rhs[i] : operator === '+=' ? original[at] + rhs[i]
                : operator === '-=' ? original[at] - rhs[i] : original[at] * rhs[i];
        });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`A (${selector}) ${operator} Values`));
            const result = runtime.variables.get('A');
            if (!result || !isRankArray(result)) throw Error('expected array');
            expect(Array.from({ length: 256 }, (_, i) => readArrayItem(result, i))).toEqual(expected);
            const snapshot = runtime.variables.get('Snapshot') as RankArray;
            expect(Array.from({ length: 256 }, (_, i) => readArrayItem(snapshot, i))).toEqual(original);
            expect(diagnostics.bulkArrayWrites).toBe(1);
            expect(diagnostics.compiledLoops).toBe(0);
            expect(diagnostics.compiledTensors).toBe(0);
        } finally { runtime.dispose(); }
    });
}
describe('reference native update boundaries', () => {
    it.each(operators)('handles scalar %s without generating code', operator => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        const values = [0n, 1n, 2n, 3n];
        runtime.variables.set('A', typedArray(Int32Array.from(values, Number), [4]));
        const scalar = 2n ** 62n;
        const expected = values.map(value => operator === '=' ? scalar : operator === '+=' ? value + scalar
            : operator === '-=' ? value - scalar : value * scalar);
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`A (0 to 3) ${operator} 4611686018427387904`));
            expect((runtime.variables.get('A') as RankArray).items).toEqual(expected);
            expect(diagnostics.bulkArrayWrites).toBe(1);
            expect(diagnostics.compiledLoops).toBe(0);
        } finally { runtime.dispose(); }
    });
    it.each(['budget', 'observer'])('retains the ordinary %s path', mode => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        runtime.variables.set('A', typedArray(Int32Array.of(0, 0, 0), [3]));
        runtime.variables.set('Values', typedArray(Int32Array.of(1, 2, 3), [3]));
        const diagnostics = new RuntimeDiagnostics();
        const signal = { length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} };
        try {
            const run = () => runtime.execute('A (0 to 2) += Values');
            diagnostics.run(() => mode === 'budget' ? withDemandBudget(10000, run) : withInterrupt(signal, run));
            expect((runtime.variables.get('A') as RankArray).items).toEqual([1n, 2n, 3n]);
            expect(diagnostics.bulkArrayWrites).toBe(0);
        } finally { runtime.dispose(); }
    });
    it.each(['+=', '-=', '*='])('accumulates repeated scalar %s updates', operator => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        runtime.variables.set('A', typedArray(Int32Array.of(10, 10, 10), [3]));
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`A (array 1 1 2) ${operator} 2 .accumulate`));
            const expected = operator === '+=' ? [10n, 14n, 12n] : operator === '-=' ? [10n, 6n, 8n] : [10n, 40n, 20n];
            expect((runtime.variables.get('A') as RankArray).items).toEqual(expected);
            expect(diagnostics.bulkArrayWrites).toBe(1);
            expect(diagnostics.compiledLoops).toBe(0);
        } finally { runtime.dispose(); }
    });
    it.each(['budget', 'observer'])('retains the ordinary scalar accumulation %s path', mode => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        runtime.variables.set('A', typedArray(Int32Array.of(0, 0, 0), [3]));
        const diagnostics = new RuntimeDiagnostics();
        const signal = { length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} };
        try {
            const run = () => runtime.execute('A (array 0 0 1) += 2 .accumulate');
            diagnostics.run(() => mode === 'budget' ? withDemandBudget(10000, run) : withInterrupt(signal, run));
            expect((runtime.variables.get('A') as RankArray).items).toEqual([4n, 2n, 0n]);
            expect(diagnostics.bulkArrayWrites).toBe(0);
        } finally { runtime.dispose(); }
    });
    it('widens through int64 to arbitrary precision', () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        const values = [1n, 2n, 3n, 4n];
        runtime.variables.set('A', typedArray(Int32Array.from(values, Number), [4]));
        runtime.variables.set('Values', typedArray(BigInt64Array.from(values.map(() => 2n ** 62n)), [4]));
        try {
            runtime.execute('A (0 to 3) *= Values');
            const result = runtime.variables.get('A') as RankArray;
            expect(result.items).toEqual(values.map(x => x * 2n ** 62n));
        } finally { runtime.dispose(); }
    });
    it('snapshots an aliased reversed RHS before storing', () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        runtime.variables.set('A', typedArray(Int32Array.of(1, 2, 3, 4), [4]));
        try {
            runtime.execute('A (0 to 3) += A (3 to 0 by -1)');
            expect((runtime.variables.get('A') as RankArray).items).toEqual([5n, 5n, 5n, 5n]);
        } finally { runtime.dispose(); }
    });
    it('retains opaque RHS reads before any destination writes', () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        runtime.variables.set('A', typedArray(Int32Array.of(0, 0, 0), [3]));
        const seen: unknown[] = [];
        runtime.variables.set('Values', { kind: 'array', shape: [3], items: [], itemAt: () => {
            seen.push(readArrayItem(runtime.variables.get('A') as RankArray, 0));
            return 2n;
        } });
        try {
            runtime.execute('A (0 to 2) += Values');
            expect(seen).toEqual([0n, 0n, 0n]);
            expect((runtime.variables.get('A') as RankArray).items).toEqual([2n, 2n, 2n]);
        } finally { runtime.dispose(); }
    });
});
