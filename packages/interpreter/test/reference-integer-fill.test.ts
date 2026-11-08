import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { typedArray, prepareIntegerScalarDivision } from '../src/array-storage.js';
import { withInterrupt, withDemandBudget } from '../src/interrupt.js';

function execute(source: string, cells = false) {
    const runtime = new Interpreter(() => {}, { compilation: false });
    const diagnostics = new RuntimeDiagnostics();
    const run = () => diagnostics.run(() => runtime.execute(source));
    let result: string | undefined, error: string | undefined;
    try {
        try {
            // Arbitrary host polling keeps the ordinary per-cell writer. The
            // no-op signal gives an independent oracle without a new option.
            const value = cells ? withInterrupt({ length: 1, load: () => 0,
                store: () => {}, exchange: () => 0, wait: () => {} }, run) : run();
            if (value !== undefined) result = formatValue(value);
        } catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { state: { result, error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) }, diagnostics };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const actual = execute(source), ordinary = execute(source, true);
    expect(actual.state).toEqual(ordinary.state);
    expect(ordinary.diagnostics.bulkArrayWrites).toBe(0);
    expect(actual.diagnostics.compiledLoops).toBe(0);
    return actual;
}

describe('native scalar integer fills without compilation', () => {
    it.each([
        'A (0 to 5 by 2) = 9',
        'A (5 to 1 by -2) = -9',
        'A (0 till 6) = A 0',
        'A (0 to 5) = 3000000000',
        'A (0 to 5) = -9223372036854775809',
        'A (0 to 5) = 9223372036854775808',
    ])('uses the primitive and preserves aliases: %s', statement => {
        const result = compare(`A = array 1 2 3 4 5 6
Alias = A
Cut = A (1 to 3)
${statement}`);
        expect(result.state.error).toBeUndefined();
        expect(result.diagnostics.bulkArrayWrites).toBe(1);
    });

    it('handles scalar prefixes of higher-rank arrays', () => {
        const result = compare(`A = array shape 2 2 4 fill 0
A 1 0 (3 to 1 by -1) = 7`);
        expect(result.diagnostics.bulkArrayWrites).toBe(1);
    });

    it.each([
        'A (99 till 0) = 1 // 0',
        'A (0 to 6) = 1 // 0',
        'A (0 to 5 by 0) = 1 // 0',
        'A (0 to 5) = 1 // 0',
        'A (99 till 0) = 7',
        'A (0 to 5) = 7\nS = 1 // 0',
    ])('preserves selection errors, empty writes and preceding state: %s', statement => {
        compare(`A = array 1 2 3 4 5 6
S = 1
${statement}`);
    });

    it.each([
        ['A (0 to 5) += 2', 1],
        ['A (0 to 5) = A (5 to 0 by -1)', 0],
        ['A (array 0 0 2) = 2', 1],
        ['A (array 0 0 2) += 2 .accumulate', 1],
    ] as const)('matches the per-cell oracle for compound, vector and indirect writes: %s', (statement, batches) => {
        const result = compare(`A = array 1 2 3 4 5 6
${statement}`);
        expect(result.diagnostics.bulkArrayWrites).toBe(batches);
    });

    it('cooperatively cancels a long fill and runs finally', () => {
        const runtime = new Interpreter(() => {}, { compilation: false });
        const flag = new Int32Array([1]);
        try {
            runtime.execute('A = array shape 100000 fill 0\nDone = 0');
            expect(() => withInterrupt(flag, () => runtime.execute(`try
 A (0 till 100000) = 1
finally
 Done = 1
end`))).toThrow('Interrupted');
            expect(runtime.variables.get('Done')).toBe(1n);
        } finally { runtime.dispose(); }
    });
});

describe('native positive integer division without compilation', () => {
    it.each([1, 2, 3, 9007199254740991])('divides Int32 values exactly by %s and preserves aliases', divisor => {
        const result = compare(`A = array shape 64 fill 0
A 0 = -2147483648
A 1 = -9
A 2 = -1
A 4 = 7
A 5 = 2147483647
Alias = A
Cut = A (1 to 3)
A (5 to 1 by -2) //= ${divisor}`);
        expect(result.state.error).toBeUndefined();
        expect(result.diagnostics.bulkArrayWrites).toBe(1);
    });

    it('handles a strided row of a higher-rank array', () => {
        const result = compare(`A = array shape 2 2 32 fill -11
A 1 0 (5 to 1 by -2) //= 3`);
        expect(result.diagnostics.bulkArrayWrites).toBe(1);
    });

    it.each([
        'A (0 to 5) //= 0',
        'A (0 to 5) //= -2',
        'A (0 to 5) //= 9007199254740992',
        'A (0 to 5) //= array 1 2 0 4 5 6',
        'A (array 0 0 2) //= 2',
        'A (99 till 0) //= 2',
        'A (99 till 0) //= 1 // 0',
        'A (0 to 64) //= 1 // 0',
        'A (0 to 5 by 0) //= 2',
    ])('retains ordinary fallbacks and error order: %s', statement => {
        const result = compare(`A = array shape 64 fill 64
${statement}`);
        expect(result.diagnostics.bulkArrayWrites).toBe(0);
    });

    it.each(['3000000000', '0.0', '.NA'])('retains ordinary storage semantics for %s', value => {
        const result = compare(`A = array shape 64 fill ${value}
A (0 to 5) //= 2`);
        expect(result.diagnostics.bulkArrayWrites).toBe(0);
    });

    it('retains a budgeted write on the ordinary path after warmup', () => {
        const run = (callbacks: boolean) => {
            const runtime = new Interpreter(() => {}, { compilation: false }), diagnostics = new RuntimeDiagnostics();
            try {
                runtime.execute('A = array shape 100 fill 64\nA (0 till 100) //= 2');
                const write = () => diagnostics.run(() => runtime.execute('A (0 till 100) //= 2'));
                let error: string | undefined;
                try { withDemandBudget(5, () => callbacks
                    ? withInterrupt({ length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} }, write) : write()); }
                catch (failure) { error = String(failure); }
                expect(error).toContain('demand budget exhausted');
                expect(diagnostics.bulkArrayWrites).toBe(0);
                return { error, values: formatValue(runtime.variables.get('A')!) };
            } finally { runtime.dispose(); }
        };
        expect(run(false)).toEqual(run(true));
    });
});

it('declines shared buffers, custom headers and real storage before a native division', () => {
    const range = { offset: 0, stride: 1 };
    const shared = typedArray(new Int32Array(new SharedArrayBuffer(64 * 4)));
    expect(prepareIntegerScalarDivision(shared, 64, range, 2n)).toBeUndefined();
    const custom = typedArray(new Int32Array(64));
    let reads = 0;
    Object.defineProperty(custom, 'itemAt', { get() { reads++; return undefined; } });
    expect(prepareIntegerScalarDivision(custom, 64, range, 2n)).toBeUndefined();
    expect(reads).toBe(0);
    const ready = typedArray(new Int32Array(64));
    expect(prepareIntegerScalarDivision(ready, 2, { offset: 63, stride: 1 }, 2n)).toBeUndefined();
    let headers = 0;
    const foreign = new Proxy(ready, { getOwnPropertyDescriptor(target, name) {
        headers++; return Reflect.getOwnPropertyDescriptor(target, name);
    } });
    expect(prepareIntegerScalarDivision(foreign, 64, range, 2n)).toBeUndefined();
    expect(headers).toBe(0);
    const real = typedArray(new Float64Array(64));
    expect(prepareIntegerScalarDivision(real, 64, range, 2n)).toBeUndefined();
});
