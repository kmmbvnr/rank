import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';
function execute(source: string, compilation = false, budget = false) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const run = () => diagnostics.run(() => runtime.execute(source));
        if (budget) withDemandBudget(100000, run); else run();
        return { diagnostics, values: Object.fromEntries([...runtime.variables].map(([name, value]) => [name, formatValue(value)])) };
    } finally { runtime.dispose(); }
}
describe.each([false, true])('native scalar extrema writes compilation=%s', compilation => {
    it.each(['min', 'max'])('streams %s with an independent old alias', operation => {
        const result = execute(`use sequences
A = 1 to 200 copy
Alias = A
Slots = 0 to 198 by 2
A Slots = A Slots ${operation} 150
Done = 1`, compilation);
        const original = Array.from({ length: 200 }, (_, i) => i + 1);
        expect(result.values.A).toBe(original.map((v, i) => i % 2 ? v : Math[operation as 'min' | 'max'](v, 150)).join(' '));
        expect(result.values.Alias).toBe(original.join(' '));
        expect(result.diagnostics.fusedArrayUpdates).toBe(1);
        expect(result.diagnostics.fusedArrayUpdateCells).toBe(100);
    });
    it('supports reverse matrix rows', () => {
        const result = execute(`use sequences
A = array shape 2 200 fill 1
Slots = 199 to 1 by -2
A 1 Slots = A 1 Slots max 3
Done = 1`, compilation);
        expect(result.values.A).toBe(Array.from({ length: 400 }, (_, i) => i >= 200 && i % 2 ? 3 : 1).join(' '));
        expect(result.diagnostics.fusedArrayUpdates).toBe(1);
    });
    it('declines overlapping unequal selections', () => {
        const result = execute(`use sequences
A = 1 to 200 copy
Left = 0 to 99
Right = 1 to 100
A Left = A Right max 50
Done = 1`, compilation);
        expect(result.values.A).toBe(Array.from({ length: 200 }, (_, i) => i < 100 ? Math.max(i + 2, 50) : i + 1).join(' '));
        expect(result.diagnostics.fusedArrayUpdates).toBe(0);
    });
    it.each([['4000000000', '3'], ['1.5', '3.5']])('keeps other storage and kinds on ordinary dispatch: %s', (initial, bound) => {
        const result = execute(`use sequences\nA = array shape 100 fill ${initial}\nSlots = 0 till 100\nA Slots = A Slots max ${bound}\nDone = 1`, compilation);
        expect(result.values.A).toBe(Array(100).fill(Math.max(Number(initial), Number(bound))).join(' '));
        expect(result.diagnostics.fusedArrayUpdates).toBe(0);
    });
    it('preserves custom functions and budget dispatch', () => {
        const source = `use sequences
A = array shape 100 fill 1
Slots = 0 till 100
A Slots = A Slots max 3
Done = 1`;
        expect(() => execute(`fun Left max Right\n return Left + Right\nend\n${source}`, compilation)).toThrow('cannot redefine available builtin: max');
        const budget = execute(source, compilation, true);
        expect(budget.values.A).toBe(Array(100).fill(3).join(' '));
        expect(budget.diagnostics.fusedArrayUpdates).toBe(0);
    });
});
