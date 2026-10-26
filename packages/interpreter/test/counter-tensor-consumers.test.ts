import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, RankError } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';
import { addToCollection, counterFrequency, counterHas, newStructure, removeFromCollection } from '../src/collections.js';
import { clonePreviewValue } from '../src/preview-values.js';
import { ResourceMap } from '../src/resource-summary.js';
import { withDemandBudget, DemandBudgetExhausted, withInterrupt } from '../src/interrupt.js';
import type { NativeFunction, RankCounter, RankValue } from '../src/value.js';

function execute(source: string, compilation: boolean) {
    const r = new Interpreter(undefined, { compilation });
    const d = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        try { d.run(() => r.execute('use algo\nuse sequences\n' + source)); }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { d, error, state: [...r.variables].map(([key, value]) => [key, formatValue(value)]) };
    } finally { r.dispose(); }
}

it('uses exact numeric keys while preserving equality, membership, removal and preview copies', () => {
    const c = newStructure('counter') as RankCounter;
    const keys = [0n, -1n, 2147483648n, 9007199254740992n, 9007199254740993n, -9007199254740993n];
    for (const key of keys) { addToCollection(c, key); addToCollection(c, key); }
    expect([...c.entries.keys()]).toEqual([0, -1, 2147483648, 9007199254740992n, 9007199254740993n, -9007199254740993n]);
    for (const key of keys) {
        expect(counterFrequency(c, key)).toBe(2n);
        expect(counterHas(c, key)).toBe(true);
        expect(counterFrequency(clonePreviewValue(c) as RankCounter, key)).toBe(2n);
        removeFromCollection(c, key); removeFromCollection(c, key);
        expect(counterHas(c, key)).toBe(false);
    }
    addToCollection(c, 2n);
    expect(counterFrequency(c, 2)).toBe(1n);
    expect(() => addToCollection(c, 2)).toThrow(/cannot receive/);
    const foreign: RankCounter = { kind: 'counter', entries: new Map([['number:2', { value: 2n, count: 7n }]]) };
    expect(counterFrequency(foreign, 2n)).toBe(7n);
});

describe.each([false, true])('counter tensor consumers (compilation=%s)', compilation => {
    it.each([
        ["Input = array 1 1 2\nKeys' = Input + 10", 5n],
        ["Input = array 1 2\nKeys' = ((Input reshape 2 1) + Input) reshape 4", 6n],
        ["Input = array 1 2\nA' = Input + 1\nKeys' = concat A Input", 6n],
        ["Input = array 9007199254740992 9007199254740993\nKeys' = Input * Input", 2n],
    ])('compiles constructor and sum over native key graphs: %s', (setup, expected) => {
        const result = execute(`${setup}\nCounts = new counter Keys\nAnswer = Counts Keys sum`, compilation);
        expect(result.error).toBeUndefined();
        expect(result.state).toContainEqual(['Answer', String(expected)]);
        expect(result.d.compiledCounterBuilds).toBe(compilation ? 1 : 0);
        expect(result.d.compiledCounterSums).toBe(compilation ? 1 : 0);
    });

    it('preserves completion, fresh observations and aliases', () => {
        const result = execute(`Input = array 1 1 2
Keys' = Input + 0
Counts = new counter Keys
Saved = Counts Keys
Alias = Counts
Alias add 1
First = Counts Keys sum
Alias remove 1
Second = Counts Keys sum
SavedTotal = Saved sum`, compilation);
        expect(result.error).toBeUndefined();
        expect(result.state).toEqual(expect.arrayContaining([['First', '7'], ['Second', '5'], ['SavedTotal', '5']]));
    });

    it.each([
        "Input = array 1 0 2\nBad' = 12 // Input\nUnused' = new counter Bad\nAnswer = 7",
        "Input = array 1 0 2\nBad' = 12 // Input\nBefore = 9\nCounts = new counter Bad",
        "Input = array 1 0 2\nCounts = new counter (array 12 6)\nBad' = 12 // Input\nBefore = 9\nAnswer = Counts Bad sum",
        "Input = array 1 2\nKeys' = Input + 0\nCounts = new counter Keys\nAnswer = Counts (Keys reshape 1 2) sum",
        "Input = array shape 0 fill 1\nKeys' = Input + 0\nCounts = new counter Keys\nAnswer = Counts Keys sum",
    ])('matches reference state and first errors: %s', source => {
        const result = execute(source, compilation), reference = execute(source, false);
        expect({ error: result.error, state: result.state }).toEqual({ error: reference.error, state: reference.state });
    });

    it('keeps a replaced sum implementation', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute("use algo\nuse sequences\nInput = array 1 2\nKeys' = Input + 0\nCounts = new counter Keys");
            const sum = r.execute('sum') as NativeFunction;
            const original = sum.call;
            try {
                Object.defineProperty(sum, 'call', { value: (args: RankValue[]) => { expect(formatValue(args[0])).toBe('1 1'); return 99n; }, configurable: true });
                expect(r.execute('Counts Keys sum')).toBe(99n);
            } finally { Object.defineProperty(sum, 'call', { value: original, configurable: true }); }
        } finally { r.dispose(); }
    });

    it('resolves the reducer after effectful key traversal', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute('use algo\nuse sequences\nfun X replacement\n return 99\nend\nCounts = new counter (array 1 1)');
            const replacement = r.variables.get('replacement')!;
            r.variables.set('Keys', { kind: 'array', shape: [2], items: [], itemAt() {
                r.variables.set('sum', replacement); return 1n;
            } });
            expect(r.execute('Counts Keys sum')).toBe(99n);
        } finally { r.dispose(); }
    });

    it('sums frequencies beyond the Number and int64 ranges exactly', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute("use algo\nuse sequences\nInput = array 1 1\nKeys' = Input + 0\nCounts = new counter Keys");
            const counter = r.variables.get('Counts') as RankCounter;
            counter.entries.get(1)!.count = 18446744073709551617n;
            expect(r.execute('Counts Keys sum')).toBe(36893488147419103234n);
        } finally { r.dispose(); }
    });

    it('avoids scanning a larger counter for a small query', () => {
        const result = execute("Input = array 1\nKeys' = Input + 0\nCounts = new counter (1 to 100)\nAnswer = Counts Keys sum", compilation);
        expect(result.error).toBeUndefined();
        expect(result.state).toContainEqual(['Answer', '1']);
        expect(result.d.compiledCounterSums).toBe(0);
    });

    it('retains call-time budgets and inspection after compiled demands', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute("use algo\nuse sequences\nInput = array shape 16384 fill 1\nKeys' = Input + 0");
            expect(() => withDemandBudget(8, () => r.execute('Counts = new counter Keys'))).toThrow(DemandBudgetExhausted);
            expect(r.variables.has('Counts')).toBe(false);
            r.execute('Counts = new counter Keys');
            expect(() => withDemandBudget(8, () => r.execute('Answer = Counts Keys sum'))).toThrow(DemandBudgetExhausted);
            expect(r.variables.has('Answer')).toBe(false);
            expect(r.execute('Counts Keys sum')).toBe(268435456n);
            const d = new RuntimeDiagnostics(), signal = new Int32Array(new SharedArrayBuffer(32));
            expect(d.run(() => withInterrupt(signal, () => r.execute('Counts Keys sum'), () => {}))).toBe(268435456n);
            expect(d.compiledCounterSums).toBe(0);
        } finally { r.dispose(); }
    });

    it.each(['lookup', 'count', 'proxy'])('retains interleaved host effects from a replaced %s', replacement => {
        const r = new Interpreter(undefined, { compilation });
        const input = ownedArray([1n, 2n]);
        const c = newStructure('counter') as RankCounter;
        addToCollection(c, 1n); addToCollection(c, 2n);
        let calls = 0;
        const mutate = () => { calls++; input.items[1] = 1n; };
        if (replacement === 'lookup') {
            const get = c.entries.get.bind(c.entries);
            c.entries.get = key => { mutate(); return get(key); };
        } else {
            const entry = c.entries.get(1)!;
            if (replacement === 'count') Object.defineProperty(entry, 'count', { get() { mutate(); return 2n; } });
            else c.entries.set(1, new Proxy(entry, {
                get(target, key) { if (key === 'count') { mutate(); return 2n; } return Reflect.get(target, key); },
                getOwnPropertyDescriptor() { throw Error('speculative host reflection'); },
            }));
        }
        try {
            r.variables.set('Input', input); r.variables.set('Counts', c);
            r.execute("use sequences\nKeys' = Input + 0");
            const d = new RuntimeDiagnostics();
            expect(d.run(() => r.execute('Counts Keys sum'))).toBe(replacement === 'lookup' ? 2n : 4n);
            expect(calls).toBe(2);
            expect(d.compiledCounterSums).toBe(0);
        } finally { r.dispose(); }
    });
});

it('declines a constructor with an overridden storage method before borrowing its inputs', () => {
    const r = new Interpreter();
    let writes = 0;
    const original = ResourceMap.prototype.set;
    try {
        r.execute("use algo\nuse sequences\nInput = array 1 2\nKeys' = Input + 0");
        const spy = vi.spyOn(ResourceMap.prototype, 'set').mockImplementation(function (this: ResourceMap<RankValue>, key, value) {
            writes++; return original.call(this, key, value);
        });
        try {
            const d = new RuntimeDiagnostics();
            d.run(() => r.execute('Counts = new counter Keys'));
            expect(writes).toBeGreaterThan(0);
            expect(d.compiledCounterBuilds).toBe(0);
        } finally { spy.mockRestore(); }
    } finally { r.dispose(); }
});
