import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction } from '../src/index.js';
import { sequence } from '../src/sequence.js';

function counted(infinite = false) {
    let reads = 0;
    const value = sequence({ name: 'counted parameter source',
        size: infinite ? { kind: 'infinite' } : { kind: 'exact', value: 4n },
        *iterate() { for (let value = 1n; infinite || value <= 4n; value++) { reads++; yield value; } },
    });
    return { value, reads: () => reads };
}

describe.each([false, true])('parameter binding boundaries (compilation=%s)', compilation => {
    it.each([{ marker: '', reads: 4 }, { marker: "'", reads: 8 }])(
        'honors the parameter marker: $marker', ({ marker, reads }) => {
            const source = counted();
            const runtime = new Interpreter(undefined, { compilation });
            runtime.variables.set('Input', source.value);
            try {
                expect(runtime.execute(`fun X${marker} twice\n return (X sum) + (X sum)\nend\nInput twice`)).toBe(20n);
                expect(source.reads()).toBe(reads);
            } finally { runtime.dispose(); }
        },
    );

    it('leaves an already computed argument ready for a deferred parameter', () => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute("fun X' twice\n return (X sum) + (X sum)\nend\nSaved = Input");
            expect(source.reads()).toBe(4);
            expect(runtime.execute('Saved twice')).toBe(20n);
            expect(source.reads()).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('rejects a known-infinite eager argument before entering the body', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            expect(() => runtime.execute('use io\nfun X probe\n "entered" print\n return X take 2\nend\n(1 to #) probe'))
                .toThrowError('cannot materialize an infinite sequence');
            expect(output).toEqual([]);
        } finally { runtime.dispose(); }
    });

    it('allows a deferred parameter to consume a finite prefix', () => {
        const source = counted(true);
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            const result = runtime.execute("fun X' probe\n Head = X take 2\n return Head\nend\nInput probe");
            expect(formatValue(result!)).toBe('1 2');
            expect(source.reads()).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('keeps eager local work immediate under an outer deferred binding', () => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute("fun X' transform\n Squared = X * X\n return Squared + 1\nend\nResult' = Input transform");
            expect(source.reads()).toBe(8);
            expect(formatValue(runtime.execute('Result')!)).toBe('2 5 10 17');
            expect(source.reads()).toBe(8);
        } finally { runtime.dispose(); }
    });

    it('applies mixed left, right and group parameter modes', () => {
        const left = counted(), right = counted(), option = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Left', left.value);
        runtime.variables.set('Right', right.value);
        runtime.variables.set('Option', option.value);
        try {
            const result = runtime.execute([
                "fun X' stats Y .extra Z'", ' return (X sum) + (X sum) + (Y sum) + (Y sum) + (Z sum) + (Z sum)',
                'end', 'Left stats Right extra Option',
            ].join('\n'));
            expect(result).toBe(60n);
            expect(left.reads()).toBe(8);
            expect(right.reads()).toBe(4);
            expect(option.reads()).toBe(8);
        } finally { runtime.dispose(); }
    });

    it('materializes an eager tail-call argument before running the callee', () => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation, maxCallDepth: 1 });
        runtime.variables.set('Input', source.value);
        try {
            expect(runtime.execute([
                'fun X retained', ' return (X sum) + (X sum)', 'end',
                "fun X' pass", ' return X retained', 'end', 'Input pass',
            ].join('\n'))).toBe(20n);
            expect(source.reads()).toBe(4);
        } finally { runtime.dispose(); }
    });

    it.each(['', ' extra .NA', ' extra Missing'])('applies defaults and materialization together on a tail call: %s', suffix => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation, maxCallDepth: 1 });
        runtime.variables.set('Input', source.value);
        try {
            expect(runtime.execute([
                'Missing = .NA', 'fun X total .extra Extra = 3', ' return (X sum) + Extra', 'end',
                "fun X' pass", ` return X total${suffix}`, 'end', 'Input pass',
            ].join('\n'))).toBe(13n);
            expect(source.reads()).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('uses the same parameter boundary for calls from the host', () => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('fun X twice\n return (X sum) + (X sum)\nend');
            const fn = runtime.variables.get('twice')!;
            if (!isNativeFunction(fn)) throw new Error('expected function');
            expect(fn.call([source.value])).toBe(20n);
            expect(source.reads()).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('rejects an invalid host call before materializing arguments', () => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('fun X total = X sum');
            const fn = runtime.variables.get('total')!;
            if (!isNativeFunction(fn)) throw new Error('expected function');
            expect(() => fn.call([source.value, 1n])).toThrowError('total expects 1 arguments, got 2');
            expect(source.reads()).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('preserves writable local ownership for an eager parameter', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('Input = array 1 2\nfun X change\n X 0 = 9\n return X\nend\nChanged = Input change');
            expect(formatValue(runtime.execute('Input')!)).toBe('1 2');
            expect(formatValue(runtime.execute('Changed')!)).toBe('9 2');
        } finally { runtime.dispose(); }
    });

    it('enters supported compiled code after materializing the argument', () => {
        const source = counted();
        let entries = 0;
        const entered = () => entries++;
        const runtime = new Interpreter(undefined, { compilation,
            onScalarExecuted: entered, onScalarFunctionExecuted: entered, onFunctionBodyExecuted: entered,
        });
        runtime.variables.set('Input', source.value);
        try {
            expect(runtime.execute('fun X total\n Saved = X\n return Saved sum\nend\nInput total')).toBe(10n);
            expect(source.reads()).toBe(4);
            if (compilation) expect(entries).toBeGreaterThan(0);
            else expect(entries).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('applies eager entry rules to user generators before iteration', () => {
        const source = counted();
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute("fun X values\n yield X sum\n yield X sum\nend\nStream' = Input values");
            expect(source.reads()).toBe(4);
            expect(formatValue(runtime.execute('Stream')!)).toBe('10 10');
            expect(source.reads()).toBe(4);
        } finally { runtime.dispose(); }
    });
});
