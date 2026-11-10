import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
function run(body: string, options = {}) {
    const r = new Interpreter(() => {}, options), d = new RuntimeDiagnostics();
    try {
        r.execute('use sequences\nMask = array shape 1025 fill true\nSaved = Mask');
        let error: string | undefined;
        try { d.run(() => r.execute(body)); } catch (failure) { error = (failure as Error).message; }
        return { error, mask: formatValue(r.variables.get('Mask')!), saved: formatValue(r.variables.get('Saved')!), d };
    } finally { r.dispose(); }
}
it('unpacks private boolean snapshots into bytes and preserves aliases', () => {
    const source = 'for I in 1 to 4\n Keys = I till 1025 by 3\n Mask Keys = false\nend';
    const actual = run(source), reference = run(source, { compilation: false });
    expect(actual.error).toBeUndefined();
    expect(actual.mask).toBe(reference.mask); expect(actual.saved).toBe(reference.saved);
    expect(actual.d.numberLoops).toBe(1);
    expect(actual.d.costs['number-loop.snapshot'].allocatedBytes).toBe(1025);
});
it.each([
    'Mask 5 = false\n Mask 1025 = true',
    'Mask 5 = false\n Bad = 1 // (I - 1)',
])('publishes preceding stores on an ordinary error: %s', body => {
    const source = `for I in 1 to 4\n ${body}\nend`;
    const actual = run(source), reference = run(source, { compilation: false });
    expect(actual.error).toBeTruthy(); expect(actual.error).toBe(reference.error);
    expect(actual.mask).toBe(reference.mask); expect(actual.saved).toBe(reference.saved);
});
it('retains demand budgets, cancellation and alias isolation', () => {
    const r = new Interpreter(() => {}), signal = new Int32Array(new SharedArrayBuffer(4));
    const source = 'for I in 0 till 10000\n Mask (I mod 1025) = false\nend';
    try {
        r.execute('use sequences\nMask = array shape 1025 fill true');
        expect(() => withDemandBudget(4, () => r.execute(source))).toThrow(/demand budget/);
        r.execute('Mask = array shape 1025 fill true\nSaved = Mask'); signal[0] = 1;
        expect(() => withInterrupt(signal, () => r.execute(source))).toThrow(/interrupt|cancel/i);
        expect(r.execute('Saved all')).toBe(true);
    } finally { r.dispose(); }
});
