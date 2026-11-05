import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
function run(source: string, compilation: boolean, numberLoopCompilation = true) {
    const r = new Interpreter(() => {}, { compilation, numberLoopCompilation }), d = new RuntimeDiagnostics();
    try {
        const split = source.indexOf('\nfor I');
        r.execute(source.slice(0, split));
        let value: string | undefined, error: string | undefined;
        try { value = formatValue(d.run(() => r.execute(source.slice(split + 1)))!); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, result: { value, error, state: [...r.variables].map(([k, v]) => [k, formatValue(v)]) } };
    } finally { r.dispose(); }
}
function compare(source: string) {
    const a = run(source, true), b = run(source, false);
    expect(a.result).toEqual(b.result);
    expect(a.result).toEqual(run(source, true, false).result);
    return a.d;
}
const program = (op: string, a = 'array 1 2 2 5', tail = '') => `use sequences
use algo
A = ${a}
Dest = array shape 8 fill 0
for I in 0 till 8
 Target = I - 1
 Slot = A ${op} Target
 Dest I = Slot
 ${tail}
end`;
describe('sorted insertion indexes in numeric regions', () => {
    it.each(['lowerindex', 'upperindex'])('lowers %s including equal cells and endpoint targets', op => {
        expect(compare(program(op)).numberLoops).toBeGreaterThan(0);
    });
    it.each(['array shape 0 fill 0', 'array 2', 'array 9007199254740993 9007199254740995', 'array 1.5 2.5'])('retains result and error contracts for %s', a => {
        compare(program('lowerindex', a));
        compare(program('upperindex', a));
    });
    it('observes private stores made before each search', () => {
        compare(program('upperindex', 'array 0 2 4 6', 'A 0 = I'));
    });
    it('publishes stores before a later error', () => {
        compare(program('upperindex', 'array 1 2 2 5', 'Value = 1 // (4 - I)'));
    });
    it.each(['budget', 'cancel'])('preserves native search observation with %s', mode => {
        const r = new Interpreter(() => {}, { scalarEntryCompilation: false }), d = new RuntimeDiagnostics();
        try {
            const source = program('upperindex'); const split = source.indexOf('\nfor I'); r.execute(source.slice(0, split));
            const execute = () => d.run(() => r.execute(source.slice(split + 1)));
            if (mode === 'budget') withDemandBudget(100000, execute);
            else withInterrupt({ length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} }, execute);
            if (mode === 'budget') expect(d.fallbacks['number-loop:observable-sorted-search']).toBeGreaterThan(0);
            expect(d.numberLoops).toBe(0);
            expect(formatValue(r.variables.get('Dest')!)).toBe('0 0 1 3 3 3 4 4');
        } finally { r.dispose(); }
    });
});
