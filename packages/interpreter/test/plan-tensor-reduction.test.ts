import { describe, expect, it } from 'vitest';
import { Interpreter, isRankPlan, isNativeFunction, withDemandBudget, DemandBudgetExhausted } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';
import type { RankArray } from '../src/value.js';
import { withInterrupt } from '../src/interrupt.js';

describe.each([false, true])('tensor reduction plan demand (compilation=%s)', compilation => {
    function runtime() {
        let entries = 0;
        const output: string[] = [];
        const sources: string[] = [];
        const host = new Interpreter(text => output.push(text), {
            compilation, onTensorKernelExecuted: () => entries++,
            onTensorKernelCompiled: source => sources.push(source),
        });
        return { host, output, sources, entries: () => entries };
    }

    it('fuses a scalar plan only at demand, recomputes, and retains ordinary results', () => {
        const { host, entries, sources } = runtime();
        try {
            host.execute("use sequences\nInput = array 1 2 3\nResult' = (Input * Input + 1) sum");
            expect(isRankPlan(host.variables.get('Result')!)).toBe(true);
            expect(entries()).toBe(0);
            expect(sources).toEqual([]);
            host.execute('Input = array 9 9 9');
            expect(host.execute('Result')).toBe(17n);
            expect(host.execute('Result')).toBe(17n);
            host.execute('Saved = Result');
            expect(host.execute('Saved')).toBe(17n);
            expect(host.execute('Saved')).toBe(17n);
            expect(entries()).toBe(compilation ? 3 : 0);
            expect(sources).toHaveLength(compilation ? 1 : 0);
            if (compilation) {
                expect(sources[0].match(/for \(/g)).toHaveLength(1);
                expect(sources[0]).not.toContain('new Array');
            }
        } finally { host.dispose(); }
    });

    it('preserves exact arithmetic and broadcast shape in a captured expression', () => {
        const { host, entries } = runtime();
        const large = 2n ** 90n + 1n;
        host.variables.set('Input', ownedArray([large, 2n, -large, 4n], [2, 2]));
        host.variables.set('Row', ownedArray([3n, 5n]));
        try {
            host.execute("use sequences\nResult' = (Input * Row + 1) sum");
            expect(host.execute('Result')).toBe(34n);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('fuses named ranked text conversion and power plans without completing arrays', () => {
        const { host, entries, sources } = runtime();
        try {
            host.execute(`fun Text powers Power
 Digits' = Text integer rank 0
 Powers' = Digits ** Power
 return Powers sum
end
First' = "1634" powers 4
Second' = "4150" powers 5`);
            expect(entries()).toBe(0);
            expect(host.execute('First')).toBe(1634n);
            expect(host.execute('Second')).toBe(4150n);
            expect(host.execute('First')).toBe(1634n);
            expect(entries()).toBe(compilation ? 3 : 0);
            if (compilation) {
                expect(sources.length).toBeGreaterThan(0);
                for (const source of sources) {
                    expect(source.match(/for \(/g)).toHaveLength(1);
                    expect(source).not.toContain('new Array');
                    expect(source).toContain('charCodeAt');
                }
            }
        } finally { host.dispose(); }
    });

    it('keeps binding checks on a named ranked conversion before its consumer', () => {
        const { host, entries } = runtime();
        try {
            host.execute(`Digits = 0
Digits' = "123" integer rank 0
Powers' = Digits ** 2
Total' = Powers sum`);
            expect(() => host.execute('Total')).toThrowError(/Digits.*integer.*array/);
            expect(() => host.execute('Total')).toThrowError(/Digits.*integer.*array/);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('rebinds text lengths and preserves exact powers across prepared calls', () => {
        const { host, entries } = runtime();
        try {
            host.execute(`fun Text powers Power
 Digits' = Text integer rank 0
 Powers' = Digits ** Power
 return Powers sum
end`);
            expect(host.execute('"12" powers 2')).toBe(5n);
            expect(host.execute('"999" powers 40')).toBe(3n * 9n ** 40n);
            expect(host.execute('"1" powers 3')).toBe(1n);
            expect(() => host.execute('"12" powers -2')).toThrowError('powers returns integer and cannot return real');
            expect(entries()).toBe(compilation ? 3 : 0);
        } finally { host.dispose(); }
    });

    it.each(['12x', '-12', '1 2'])('retains invalid character errors for %s', text => {
        const { host, entries } = runtime();
        try {
            host.execute(`Digits' = "${text}" integer rank 0\nTotal' = (Digits ** 2) sum`);
            expect(entries()).toBe(0);
            expect(() => host.execute('Total')).toThrowError('invalid integer text');
            expect(() => host.execute('Total')).toThrowError('invalid integer text');
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('rechecks the native converter after a successful named-plan reduction', () => {
        const { host, entries } = runtime();
        try {
            host.execute('Digits\' = "123" integer rank 0\nTotal\' = (Digits ** 2) sum');
            expect(host.execute('Total')).toBe(14n);
            const before = entries();
            const converter = host.execute('integer')!;
            if (!isNativeFunction(converter)) throw Error('expected converter');
            Object.defineProperty(converter, 'call', { value: () => 7n });
            expect(host.execute('Total')).toBe(147n);
            expect(entries()).toBe(before);
        } finally { host.dispose(); }
    });

    it.each([
        ['sum', 17n], ['mean', 17 / 3], ['min', 2n], ['max', 10n],
        ['greater 4 count', 2n], ['greater 4 any', true], ['greater 4 all', false],
    ] as const)('preserves the %s terminal', (terminal, expected) => {
        const { host, entries } = runtime();
        try {
            host.execute(`use sequences\nuse stats\nInput = array 1 2 3\nResult' = (Input * Input + 1) ${terminal}`);
            expect(host.execute('Result')).toBe(expected);
            expect(entries()).toBe(compilation ? 1 : 0);
        } finally { host.dispose(); }
    });

    it('keeps immediate helper effects and local completion before the deferred reduction', () => {
        const { host, output, entries } = runtime();
        try {
            host.execute(`use io
use sequences
fun X transform
 "entered" print
 Saved = X * 2
 return Saved
end
Input = array 1 2 3
Result' = (Input transform + 1) sum`);
            expect(output).toEqual(['entered']);
            expect(entries()).toBe(0);
            expect(host.execute('Result')).toBe(15n);
            expect(host.execute('Result')).toBe(15n);
            expect(output).toEqual(['entered']);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it('retains user reduction dispatch', () => {
        const { host, output, entries } = runtime();
        try {
            host.execute(`use io
use sequences
fun X replacement
 "custom" print
 return 77
end
Input = array 1 2 3`);
            host.variables.set('sum', host.variables.get('replacement')!);
            host.execute("Result' = (Input * 2) sum");
            expect(host.execute('Result')).toBe(77n);
            expect(output).toEqual(['custom']);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('rechecks the reducer implementation after a successful kernel run', () => {
        const { host, entries } = runtime();
        let calls = 0;
        try {
            host.execute("use sequences\nInput = array 1 2 3\nResult' = (Input * 2 + 1) sum");
            expect(host.execute('Result')).toBe(15n);
            const before = entries();
            const reducer = host.execute('sum')!;
            if (!isNativeFunction(reducer)) throw Error('expected reducer');
            Object.defineProperty(reducer, 'call', { value: () => { calls++; return 77n; } });
            expect(host.execute('Result')).toBe(77n);
            expect(calls).toBe(1);
            expect(entries()).toBe(before);
        } finally { host.dispose(); }
    });

    it('runs binding validation after each compiled result, including failed demands', () => {
        const { host, entries } = runtime();
        try {
            host.execute('use sequences\nInput = array 1 2 3\nResult = "text"');
            host.execute("Result' = (Input * 2) sum");
            expect(() => host.execute('Result')).toThrowError(/Result.*text.*integer/);
            expect(() => host.execute('Result')).toThrowError(/Result.*text.*integer/);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it('does not inline through a captured plan and skip its binding check', () => {
        const { host, entries } = runtime();
        try {
            host.execute('use sequences\nInput = array 1 2 3\nStage = 0');
            host.execute("Stage' = Input * 2\nResult' = (Stage + 1) sum");
            expect(() => host.execute('Result')).toThrowError(/Stage.*integer.*array/);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('declines unread host cells and repeats their observable traversal', () => {
        const { host, entries } = runtime();
        const reads: number[] = [];
        const input: RankArray = { kind: 'array', shape: [3], containsFiles: false,
            get items(): never { throw Error('must not force host storage'); },
            itemAt: index => { reads.push(index); return BigInt(index + 1); },
        };
        host.variables.set('Input', input);
        try {
            host.execute("use sequences\nResult' = (Input * 2 + 1) sum");
            expect(reads).toEqual([]);
            expect(host.execute('Result')).toBe(15n);
            expect(host.execute('Result')).toBe(15n);
            expect(reads).toEqual([0, 1, 2, 0, 1, 2]);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('keeps array plans lazy when only one cell is demanded', () => {
        const { host, entries } = runtime();
        const reads: number[] = [];
        host.variables.set('Input', { kind: 'array', shape: [2], containsFiles: false,
            get items(): never { throw Error('must not force array'); },
            itemAt: index => { reads.push(index); if (index) throw Error('unselected cell'); return 1n; },
        });
        try {
            host.execute("use sequences\nResult' = Input * 2 + 1");
            expect(host.execute('Result 0')).toBe(3n);
            expect(reads).toEqual([0]);
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('keeps error timing and retries after a failed scalar demand', () => {
        const { host, output, entries } = runtime();
        try {
            host.execute("use io\nuse sequences\nInput = array 1 0 3\nResult' = (12 // Input) sum\n\"bound\" print");
            expect(output).toEqual(['bound']);
            expect(() => host.execute('Result')).toThrowError('division by zero');
            expect(() => host.execute('Result')).toThrowError('division by zero');
            expect(entries()).toBe(0);
        } finally { host.dispose(); }
    });

    it('uses call-time demand budgets after a cached unbounded kernel run', () => {
        const { host, entries } = runtime();
        host.variables.set('Input', ownedArray(Array.from({ length: 16384 }, () => 1n)));
        try {
            host.execute("use sequences\nResult' = (Input * 2 + 1) sum");
            expect(host.execute('Result')).toBe(49152n);
            expect(() => withDemandBudget(8, () => host.execute('Result'))).toThrow(DemandBudgetExhausted);
            expect(host.execute('Result')).toBe(49152n);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });

    it('disables a previously prepared kernel during inspection', () => {
        const { host, entries } = runtime();
        try {
            host.execute("use sequences\nInput = array 1 2 3\nResult' = (Input * 2 + 1) sum");
            expect(host.execute('Result')).toBe(15n);
            const before = entries();
            const signal = new Int32Array(new SharedArrayBuffer(8 * 4));
            expect(withInterrupt(signal, () => host.execute('Result'), () => {})).toBe(15n);
            expect(entries()).toBe(before);
            expect(host.execute('Result')).toBe(15n);
            expect(entries()).toBe(compilation ? 2 : 0);
        } finally { host.dispose(); }
    });
});
