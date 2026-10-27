import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankArray, type NativeFunction } from '../src/index.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { RankError } from '../src/errors.js';
import { withInterrupt, InterruptedError } from '../src/interrupt.js';

function execute(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, sourceId: 'numeric.ra' });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        diagnostics.run(() => runtime.execute(source));
    } catch (caught) {
        error = caught instanceof RankError ? caught.format() : String(caught);
    }
    const variables = Object.fromEntries(['Saved', 'Again', 'Target', 'Before', 'After'].flatMap(name =>
        runtime.variables.has(name) ? [[name, formatValue(runtime.variables.get(name)!)]] : []));
    runtime.dispose();
    return { variables, error, diagnostics };
}
function compare(source: string, compiled = true) {
    const reference = execute(source, false), actual = execute(source, compiled);
    expect(actual.variables).toEqual(reference.variables);
    expect(actual.error).toEqual(reference.error);
    return actual;
}

describe('checked numeric tensor calls', () => {
    it.each(['log', 'sin', 'cos', 'tan', 'exp', 'floor', 'ceil'])('fuses %s after broadcast and reshape', operation => {
        const result = compare(`use sequences
use numbers
A = (array 1.0 2.0) reshape 2 1
B = (array 2.0 4.0 8.0) reshape 1 3
Later' = ((A * B / (A + B)) ${operation}) reshape 6
Saved = Later`);
        expect(result.error).toBeUndefined();
        expect(result.diagnostics.tensorMapPreparations).toBeGreaterThan(0);
    });

    it('composes checked real and integer calls at a slice-write consumer', () => {
        const result = compare(`use sequences
use numbers
A = array 1.0 2.0 4.0
Later' = (((A + 1.0) log) * 1000.0) floor
Target = array shape 5 fill 0
Target (1 to 3) = Later
Saved = Target`);
        expect(result.error).toBeUndefined();
        expect(result.variables.Saved).toBe('0 693 1098 1609 0');
        expect(result.diagnostics.tensorMapPreparations).toBeGreaterThan(0);
    });

    it('does not demand an unused invalid plan', () => {
        const result = compare(`use numbers
A = array -1.0 0.0
Unused' = ((A + 0.0) log) floor
Saved = 7`);
        expect(result.error).toBeUndefined();
        expect(result.diagnostics.tensorMapPreparations).toBe(0);
    });

    it('preserves plan captures, separate consumers and ordinary completion', () => {
        const result = compare(`use sequences
use numbers
A = array 1.0 2.0
Later' = ((A + 1.0) log) floor
A = array 99.0
Saved = Later
Saved 0 = 99
Again = Later`);
        expect(result.error).toBeUndefined();
        expect(result.variables).toMatchObject({ Saved: '99 1', Again: '0 1' });
    });

    it.each([
        '((A - 2.0) log) floor',
        '(A / 0.0) log',
        '((A * 1000.0) exp) floor',
        '((A + 1.0) log) reshape 3',
    ])('preserves error location and pre-write state: %s', expression => {
        const result = compare(`use sequences
use numbers
A = array 1.0 2.0
Later' = ${expression}
Target = array 7 8
Before = 3
Target (0 to 1) = Later
After = 9`);
        expect(result.error).toBeDefined();
        expect(result.variables).toMatchObject({ Target: '7 8', Before: '3' });
        expect(result.variables).not.toHaveProperty('After');
    });

    it.each(['log', 'floor'])('uses a replaced %s implementation normally', name => {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute('use numbers\nA = array 1.0 2.0');
                const fn = runtime.execute(name) as NativeFunction;
                const original = fn.call;
                let calls = 0;
                Reflect.set(fn, 'call', () => { calls++; return 42n; });
                try {
                    runtime.execute(`Saved = (A + 1.0) ${name}`);
                    expect(formatValue(runtime.variables.get('Saved')!)).toBe('42 42');
                    expect(calls).toBe(2);
                } finally { Reflect.set(fn, 'call', original); }
            } finally { runtime.dispose(); }
        }
    });

    it('keeps host readers out of speculative preparation', () => {
        for (const compilation of [false, true]) {
            const reads: number[] = [];
            const runtime = new Interpreter(() => {}, { compilation });
            const host: RankArray = { kind: 'array', shape: [2], items: [],
                itemAt: index => { reads.push(index); return index + 1; } };
            try {
                runtime.variables.set('Host', host);
                runtime.execute("use numbers\nLater' = ((Host + 1.0) log) floor");
                expect(reads).toEqual([]);
                runtime.execute('Saved = Later');
                expect(reads).toEqual([0, 1]);
                expect(formatValue(runtime.variables.get('Saved')!)).toBe('0 1');
            } finally { runtime.dispose(); }
        }
    });

    it.each(['any', 'all'])('retains short circuit before a later domain error (%s)', terminal => {
        const comparison = terminal === 'any' ? 'greater' : 'less';
        const result = compare(`use sequences
use numbers
A = array 10.0 -1.0
Later' = ((A + 0.0) log) ${comparison} 0.0
Saved = Later ${terminal}`);
        expect(result.error).toBeUndefined();
        expect(result.variables.Saved).toBe(terminal === 'any' ? 'true' : 'false');
    });

    it('retains empty shape without evaluating numeric calls', () => {
        const result = compare(`use sequences
use numbers
A = array shape 0 3 fill -1.0
Saved = (((A + 0.0) log) floor) reshape 0 3`);
        expect(result.error).toBeUndefined();
    });

    it('keeps exact wide integer results from floor', () => {
        const result = compare(`use numbers
A = array 1.0e30 -1.0e30
Saved = (A + 1.0) floor`);
        expect(result.error).toBeUndefined();
        expect(result.variables.Saved).toContain('1000000000000000019884624838656');
    });

    it('retains helper call traces when a numeric stage fails', () => {
        const result = compare(`use numbers
fun A score
  Later' = ((A - 2.0) log) floor
  return Later sum
end
Before = 3
Saved = (array 1.0 2.0) score`);
        expect(result.error).toContain('DomainError');
    });

    it('propagates cancellation without replay', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute("use sequences\nuse numbers\nA = (1 to 3000 array) / 1000.0\nLater' = (A log) floor");
            const cells = new Int32Array(new SharedArrayBuffer(4));
            cells[0] = 1;
            expect(() => withInterrupt(cells, () => runtime.execute('Saved = Later'))).toThrow(InterruptedError);
            expect(runtime.variables.has('Saved')).toBe(false);
        } finally { runtime.dispose(); }
    });
});
