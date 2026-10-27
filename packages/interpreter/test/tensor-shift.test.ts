import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, type RankArray, type NativeFunction } from '../src/index.js';
import { RankError } from '../src/errors.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

function run(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, sourceId: 'shift.ra' });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try { diagnostics.run(() => runtime.execute(source)); }
    catch (caught) { error = caught instanceof RankError ? caught.format() : String(caught); }
    const values = Object.fromEntries(['Saved', 'Again', 'Target', 'Before', 'After'].flatMap(name =>
        runtime.variables.has(name) ? [[name, formatValue(runtime.variables.get(name)!)]] : []));
    runtime.dispose();
    return { values, error, diagnostics };
}
function compare(source: string) {
    const reference = run(source, false), actual = run(source, true);
    expect(actual.values).toEqual(reference.values);
    expect(actual.error).toEqual(reference.error);
    return actual;
}

describe('numeric tensor shifts', () => {
    it('fuses the original adjacent comparison and count', () => {
        const result = compare(`use sequences
A = array shape 10001 fill 2
A 0 = 0
A 1 = 1
Saved = (A equal (A shift -1)) count`);
        expect(result.error).toBeUndefined();
        expect(result.values.Saved).toBe('9998');
        expect(result.diagnostics.compiledTensors).toBeGreaterThan(0);
        expect(result.diagnostics.cellsComputed).toBe(0);
    });

    it.each([0, 1, 2])('matches scalar addressing on axis %s', axis => {
        for (const amount of [-9007199254740991, -10, -1, 0, 1, 10, 9007199254740991]) {
            const result = compare(`use sequences
A = (1 to 24 array) reshape 2 3 4
Later' = A shift ${amount} with -1 axis ${axis}
Saved = Later`);
            expect(result.error).toBeUndefined();
            expect(result.diagnostics.tensorMapPreparations).toBeGreaterThan(0);
        }
    });

    it.each(['1.0 2.0 3.0', '1000000000000000000000000000000 2 3'])('retains real and wide integer values: %s', values => {
        const result = compare(`use sequences
A = array ${values}
Later' = A shift -1 with ${values.includes('.') ? '0.0' : '0'}
Saved = Later
Again = Later sum`);
        expect(result.error).toBeUndefined();
        expect(result.diagnostics.tensorMapPreparations).toBeGreaterThan(0);
    });

    it('preserves the mixed real/integer error from the default fill', () => {
        const result = compare(`use sequences
A = array 1.0 2.0
Later' = A shift -1
Saved = Later`);
        expect(result.error).toContain('arrays require one element type');
    });

    it('leaves unused invalid plans unevaluated', () => {
        const result = compare(`use sequences
A = array 1 2
Unused' = A shift 9007199254740992
Saved = 7`);
        expect(result.error).toBeUndefined();
        expect(result.values.Saved).toBe('7');
    });

    it('composes arithmetic, shift and reduction without intermediate cells', () => {
        const result = compare(`use sequences
A = array 1 2 3
Later' = ((A + 1) shift -1) * 2
Saved = Later sum`);
        expect(result.error).toBeUndefined();
        expect(result.values.Saved).toBe('14');
        expect(result.diagnostics.cellsComputed).toBe(0);
    });

    it.each(['0 3', '2 0 4'])('preserves an empty shape %s', shape => {
        const result = compare(`use sequences
A = array shape ${shape} fill 1
Later' = A shift -1
Saved = Later
Again = Later sum`);
        expect(result.error).toBeUndefined();
        expect(result.values.Again).toBe('0');
    });

    it('keeps ordinary binding completion before a shift', () => {
        const result = compare(`use sequences
use numbers
A = array 1.0 -1.0
Completed = A log
Saved = (Completed shift 100 with 0.0) sum`);
        expect(result.error).toContain('DomainError');
    });

    it('does not demand source errors in an entirely filled shift', () => {
        const result = compare(`use sequences
use numbers
A = array -1.0 -2.0
Later' = (A log) shift 9007199254740991 with 7.0
Saved = Later sum`);
        expect(result.error).toBeUndefined();
        expect(result.values.Saved).toBe('14');
        expect(result.diagnostics.cellsComputed).toBe(0);
    });

    it.each(['any', 'all'])('keeps short circuit before an unvisited error (%s)', terminal => {
        const result = compare(`use sequences
use numbers
A = array -1.0 -2.0
Later' = ((A log) shift 1 with 1.0) greater ${terminal === 'any' ? '0.0' : '2.0'}
Saved = Later ${terminal}`);
        expect(result.error).toBeUndefined();
        expect(result.values.Saved).toBe(terminal === 'any' ? 'true' : 'false');
    });

    it('preserves lazy captures and separate ordinary completions', () => {
        const result = compare(`use sequences
A = array 1 2 3
Amount = -1
Later' = A shift Amount
A = array 8 9
Amount = 1
Saved = Later
Saved 0 = 99
Again = Later`);
        expect(result.error).toBeUndefined();
        expect(result.values).toEqual({ Saved: '99 3 0', Again: '2 3 0' });
    });

    it('keeps a failed slice write atomic and preserves its error location', () => {
        const result = compare(`use sequences
use numbers
A = array 1.0 -1.0
Later' = (A log) shift -1 with 0.0
Target = array 7.0 8.0
Before = 3
Target (0 to 1) = Later
After = 9`);
        expect(result.error).toContain('DomainError');
        expect(result.values).toEqual({ Target: '7 8', Before: '3' });
    });

    it.each(['A shift 1.0', 'A shift 9007199254740992', 'A shift 1 axis 2'])('preserves invalid shift errors: %s', expression => {
        const result = compare(`use sequences
A = array 1 2
Before = 3
Saved = (${expression}) sum
After = 9`);
        expect(result.error).toBeDefined();
        expect(result.values).toEqual({ Before: '3' });
    });

    it('keeps foreign readers out of speculative preparation', () => {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            const reads: number[] = [];
            const host: RankArray = { kind: 'array', shape: [3], items: [],
                itemAt: index => { reads.push(index); return BigInt(index + 1); } };
            try {
                runtime.variables.set('Host', host);
                runtime.execute("use sequences\nLater' = Host shift -1");
                expect(reads).toEqual([]);
                runtime.execute('Saved = Later sum');
                expect(reads).toEqual([1, 2]);
                expect(runtime.variables.get('Saved')).toBe(5n);
            } finally { runtime.dispose(); }
        }
    });

    it('honors replaced shift implementations', () => {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute('use sequences\nA = array 1 2 3');
                const fn = runtime.execute('shift') as NativeFunction, original = fn.call;
                let calls = 0;
                Reflect.set(fn, 'call', () => { calls++; return runtime.variables.get('A')!; });
                try {
                    runtime.execute('Saved = (A equal (A shift -1)) count');
                    expect(runtime.variables.get('Saved')).toBe(3n);
                    expect(calls).toBe(1);
                } finally { Reflect.set(fn, 'call', original); }
            } finally { runtime.dispose(); }
        }
    });

    it.each([
        'Saved = (A equal (A shift -1)) count',
        "Later' = A shift -1\nSaved = Later sum",
    ])('retains ordinary traversal with observable host polling: %s', source => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        let polls = 0;
        const signal = { length: 1, load: () => { polls++; return 0; },
            store: () => {}, exchange: () => { polls++; return 0; }, wait: () => {} };
        try {
            runtime.execute('use sequences\nA = array shape 10000 fill 1');
            diagnostics.run(() => withInterrupt(signal, () => runtime.execute(source)));
            expect(runtime.variables.get('Saved')).toBe(9999n);
            expect(polls).toBeGreaterThan(0);
            expect(diagnostics.compiledTensors).toBe(0);
            expect(diagnostics.fallbacks['tensor:observable-shift']).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it('propagates cancellation before publishing a result', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute("use sequences\nA = array shape 10000 fill 1\nLater' = A shift -1");
            const flag = new Int32Array(new SharedArrayBuffer(4));
            flag[0] = 1;
            expect(() => withInterrupt(flag, () => runtime.execute('Saved = Later sum'))).toThrow(InterruptedError);
            expect(runtime.variables.has('Saved')).toBe(false);
        } finally { runtime.dispose(); }
    });
});
