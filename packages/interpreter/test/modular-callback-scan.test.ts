import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, type InterpreterOptions } from '../src/index.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';
import { isRankSequence } from '../src/value.js';

function observe(source: string, options: InterpreterOptions = {}) {
    const host = new Interpreter(() => {}, options), diagnostics = new RuntimeDiagnostics();
    try {
        let value: string | undefined, error: string | undefined;
        try {
            const result = diagnostics.run(() => host.execute('use sequences\n' + source));
            value = result === undefined ? undefined : formatValue(result);
        } catch (cause) { error = cause instanceof RankError ? cause.format() : String(cause); }
        return { observation: { value, error }, diagnostics };
    } finally { host.dispose(); }
}
const definition = 'Mod = 1000000007\nfun Acc combine Value = Acc * Value mod Mod\n';

describe('compiled modular callback scan completion', () => {
    it.each([
        '(-20 to 1000) scan combine', '(1000 to -20 by -1) scan combine',
        '(1 to 1000) scan combine with 1', '(-20 to 1000) scan combine with (-33)',
        '(2147483640 to 2147483647) scan combine',
        '(-2147483648 to -2147483630) scan combine',
        '(1 to 1) scan combine', '(1 to 1) scan combine with 9',
        '(1 till 1) scan combine', '(1 till 1) scan combine with 9',
        '(1 to 20) scan combine with 9007199254740993',
        '(9007199254740993 to 9007199254741000) scan combine',
    ])('matches ordinary prefix values: %s', expression => {
        const source = definition + `Answer = ${expression}\nAnswer`;
        const actual = observe(source);
        expect(actual.observation.error).toBeUndefined();
        expect(actual.observation).toEqual(observe(source, { compilation: false }).observation);
    });

    it.each(['+', '*'])('compiles %s with either parameter order and captured or literal moduli', operator => {
        for (const modulus of ['1', '17', '1073741824']) for (const reverse of [false, true]) {
            const body = reverse ? `Value ${operator} Acc` : `Acc ${operator} Value`;
            const source = `fun Acc combine Value = (${body}) mod ${modulus}\nAnswer = (-100 to 1000) scan combine with 13\nAnswer`;
            const actual = observe(source);
            expect(actual.observation).toEqual(observe(source, { compilation: false }).observation);
            expect(actual.diagnostics.modularCallbackScans).toBe(1);
        }
    });

    it.each(['0', '-17', '1073741825', '17.0'])('falls back for modulus %s with the same first error', modulus => {
        const source = definition.replace('1000000007', modulus) + 'Answer = (1 to 20) scan combine\nAnswer';
        const actual = observe(source);
        expect(actual.observation).toEqual(observe(source, { compilation: false }).observation);
        expect(actual.diagnostics.modularCallbackScans).toBe(0);
    });

    it.each([
        'fun Acc combine Value = Acc * Acc mod Mod',
        'fun Acc combine Value = Acc - Value mod Mod',
        'memo Acc combine Value = Acc * Value mod 17',
        'fun Acc combine Value\n Product = Acc * Value\n return Product mod Mod\nend',
    ])('keeps unsupported callback semantics: %s', declaration => {
        const source = 'Mod = 17\n' + declaration + '\nAnswer = (1 to 20) scan combine\nAnswer';
        const actual = observe(source);
        expect(actual.observation).toEqual(observe(source, { compilation: false }).observation);
        expect(actual.observation.error).toBeUndefined();
        expect(actual.diagnostics.modularCallbackScans).toBe(0);
    });

    it('does not evaluate an unused or partial scan, including a zero modulus', () => {
        const actual = observe(definition.replace('1000000007', '0') + "Later' = (1 to 100) scan combine\nLater 0");
        expect(actual.observation).toEqual({ value: '1', error: undefined });
        expect(actual.diagnostics.modularCallbackScans).toBe(0);
    });

    it('retains the unreduced initial state and snapshots across repeated demand', () => {
        const source = definition.replace('1000000007', '17') + `Later' = (20 to 30) scan combine with 40
Mod = 19
Before = Later copy
Again = Later copy
Before 0 = 99
array (Before sum) (Again sum)`;
        expect(observe(source).observation).toEqual(observe(source, { compilation: false }).observation);
        expect(observe(source).diagnostics.modularCallbackScans).toBe(2);
    });

    it.each([{ compilation: false }, { numberLoopCompilation: false }, { scalarEntryCompilation: false }])(
        'honors disabled compilation capabilities: %s', options => {
            const actual = observe(definition + 'Answer = (1 to 20) scan combine\nAnswer', options);
            expect(actual.observation.error).toBeUndefined();
            expect(actual.diagnostics.modularCallbackScans).toBe(0);
        });

    it('retains scalar execution observers', () => {
        let calls = 0;
        const result = observe(definition + 'Answer = (1 to 20) scan combine\nAnswer', { onScalarFunctionExecuted: () => calls++ });
        expect(result.observation.error).toBeUndefined();
        expect(calls).toBe(19);
        expect(result.diagnostics.modularCallbackScans).toBe(0);
    });

    it('checks iterator replacement before native completion', () => {
        const host = new Interpreter();
        try {
            host.execute('use sequences\n' + definition + "Later' = (1 to 20) scan combine");
            const later = host.execute('Later');
            if (!isRankSequence(later!)) throw Error('expected sequence');
            later.plan.iterate = function* () { yield 77n; };
            host.variables.set('Changed', later);
            expect(formatValue(host.execute('Changed copy')!)).toBe('77');
        } finally { host.dispose(); }
    });

    it('keeps budget exhaustion atomic and can retry the same plan', () => {
        const host = new Interpreter();
        try {
            host.execute('use sequences\n' + definition + "Later' = (1 to 10000) scan combine\nBefore = 7");
            expect(() => withDemandBudget(100, () => host.execute('Answer = Later copy'))).toThrow(DemandBudgetExhausted);
            expect(host.variables.has('Answer')).toBe(false);
            expect(host.variables.get('Before')).toBe(7n);
            expect(() => host.execute('Answer = Later copy')).not.toThrow();
        } finally { host.dispose(); }
    });
});
