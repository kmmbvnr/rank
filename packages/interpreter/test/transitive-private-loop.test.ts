import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
const source = `fun Count table
 Values = array shape Count fill 0
 for I in 0 till Count
  Values I = I + 1
 end
 return Values
end
fun Count total
 Values = Count table
 Sum = 0
 for I in 0 till Count
  Sum += Values I
 end
 return Sum
end
Answer = 1000 total`;
it('keeps an allocating helper on its private Number loop path through a scalar caller', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(runtime.variables.get('Answer')).toBe(500500n);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    } finally { runtime.dispose(); }
});
it('retains ordinary reference execution for the same allocating call graph', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(500500n); }
    finally { runtime.dispose(); }
});
