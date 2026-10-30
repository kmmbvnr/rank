import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type NativeFunction, type RankArray } from '../src/index.js';

function run(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        try { diagnostics.run(() => runtime.execute('use numbers\nuse sequences\n' + source)); }
        catch (cause) { error = cause instanceof RankError ? cause.format() : String(cause); }
        const values: Record<string, string> = {};
        for (const name of ['Answer', 'Saved', 'Again', 'Before', 'After']) {
            const value = runtime.variables.get(name);
            if (value !== undefined) values[name] = formatValue(value);
        }
        return { values, error, diagnostics };
    } finally { runtime.dispose(); }
}

describe('type-preserving abs and integer tensor extrema', () => {
    it('fuses abs, min and max through a numeric sum consumer', () => {
        const source = `Input = -2500 to 2499 array
Magnitude' = (Input * 3 - 7) abs
Limited' = (Magnitude min 100) max 4
Answer = Limited sum`;
        const actual = run(source, true), expected = run(source, false);
        expect(actual.values).toEqual(expected.values);
        expect(actual.error).toBeUndefined();
        expect(actual.diagnostics.numberTensors).toBeGreaterThan(0);
        expect(actual.diagnostics.cellsComputed).toBeLessThan(10);
    });

    it.each([
        'Input = array -9007199254740993 9007199254740992\nAnswer = ((Input + 1) abs) sum',
        'Input = array -4503599627370495 -4503599627370495 -4\nAnswer = ((Input * 2) abs) sum',
        'Input = array 1 1 1\nAnswer = (((Input * 4503599627370496) abs) min 9007199254740993) sum',
        'Input = array -2.5 0.0 4.5\nAnswer = ((Input - 1.0) abs) sum',
        'Input = array -2 0.0 4\nAnswer = ((Input - 1) abs) sum',
        'Input = array shape 0 fill 1\nAnswer = ((Input // 0) abs) sum',
        "Input = array 1 0 2\nBefore = 3\nAnswer = ((12 // Input) abs) sum\nAfter = 9",
        "Input = array 1 0\nBefore = 3\nAnswer = (((12 // Input) abs) min (Input // 0)) sum\nAfter = 9",
        "Input = array 1 2\nAnswer = ((Input abs) min (array 1 2 3)) sum",
        "Input = array 1 2\nUnused' = (Input // 0) abs\nSaved = 7",
        `Input = array -1 2 -3
Later' = (Input * 2) abs
Saved = Later
Saved 0 = 99
Input = array 100 200 300
Again = Later
Answer = Again sum`,
    ])('preserves exact results, observation boundaries and first errors: %s', source => {
        const actual = run(source, true), expected = run(source, false);
        expect({ values: actual.values, error: actual.error }).toEqual({ values: expected.values, error: expected.error });
    });

    it('retains real abs semantics for signed zero, infinities and NaN', () => {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute('use numbers');
                runtime.variables.set('Input', { kind: 'array', shape: [5], items: [-0, 0, -Infinity, Infinity, NaN] });
                runtime.execute('Answer = (Input * 1.0) abs');
                const answer = runtime.variables.get('Answer') as RankArray;
                expect([...answer.items]).toEqual([0, 0, Infinity, Infinity, NaN]);
                expect(Object.is(answer.items[0], -0)).toBe(false);
            } finally { runtime.dispose(); }
        }
    });

    it('does not treat a replaced builtin body as intrinsic abs', () => {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute('use numbers\nInput = array -1 -2');
                const fn = runtime.execute('abs') as NativeFunction;
                const original = fn.call;
                Reflect.set(fn, 'call', () => 42n);
                try {
                    runtime.execute('Answer = ((Input * 2) abs) sum');
                    expect(runtime.variables.get('Answer')).toBe(84n);
                } finally { Reflect.set(fn, 'call', original); }
            } finally { runtime.dispose(); }
        }
    });

    it('keeps opaque readers in ordinary demand order', () => {
        const execute = (compilation: boolean) => {
            const runtime = new Interpreter(() => {}, { compilation }), reads: number[] = [];
            try {
                runtime.variables.set('Input', { kind: 'array', shape: [3], items: [],
                    itemAt(i: number) { reads.push(i); return BigInt(i - 1); } });
                runtime.execute("use numbers\nLater' = (Input * 2) abs");
                expect(reads).toEqual([]);
                runtime.execute('Answer = Later sum');
                return { reads, answer: runtime.variables.get('Answer') };
            } finally { runtime.dispose(); }
        };
        expect(execute(true)).toEqual(execute(false));
    });
});
