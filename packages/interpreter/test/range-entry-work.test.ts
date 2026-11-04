import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = `use sequences
N = 300000
A = array shape (N + 1) fill 0
Count = 0
for P in 2 to 4
 Slots = (P to N by P) copy
 A Slots = 7
 Count += 1
end`;
function execute(text: string, numberLoopCompilation = true) {
    const runtime = new Interpreter(() => {}, { numberLoopCompilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(text));
        return { diagnostics, values: [runtime.execute('A 0'), runtime.execute('A 2'),
            runtime.execute('A 12'), runtime.execute('A N'), runtime.execute('Count')] };
    } finally { runtime.dispose(); }
}

describe('range entry work without changing copy thresholds', () => {
    it.each(['2 to 4', '4 to 2 by -1'])('counts three leading passes over %s', range => {
        const text = source.replace('2 to 4', range), result = execute(text);
        expect(result.values).toEqual(execute(text, false).values);
        expect(result.values).toEqual([0n, 7n, 7n, 7n, 3n]);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopCopyProbes).toBe(0);
    });
    it.each([
        source.replace('2 to 4', '2 to 2'),
        source.replace('2 to 4', '2 to 3'),
        source.replace(' Slots =', ' if P greater 2\n  break\n end\n Slots ='),
        source.replace(' Slots =', ' if P equal 2\n  continue\n end\n Slots ='),
        source.replace(' A Slots =', ' N -= 1\n A Slots ='),
        source.replace(' A Slots =', ' Slots = 1 to 1 copy\n A Slots ='),
    ])('declines insufficient/unknown work %#', text => {
        const result = execute(text);
        expect(result.values).toEqual(execute(text, false).values);
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(result.diagnostics.fallbacks['number-loop:condition-write-budget']).toBeGreaterThan(0);
    });
    it('keeps the completed range length after its scalar bound changes', () => {
        const text = source.replace(' Slots =', ' End = N // P\n Slots =')
            .replace('(P to N by P)', '(1 to End)').replace(' A Slots =', ' End = 0\n A Slots =');
        const result = execute(text);
        expect(result.values).toEqual(execute(text, false).values);
        expect(result.diagnostics.numberLoops).toBe(1);
    });
});
