import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type RankArray } from '../src/index.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt } from '../src/interrupt.js';

function observe(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, scalarFunctionCompilation: false, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, error, state: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) };
    } finally { runtime.dispose(); }
}

function compare(source: string) {
    const reference = observe(source, false), compiled = observe(source, true);
    expect(compiled.error).toBe(reference.error);
    expect(compiled.state).toEqual(reference.state);
    return compiled.diagnostics;
}

describe('exact modular products in Number loops', () => {
    it('checks signed products, zero and the modulus admission boundaries against BigInt', () => {
        const max = 9007199254740991n;
        const operands = [-max, -1073741825n, -104060401n, -1n, 0n, 1n, 104060400n, 1073741823n, max];
        const moduli = [-104060401n, 0n, 1n, 2n, 101n, 94906265n, 94906266n, 94906267n, 104060401n, 1073741823n, 1073741824n, 1073741825n];
        const runtime = new Interpreter(() => {}, { scalarFunctionCompilation: false, scalarEntryCompilation: false });
        let entries = 0;
        try {
            for (const a of operands) for (const b of operands) for (const m of moduli) {
                runtime.execute(`A = ${a}\nB = ${b}\nM = ${m}\nResult = 0`);
                const diagnostics = new RuntimeDiagnostics();
                const run = () => diagnostics.run(() => runtime.execute('for I in 0 to 100\n Result = A * B mod M\nend\nResult'));
                if (m === 0n) expect(run).toThrow('division by zero');
                else {
                    const product = a * b;
                    let expected = product % m;
                    if (expected !== 0n && (product < 0n) !== (m < 0n)) expected += m;
                    expect(run(), `${a},${b},${m}`).toBe(expected);
                }
                if (m > 0n && m <= 1073741824n) expect(diagnostics.numberLoopOverflows).toBe(0);
                entries += diagnostics.numberLoops;
            }
            expect(entries).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    }, 15_000);

    it.each(['0', '1073741825', '-104060401'])('replays private writes exactly for modulus %s', modulus => {
        compare(`A = array shape 4 fill 0
Saved = A
M = ${modulus}
R = 0
for I in 0 to 3
 A I = I + 1
 R = (9007199254740991 - I) * 999999937 mod M
end`);
    });

    it('keeps wide inputs and ordinary materialized product bindings exact', () => {
        compare(`Wide = 9007199254740991 * 999999937
Result = 0
for I in 0 to 100
 Result = (Wide + I) * 999999937 mod 104060401
end`);
    });

    it('retains a wide ordinary product before its later remainder', () => {
        const diagnostics = compare(`A = array 0
Saved = A
V = 0
R = 0
for I in 0 to 5
 A 0 = I
 V = (999999937 + I) * 999999929
 R = V mod 982451653
end`);
        expect(diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it('rechecks a warmed region when its modulus changes', () => {
        const runtime = new Interpreter(() => {}, { scalarFunctionCompilation: false, scalarEntryCompilation: false });
        const source = 'for I in 0 to 100\n R = (A + I) * B mod M\nend\nR';
        try {
            for (const m of [101n, 94906266n, 94906267n, 982451653n, 1073741824n, 1073741825n, -7n, 0n]) {
                const a = -999999937n, b = 999999929n, product = (a + 100n) * b;
                runtime.execute(`A = ${a}\nB = ${b}\nM = ${m}\nR = 0`);
                if (m === 0n) expect(() => runtime.execute(source)).toThrow('division by zero');
                else {
                    const remainder = product % m;
                    const expected = remainder !== 0n && (product < 0n) !== (m < 0n) ? remainder + m : remainder;
                    expect(runtime.execute(source)).toBe(expected);
                }
            }
        } finally { runtime.dispose(); }
    });

    it.each([1, 999999937])('replays a failing vector RHS without publishing partial writes (fill=%s)', fill => {
        const diagnostics = compare(`A = array shape 128 fill ${fill}
Saved = A
Mods = array shape 128 fill 104060401
Mods 127 = 0
for I in 0 to 2
 A = A * 999999937 mod Mods
end`);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.numberLoopOverflows).toBeGreaterThan(0);
    });

    it.each([[2n, 2n], [999999937n, 999999929n]])('retains operand demand order for safe and wide products (A=%s, B=%s)', (a, b) => {
        const traces: string[][] = [];
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation, scalarFunctionCompilation: false, scalarEntryCompilation: false });
            const trace: string[] = [];
            try {
                for (const [name, value] of [['A', a], ['B', b], ['M', 104060401n]] as const) {
                    const array: RankArray = { kind: 'array', shape: [3], items: [], itemAt(index) { trace.push(`${name}${index}`); return value; } };
                    runtime.variables.set(name, array);
                }
                runtime.execute('R = 0\nfor I in 0 to 2\n R = A I * B I mod M I\nend');
                traces.push(trace);
            } finally { runtime.dispose(); }
        }
        expect(traces[1]).toEqual(traces[0]);
        expect(traces[0]).toEqual(['A0', 'B0', 'M0', 'A1', 'B1', 'M1', 'A2', 'B2', 'M2']);
    });

    it('retains demand budgets in a warmed large-modulus loop', () => {
        const runtime = new Interpreter(() => {}, { scalarFunctionCompilation: false, scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        const source = 'R = 1\nfor I in 1 to N\n R = R * 999999937 mod 982451653\nend\nR';
        try {
            runtime.execute('N = 10');
            runtime.execute(source);
            runtime.execute('N = 1000000');
            expect(() => withDemandBudget(20, () => diagnostics.run(() => runtime.execute(source)))).toThrow(DemandBudgetExhausted);
            expect(diagnostics.numberLoops).toBeGreaterThan(0);
            expect(diagnostics.numberLoopUnpolled).toBe(0);
            expect(diagnostics.numberLoopBatched).toBe(0);
            expect(runtime.execute('7 * 8 mod 13')).toBe(4n);
        } finally { runtime.dispose(); }
    });

    it('polls a modular loop and leaves aliases intact after cancellation', () => {
        const runtime = new Interpreter(() => {}, { scalarFunctionCompilation: false, scalarEntryCompilation: false });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nA = array shape 16 fill 0\nSaved = A\nDone = 0');
            expect(() => withInterrupt(new Int32Array([1]), () => diagnostics.run(() => runtime.execute(`try
 for I in 0 to 1000000
  A (I mod 16) = (999999937 + I) * 999999929 mod 104060401
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            expect(diagnostics.numberLoops).toBeGreaterThan(0);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(runtime.execute('Saved sum')).toBe(0n);
            expect(runtime.execute('7 * 8 mod 13')).toBe(4n);
        } finally { runtime.dispose(); }
    });
});
