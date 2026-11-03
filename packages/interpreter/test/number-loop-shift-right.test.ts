import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { parse } from '../src/parser.js';
import { native } from '../src/modules/shared.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt } from '../src/interrupt.js';

const options = { scalarEntryCompilation: false, scalarFunctionCompilation: false };
function observe(source: string, compilation: boolean) {
    const r = new Interpreter(() => {}, { ...options, compilation }), d = new RuntimeDiagnostics();
    try {
        let error: string | undefined, result: string | undefined;
        try { const value = d.run(() => r.execute(source)); result = value === undefined ? undefined : formatValue(value); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, result, error, state: [...r.variables].map(([name, value]) => [name, formatValue(value)]) };
    } finally { r.dispose(); }
}
function compare(source: string) {
    const expected = observe(source, false), actual = observe(source, true);
    expect(actual.error).toBe(expected.error);
    expect(actual.result).toBe(expected.result);
    expect(actual.state).toEqual(expected.state);
    return actual;
}

it('matches exact signed shifts through the safe-integer and shift-count boundaries', () => {
    const r = new Interpreter(() => {}, options), d = new RuntimeDiagnostics();
    try {
        const edge = 9007199254740991n;
        for (const value of [-edge - 1n, -edge, -2147483649n, -2147483648n, -3n, -1n, 0n, 1n, 3n, 2147483647n, 2147483648n, edge, edge + 1n]) {
            for (const count of [0n, 1n, 3n, 30n, 31n, 32n, 51n, 52n, 53n, 54n, 64n, 1000000n, edge]) {
                r.execute(`use bits\nA = ${value}\nK = ${count}\nR = 0`);
                const result = d.run(() => r.execute('for I in 0 till 2\n R = A shr K\nend\nR'));
                expect(result, `${value} shr ${count}`).toBe(value >> count);
            }
        }
        expect(d.numberLoops).toBeGreaterThan(100);
    } finally { r.dispose(); }
});

it.each(['-1', '-9007199254740991'])('replays negative shift %s after preceding private stores', shift => {
    const actual = compare(`use bits
A = array shape 4 fill 0
Saved = A
R = 0
for I in 0 till 4
 A I = I + 1
 R = I shr ${shift}
end`);
    expect(actual.error).toContain('shift count must be nonnegative');
    expect(actual.d.numberLoopOverflows).toBeGreaterThan(0);
});

it.each(['(-1 isqrt) shr (1 // 0)', '17 shr (1 // 0)', '(1 // 0) shr (-1)'])('retains operand errors and order: %s', expression => {
    const actual = compare(`use bits
use numbers
A = array 0
R = 0
for I in 0 till 2
 A 0 = I + 1
 R = ${expression}
end`);
    expect(actual.error).toBeDefined();
});

it('keeps wide mixed registers exact when a loop-carried value overflows', () => {
    const actual = compare(`use bits
A = array 0
Saved = A
Wide = 9007199254740990
R = 0
for I in 1 to 4
 A 0 += 1
 Wide += 3
 R = Wide shr 1
end
R`);
    expect(actual.error).toBeUndefined();
    expect(actual.result).toBe('4503599627370501');
    expect(actual.d.numberLoopOverflows).toBeGreaterThan(0);
});

it('uses exact shifts when count operands themselves become wide', () => {
    const actual = compare(`use bits
K = 9007199254740990
R = 0
for I in 1 to 4
 K += 3
 R = -9 shr K
end
R`);
    expect(actual.error).toBeUndefined();
    expect(actual.result).toBe('-1');
});

it('publishes a growing numeric buffer in the same region as shifts', () => {
    const actual = compare(`use sequences
use bits
A = array shape 1 fill 0
Saved = A
Total = 0
for I in 0 till 100
 if I at least (A len)
  A = concat A A copy
 end
 A I = (9007199254740991 - I) shr 32
 Total += A I
end`);
    expect(actual.error).toBeUndefined();
    expect(actual.d.numberLoops).toBe(1);
    expect(actual.d.numberLoopOverflows).toBe(0);
});

it('rejects real inputs and missing bits imports through the ordinary evaluator', () => {
    expect(compare('R = 0\nfor I in 0 till 2\n R = I shr 1\nend').error).toBeDefined();
    expect(compare('use bits\nR = 0\nfor I in 0 till 2\n R = 1.5 shr I\nend').error).toBeDefined();
});

it('rechecks cached shift operands after changing domains', () => {
    const r = new Interpreter(() => {}, options);
    const loop = 'for I in 0 till 2\n R = A shr K\nend\nR';
    try {
        for (const [value, count] of [[-3n, 1n], [9007199254740991n, 52n], [-1n, 53n], [9007199254740992n, 1n]]) {
            r.execute(`use bits\nA = ${value}\nK = ${count}\nR = 0`);
            expect(r.execute(loop)).toBe(value >> count);
        }
        r.execute('K = -1');
        expect(() => r.execute(loop)).toThrow('shift count must be nonnegative');
    } finally { r.dispose(); }
});

it('rechecks the native binding before reusing a compiled shift loop', () => {
    const r = new Interpreter(() => {}, options), d = new RuntimeDiagnostics();
    try {
        r.execute('use bits\nR = 0');
        const code = parse('R = 0\nfor I in 0 till 2\n R = I shr 1\nend\nR');
        expect(d.run(() => r.executeProgram(code))).toBe(0n);
        expect(d.numberLoops).toBe(1);
        const seen: unknown[][] = [];
        r.variables.set('shr', native('replacement', 2, values => { seen.push(values); return 777n; }));
        expect(r.executeProgram(code)).toBe(777n);
        expect(seen).toEqual([[0n, 1n], [1n, 1n]]);
    } finally { r.dispose(); }
});

it('honors a demand budget after warming the same loop', () => {
    const r = new Interpreter(() => {}, options), d = new RuntimeDiagnostics();
    const loop = 'for I in 0 till N\n R = A shr K\nend';
    try {
        r.execute('use bits\nA = -9007199254740991\nK = 32\nN = 2\nR = 0');
        r.execute(loop);
        r.execute('N = 1000000');
        expect(() => withDemandBudget(20, () => d.run(() => r.execute(loop)))).toThrow(DemandBudgetExhausted);
        expect(d.numberLoops).toBe(1);
        expect(d.numberLoopUnpolled).toBe(0);
        expect(d.numberLoopBatched).toBe(0);
    } finally { r.dispose(); }
});

it('cancels shifting stores and runs finally without mutating snapshots', () => {
    const r = new Interpreter(() => {}, options), d = new RuntimeDiagnostics();
    try {
        r.execute('use bits\nA = array shape 16 fill 0\nSaved = A\nDone = 0');
        expect(() => withInterrupt(new Int32Array([1]), () => d.run(() => r.execute(`try
 for I in 1 to 1000000
  A (I mod 16) = I shr 1
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
        expect(d.numberLoops).toBeGreaterThan(0);
        expect(r.variables.get('Done')).toBe(1n);
        expect(r.execute('Saved sum')).toBe(0n);
    } finally { r.dispose(); }
});
