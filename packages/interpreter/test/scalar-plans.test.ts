import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction } from '../src/index.js';
import { sequence } from '../src/sequence.js';
import { MemoryIo } from './support.js';
import { isRankPlan } from '../src/plan.js';

function counted() {
    let reads = 0;
    const value = sequence({ name: 'scalar plan source', size: { kind: 'exact', value: 4n },
        *iterate() { for (let value = 1n; value <= 4n; value++) { reads++; yield value; } },
    });
    return { value, reads: () => reads };
}

describe.each([false, true])('scalar expression plans (compilation=%s)', compilation => {
    it('keeps data-dependent symbolic dimensions fresh between captures', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`fun Input' cardinality
 Size' = Input len
 return Size
end`);
            const fn = runtime.variables.get('cardinality')!;
            if (!isNativeFunction(fn)) throw Error('expected function');
            const input = { kind: 'array' as const, shape: [3], containsFiles: false as const,
                get items(): never { throw Error('must not read cells during capture'); },
                itemAt: (index: number) => BigInt(index),
            };
            const first = fn.call([input]), second = fn.call([input]);
            if (!isRankPlan(first) || !isRankPlan(second)) throw Error('expected plans');
            expect(first.result?.dim).toBeDefined();
            expect(second.result?.dim).not.toEqual(first.result?.dim);
        } finally { runtime.dispose(); }
    });

    it('rechecks captured result evidence when a prepared function changes input shape or type', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("fun Input twice\n Result' = Input * 2\n return Result\nend");
            for (const [expression, expected] of [
                ['(array 1 2) twice', '2 4'], ['3 twice', '6'],
                ['(array 1 2 3) twice', '2 4 6'], ['1.5 twice', '3'],
            ]) expect(formatValue(runtime.execute(expression)!)).toBe(expected);
        } finally { runtime.dispose(); }
    });

    it('defers a reduction, recomputes consumers and retains an eager result', () => {
        const source = counted();
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute("use io\nuse numbers\nSource' = Input\nSelected' = Source filter even\nTotal' = Selected sum");
            expect(source.reads()).toBe(0);
            expect(isRankPlan(runtime.variables.get('Total')!)).toBe(true);
            runtime.execute('Total print');
            expect(output).toEqual(['6']);
            expect(source.reads()).toBe(4);
            runtime.execute('Total print');
            expect(output).toEqual(['6', '6']);
            expect(source.reads()).toBe(8);
            expect(runtime.execute('Saved = Total')).toBe(6n);
            expect(source.reads()).toBe(12);
            expect(runtime.execute('Saved + Saved')).toBe(12n);
            expect(source.reads()).toBe(12);
        } finally { runtime.dispose(); }
    });

    it('captures the original source value across rebinding', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("A = 3\nB' = A * 2\nA = 10");
            expect(runtime.execute('B')).toBe(6n);
            expect(runtime.execute('B')).toBe(6n);
        } finally { runtime.dispose(); }
    });

    it('delays scalar errors until demand and does not cache failures', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("Bad' = 1 // 0");
            expect(isRankPlan(runtime.variables.get('Bad')!)).toBe(true);
            expect(() => runtime.execute('Saved = Bad')).toThrowError();
            expect(() => runtime.execute('Saved = Bad')).toThrowError();
            expect(runtime.variables.has('Saved')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('allows a name to move between planned and retained scalar results', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("A' = 1 + 2");
            expect(runtime.execute('A')).toBe(3n);
            expect(runtime.execute('A = 4')).toBe(4n);
            runtime.execute("A' = 2 * 3");
            expect(runtime.execute('A')).toBe(6n);
            expect(() => runtime.execute("A' = true\nA")).toThrowError('cannot receive boolean');
        } finally { runtime.dispose(); }
    });

    it('retains ranked row reductions explicitly', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("Matrix = array shape 2 2\n 1 2\n 3 4\nend\nRows' = Matrix sum rank 1");
            const rows = runtime.variables.get('Rows')!;
            expect(isRankPlan(rows) && rows.result).toMatchObject({ types: ['array'], rank: 1, shape: [2] });
            expect(formatValue(runtime.execute('Saved = Rows')!)).toBe('3 7');
        } finally { runtime.dispose(); }
    });

    it.each([{ marker: '', reads: 4 }, { marker: "'", reads: 8 }])(
        'passes scalar plans according to the parameter marker: $marker', ({ marker, reads }) => {
            const source = counted();
            const runtime = new Interpreter(undefined, { compilation });
            runtime.variables.set('Input', source.value);
            try {
                expect(runtime.execute(`Total' = Input sum\nfun X${marker} twice = X + X\nTotal twice`)).toBe(20n);
                expect(source.reads()).toBe(reads);
            } finally { runtime.dispose(); }
        },
    );

    it.each([
        { body: 'return X sum', initialReads: 0, finalReads: 8 },
        { body: "Local' = X sum\n return Local", initialReads: 0, finalReads: 8 },
        { body: 'Local = X sum\n return Local', initialReads: 4, finalReads: 4 },
    ])('keeps return and eager local boundaries distinct: $body', ({ body, initialReads, finalReads }) => {
        const source = counted();
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute(`use io\nfun X' total\n "entered" print\n ${body}\nend\nResult' = Input total`);
            expect(output).toEqual(['entered']);
            expect(source.reads()).toBe(initialReads);
            expect(runtime.execute('Result')).toBe(10n);
            expect(runtime.execute('Result')).toBe(10n);
            expect(source.reads()).toBe(finalReads);
            expect(output).toEqual(['entered']);
        } finally { runtime.dispose(); }
    });

    it.each([{ marker: '', initialReads: 8, finalReads: 8 }, { marker: "'", initialReads: 0, finalReads: 16 }])(
        'keeps a helper body immediate and its local boundary explicit: $marker', ({ marker, initialReads, finalReads }) => {
            const source = counted();
            const output: string[] = [];
            const runtime = new Interpreter(text => output.push(text), { compilation });
            runtime.variables.set('Input', source.value);
            try {
                runtime.execute(`use io\nuse numbers\nSource' = Input filter even\nfun X' transform\n "entered" print\n Squared${marker} = X * X\n return Squared + 1\nend\nResult' = Source transform`);
                expect(output).toEqual(['entered']);
                expect(source.reads()).toBe(initialReads);
                expect(formatValue(runtime.execute('Result')!)).toBe('5 17');
                expect(formatValue(runtime.execute('Result')!)).toBe('5 17');
                expect(source.reads()).toBe(finalReads);
                expect(output).toEqual(['entered']);
            } finally { runtime.dispose(); }
        },
    );

    it('preserves supported compiler entry within a deferred expression', () => {
        let entries = 0;
        const runtime = new Interpreter(undefined, { compilation, onScalarExecuted: () => entries++ });
        try {
            runtime.execute("Input = 3\nResult' = Input * 7 + 2");
            const result = runtime.variables.get('Result')!;
            expect(isRankPlan(result) && result.result).toMatchObject({ types: ['integer'], rank: 0, shape: [] });
            const before = entries;
            expect(runtime.execute('Result')).toBe(23n);
            expect(runtime.execute('Result')).toBe(23n);
            if (compilation) expect(entries).toBeGreaterThan(before);
            else expect(entries).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('performs explicit output in a returned expression during the call', () => {
        const source = counted();
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute("use io\nfun X' report\n return (X sum) print\nend\nResult' = Input report");
            expect(output).toEqual(['10']);
            expect(source.reads()).toBe(4);
            expect(runtime.execute('Result')).toBe(10n);
            expect(output).toEqual(['10']);
            expect(source.reads()).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('repeats effects explicitly held in a plan', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute("use io\nEffect' = \"effect\" print");
            expect(output).toEqual([]);
            runtime.execute('Effect');
            runtime.execute('Effect');
            expect(output).toEqual(['effect', 'effect']);
        } finally { runtime.dispose(); }
    });

    it('preserves short-circuit evaluation inside a scalar plan', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("Bad' = 1 // 0\nFlag' = false and Bad");
            expect(runtime.execute('Flag')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('demands one array cell through a deferred arithmetic result', () => {
        const runtime = new Interpreter(undefined, { compilation });
        let reads = 0;
        runtime.variables.set('Input', { kind: 'array', shape: [4], items: [],
            itemAt: index => { reads++; return BigInt(index + 1); },
        });
        try {
            runtime.execute("Doubled' = Input * 2");
            expect(reads).toBe(0);
            expect(runtime.execute('Doubled 2')).toBe(6n);
            expect(reads).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('keeps captured resources alive without demanding them', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const runtime = new Interpreter(undefined, { compilation, io, persistentResources: true });
        try {
            runtime.execute(`use io\nfun make\n File = "/input" open\n Size' = File size\n return Size\nend\nResult' = make`);
            expect(io.handles).toHaveLength(1);
            expect(io.handles[0].closed).toBe(false);
            expect(runtime.execute('Result')).toBe(4n);
            expect(runtime.execute('Result')).toBe(4n);
        } finally { runtime.dispose(); }
        expect(io.handles[0].closed).toBe(true);
    });

    it('does not demand a plan during bounded diagnostic formatting', () => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute("Total' = Input sum");
            expect(formatValue(runtime.variables.get('Total')!)).toBe('<plan>');
            expect(source.reads()).toBe(0);
        } finally { runtime.dispose(); }
    });
});
