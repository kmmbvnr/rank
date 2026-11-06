import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const input = Int32Array.from({ length: 2053 }, (_, i) =>
    [2147483647, -2147483648, -1, 0, 1, 1000000006, i * 29][i % 7]);
const definition = (op: string, modulus: bigint) => `use sequences\nMod = ${modulus}\nfun Acc combine Value = (Acc ${op} Value) mod Mod\n`;
const modulo = (n: bigint, m: bigint) => (n % m + m) % m;

for (const op of ['+', '*']) describe(`compact modular callback ${op} scan`, () => {
    it.each([1n, 17n, 1000000007n, 1073741824n])('matches every BigInt prefix for modulus %s', modulus => {
        for (const seed of [undefined, -33n, 2147483647n]) {
            const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics();
            try {
                runtime.variables.set('Input', typedArray(input.slice()));
                const result = diagnostics.run(() => runtime.execute(definition(op, modulus)
                    + `Answer = Input scan combine${seed === undefined ? '' : ` with (${seed})`}\nAnswer`));
                if (!result || !isRankArray(result)) throw Error('expected array');
                const expected: bigint[] = seed === undefined ? [BigInt(input[0])] : [seed];
                for (let at = seed === undefined ? 1 : 0; at < input.length; at++) {
                    const left = expected.at(-1)!, right = BigInt(input[at]);
                    expected.push(modulo(op === '+' ? left + right : left * right, modulus));
                }
                expect(Array.from({ length: expected.length }, (_, i) => readArrayItem(result, i))).toEqual(expected);
                expect(diagnostics.modularCallbackScans).toBe(1);
            } finally { runtime.dispose(); }
        }
    });

    it('borrows reversed offset views without changing the original storage', () => {
        const run = (compilation: boolean) => {
            const runtime = new Interpreter(undefined, { compilation });
            try {
                runtime.variables.set('Input', typedArray(input.slice()));
                runtime.execute(definition(op, 1000000007n)
                    + "Slice' = Input drop 3 take 2048\nAnswer = Slice reverse scan combine");
                return formatValue(runtime.execute('Answer')!);
            } finally { runtime.dispose(); }
        };
        expect(run(true)).toBe(run(false));
    });
});

it.each([0n, -17n, 1073741825n])('retains ordinary errors and fallback for modulus %s', modulus => {
    const run = (compilation: boolean) => {
        const runtime = new Interpreter(undefined, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.variables.set('Input', typedArray(input.slice()));
            let result: string;
            try { result = formatValue(diagnostics.run(() => runtime.execute(definition('*', modulus) + 'Input scan combine'))!); }
            catch (error) { result = String(error); }
            expect(diagnostics.modularCallbackScans).toBe(0);
            return result;
        } finally { runtime.dispose(); }
    };
    expect(run(true)).toBe(run(false));
});

it('retains scalar observers and disabled compilation', () => {
    let calls = 0;
    for (const options of [{ compilation: false }, { numberLoopCompilation: false },
        { scalarEntryCompilation: false }, { onScalarFunctionExecuted: () => calls++ }]) {
        const runtime = new Interpreter(undefined, options), diagnostics = new RuntimeDiagnostics();
        calls = 0;
        try {
            runtime.variables.set('Input', typedArray(input.slice()));
            diagnostics.run(() => runtime.execute(definition('*', 17n) + 'Answer = Input scan combine'));
            expect(diagnostics.modularCallbackScans).toBe(0);
            if ('onScalarFunctionExecuted' in options) expect(calls).toBe(input.length - 1);
        } finally { runtime.dispose(); }
    }
});

it('preserves opaque host read order', () => {
    const run = (compilation: boolean) => {
        const runtime = new Interpreter(undefined, { compilation }), reads: number[] = [];
        try {
            runtime.variables.set('Input', { kind: 'array', shape: [2053], itemAt: i => { reads.push(i); return BigInt(input[i]); }, get items(): never { throw Error('opaque'); } });
            runtime.execute(definition('*', 17n) + 'Answer = Input scan combine');
            return { answer: formatValue(runtime.execute('Answer')!), reads };
        } finally { runtime.dispose(); }
    };
    expect(run(true)).toEqual(run(false));
});

it('keeps interruption, demand budgets and retry atomic', () => {
    const runtime = new Interpreter();
    try {
        runtime.variables.set('Input', typedArray(input.slice()));
        runtime.execute(definition('*', 17n));
        const demand = () => runtime.execute('Answer = Input scan combine');
        expect(() => withInterrupt(new Int32Array([1]), demand)).toThrow('Interrupted');
        expect(() => withDemandBudget(0, demand)).toThrow('demand budget exhausted');
        expect(runtime.variables.has('Answer')).toBe(false);
        expect(() => demand()).not.toThrow();
        const original = runtime.variables.get('Input');
        if (!original || !isRankArray(original)) throw Error('expected original array');
        expect(readArrayItem(original, 0)).toBe(2147483647n);
    } finally { runtime.dispose(); }
});

it('preserves captured modulus and independent snapshots on repeated deferred demands', () => {
    const run = (compilation: boolean) => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.variables.set('Input', typedArray(input.slice()));
            runtime.execute(definition('*', 17n)
                + "Later' = Input scan combine with 40\nMod = 19\nBefore = Later copy\nAgain = Later copy\nBefore 0 = 99");
            return formatValue(runtime.execute('array (Before sum) (Again sum)')!);
        } finally { runtime.dispose(); }
    };
    expect(run(true)).toBe(run(false));
});
