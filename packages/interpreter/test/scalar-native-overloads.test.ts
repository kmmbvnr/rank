import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = `use numbers
fun X helper
  A = X abs
  B = A min X
  return B max X
end`;
function evaluate(value: bigint | number, compilation: boolean) {
    const diagnostics = new RuntimeDiagnostics(), runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute(source);
        runtime.variables.set('Input', value);
        const result = diagnostics.run(() => runtime.execute('Input helper'));
        return { result, diagnostics };
    } finally { runtime.dispose(); }
}
describe('native scalar overloads', () => {
    it.each([0n, -123n, -(10n ** 40n), -0, 0, -1.5, Infinity, -Infinity, NaN])('preserves abs/extrema semantics for %s', value => {
        const reference = evaluate(value, false), candidate = evaluate(value, true);
        expect(Object.is(candidate.result, reference.result)).toBe(true);
        if (typeof value === 'bigint' && value >= -9007199254740991n) expect(candidate.diagnostics.numberFunctions).toBe(1);
    });

    it('retains bounded proof work for excessive scalar bodies', () => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => calls++ });
        try {
            const body = Array.from({ length: 600 }, () => ' X += 1').join('\n');
            expect(runtime.execute(`fun X huge\n${body}\n return X\nend\n0 huge`)).toBe(600n);
            expect(calls).toBe(0);
        } finally { runtime.dispose(); }
    });
});
