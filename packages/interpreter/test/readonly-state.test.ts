import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { LocalFrame } from '../src/frame.js';

const mutations = [
    ['A = array 1 2', "Plan' = A * 2", 'A 0 = 9', 'Plan 0', '2'],
    ['A = array 1 2', "Plan' = A * 2", 'A += 9', 'Plan 0', '2'],
    ['A = record\n .value = 1\nend', "Plan' = A .value * 2", 'A .value = 9', 'Plan', '2'],
    ['A = new queue', "Plan' = A len", 'A push 9', 'Plan', '0'],
    ['A = new queue\nA push 1', "Plan' = A len", 'A pop', 'Plan', '1'],
    ['A = new deque', "Plan' = A len", 'A 9 pushfront', 'Plan', '0'],
    ['A = new heap', "Plan' = A len", 'A 1 9 enqueue', 'Plan', '0'],
    ['A = new set', "Plan' = A len", 'A add 9', 'Plan', '0'],
    ['A = new index\nA 0 = 1', "Plan' = A 0 * 2", 'A 0 = 9', 'Plan', '2'],
] as const;

describe.each([false, true])('scope protection across executions (compilation=%s)', compilation => {
    it.each(mutations)('rejects a later cell mutation: %s / %s', (setup, capture, write, read, expected) => {
        const output: string[] = [];
        const host = new Interpreter(text => output.push(text), { compilation });
        try {
            host.execute(`use algo\nuse io\n${setup}\n${capture}`);
            expect(() => host.execute(`"must not print" print\n${write}`))
                .toThrowError('A is read-only because plan Plan reads it');
            expect(output).toEqual([]);
            expect(formatValue(host.execute(read)!)).toBe(expected);
        } finally { host.dispose(); }
    });

    it.each(['A 0 = 9', 'A 0 += 9', 'A += array 9 9'])('keeps protection after rebinding: %s', write => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute("A = array 1 2\nPlan' = A * 2");
            host.execute('A = array 3 4');
            expect(() => host.execute(write)).toThrowError('A is read-only because plan Plan reads it');
            expect(formatValue(host.execute('A')!)).toBe('3 4');
            expect(formatValue(host.execute('Plan')!)).toBe('2 4');
        } finally { host.dispose(); }
    });

    it('protects a read of a name from an earlier cell', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute('A = array 1 2');
            host.execute("Plan' = A * 2");
            expect(() => host.execute('A 0 = 9')).toThrowError('A is read-only because plan Plan reads it');
            expect(formatValue(host.execute('Plan')!)).toBe('2 4');
        } finally { host.dispose(); }
    });

    it('locates a persisted protection error at the attempted mutation', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute("A = array 1 2\nPlan' = A * 2");
            let failure: unknown;
            try { host.execute('A = array 3 4\nA 0 = 9'); } catch (error) { failure = error; }
            expect(failure).toMatchObject({ location: { line: 2, column: 1, sourceLine: 'A 0 = 9' } });
            expect(formatValue(host.execute('A')!)).toBe('1 2');
        } finally { host.dispose(); }
    });

    it('does not unlock a source when its plan name is forgotten', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute("A = array 1 2\nPlan' = A * 2");
            host.forgetBindings(['Plan']);
            expect(() => host.execute('A 0 = 9')).toThrowError('A is read-only because plan Plan reads it');
        } finally { host.dispose(); }
    });

    it('allows an explicitly forgotten source to start a new binding', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute("use algo\nA = new queue\nPlan' = A len");
            host.forgetBindings(['A']);
            host.execute('A = new queue\nA push 9');
            expect(host.execute('A len')).toBe(1n);
            expect(host.execute('Plan')).toBe(0n);
        } finally { host.dispose(); }
    });

    it.each(['A change', 'A forward', 'A act change'])('rejects a later helper mutation through %s', call => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute([
                'fun X change', ' X 0 = 9', ' return X', 'end',
                'fun X forward = X change', 'fun X act op = X op',
                'A = array 1 2', "Plan' = A * 2",
            ].join('\n'));
            expect(() => host.execute(call)).toThrowError('A is read-only because plan Plan reads it');
            expect(formatValue(host.execute('Plan')!)).toBe('2 4');
        } finally { host.dispose(); }
    });

    it('still permits a read-only helper from a previous cell', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute('use algo\nfun X inspect = X peek\nA = new queue\nA push 7');
            host.execute("Plan' = A len");
            expect(host.execute('A inspect')).toBe(7n);
        } finally { host.dispose(); }
    });

    it('checks a qualified module source and its helper in later cells', () => {
        const host = new Interpreter(undefined, { compilation, loadModule: () => ({ id: 'data.ra', source:
            'A = array 1 2\nfun X change\n X 0 = 9\n return X\nend' }) });
        try {
            host.execute('use "data" as H\nH.run');
            host.execute("Plan' = H.A * 2");
            expect(() => host.execute('H.A 0 = 9')).toThrowError('is read-only because plan Plan reads it');
            expect(() => host.execute('H.A H.change')).toThrowError('is read-only because plan Plan reads it');
            expect(formatValue(host.execute('H.A')!)).toBe('1 2');
        } finally { host.dispose(); }
    });

    it('does not protect a source when construction of the binding fails', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute('A = array 1 2\nfun X fail = 1 // 0');
            expect(() => host.execute("Plan' = A fail")).toThrow();
            host.execute('A 0 = 9');
            expect(formatValue(host.execute('A')!)).toBe('9 2');
        } finally { host.dispose(); }
    });

    it('protects only bindings that actually execute', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute("use algo\nA = new queue\nif false\n Plan' = A len\nend");
            host.execute('A push 9');
            expect(host.execute('A len')).toBe(1n);
        } finally { host.dispose(); }
    });

    it('keeps global protection separate from a fresh parameter of the same name', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute("A = array 1 2\nPlan' = A * 2");
            host.execute('fun A change\n A 0 = 9\n return A\nend');
            expect(formatValue(host.execute('(array 3 4) change')!)).toBe('9 4');
            expect(formatValue(host.execute('Plan')!)).toBe('2 4');
        } finally { host.dispose(); }
    });

    it('resets local protection between independent calls', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            expect(formatValue(host.execute([
                'use sequences', 'fun N calculate', ' A = array N', ' A 0 += 1',
                " Plan' = A * 2", ' return Plan sum', 'end', 'tuple (1 calculate) (2 calculate)',
            ].join('\n'))!)).toBe('4 6');
        } finally { host.dispose(); }
    });

    it('catches a loop-carried write that precedes the plan in source order', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            expect(() => host.execute([
                'A = array 1', 'for I in 1 to 2', ' A 0 += 1', " Plan' = A * 2", 'end',
            ].join('\n'))).toThrowError('A is read-only because plan Plan reads it');
            expect(host.execute('A 0')).toBe(2n);
        } finally { host.dispose(); }
    });

    it('copies scope protection into a preview without changing the original', () => {
        const host = new Interpreter(undefined, { compilation });
        let preview: Interpreter | undefined;
        try {
            host.execute("use algo\nA = new queue\nPlan' = A len");
            preview = host.forkForPreview();
            expect(() => preview!.execute('A push 9')).toThrowError('A is read-only because plan Plan reads it');
            expect(() => host.execute('A push 9')).toThrowError('A is read-only because plan Plan reads it');
            expect(host.execute('A len')).toBe(0n);
        } finally { preview?.dispose(); host.dispose(); }
    });
});

describe('compiled write entry protection', () => {
    it('rejects a protected loop write before entering a numeric kernel', () => {
        let entries = 0;
        const host = new Interpreter(undefined, { compilation: true, onIntegerLoopExecuted: () => { entries++; } });
        try {
            host.execute("A = array 1 2\nPlan' = A * 2");
            expect(() => host.execute('for I in 0 till 2\n A I += 1\nend')).toThrowError('A is read-only');
            expect(entries).toBe(0);
            expect(formatValue(host.execute('A')!)).toBe('1 2');
        } finally { host.dispose(); }
    });

    it('rejects a protected compound write before entering a tensor kernel', () => {
        let entries = 0;
        const host = new Interpreter(undefined, { compilation: true, onTensorKernelExecuted: () => { entries++; } });
        try {
            host.execute("A = array 1 2\nPlan' = A * 2");
            entries = 0;
            expect(() => host.execute('A += array 3 4')).toThrowError('A is read-only');
            expect(entries).toBe(0);
            expect(formatValue(host.execute('A')!)).toBe('1 2');
        } finally { host.dispose(); }
    });
});

describe('frame protection lifetime', () => {
    it('keeps protection across rebinding/release, but clears it on frame reset', () => {
        const frame = new LocalFrame(undefined);
        frame.define('A', 1n, new Set(['integer']));
        frame.protectName('A', 'protected');
        frame.set('A', 2n);
        frame.release('A');
        expect(frame.mutationError('A')).toBe('protected');
        expect(frame.reset()).toBe(true);
        expect(frame.mutationError('A')).toBeUndefined();
    });
});
