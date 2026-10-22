import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

const cases = [
    ['A = record\n .value = 1\nend', 'Alias .value = 9', 'A .value', '1'],
    ['A = new queue', 'Alias push 9', 'A len', '0'],
    ['A = new stack\nA push 1', 'Alias pop', 'A len', '1'],
    ['A = new deque', 'Alias 9 pushfront', 'A len', '0'],
    ['A = new heap\nA 1 7 enqueue', 'Alias pop', 'A len', '1'],
    ['A = new set', 'Alias add 9', 'A len', '0'],
    ['A = new counter\nA add 1\nA add 1', 'Alias remove 1', 'A 1', '2'],
    ['A = new multiset\nA add 1', 'Alias add 9', 'A len', '1'],
    ['A = new index\nA 0 = 1', 'Alias 0 = 9', 'A 0', '1'],
    ['A = 2 fenwick\nA 0 = 1', 'Alias 0 += 9', 'A 0', '1'],
    ['A = (array 1 2) segment +', 'Alias 0 1 += 9', 'A 0 1 query', '3'],
] as const;

describe.each([false, true])('captured mutable aliases (compilation=%s)', compilation => {
    it.each(cases)('rejects writes through an earlier alias: %s / %s', (setup, write, read, expected) => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute(`use algo\n${setup}\nAlias = A\nPlan' = A`);
            expect(() => host.execute(write)).toThrowError('A is read-only because plan Plan reads it');
            expect(formatValue(host.execute(read)!)).toBe(expected);
        } finally { host.dispose(); }
    });

    it('keeps aliases created after capture read-only too', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute("use algo\nA = new queue\nPlan' = A len");
            host.execute('Alias = A');
            expect(() => host.execute('Alias push 9')).toThrowError('A is read-only');
            expect(host.execute('Plan')).toBe(0n);
        } finally { host.dispose(); }
    });

    it('checks nested record receivers before evaluating the assigned expression', () => {
        const output: string[] = [];
        const host = new Interpreter(text => output.push(text), { compilation });
        try {
            host.execute([
                'use io', 'Child = record', ' .value = 1', 'end',
                'A = record', ' .child = Child', 'end', 'Alias = A', "Plan' = A .child .value",
                'fun changed', ' "must not print" print', ' return 9', 'end',
            ].join('\n'));
            expect(() => host.execute('Alias .child .value = changed')).toThrowError('A is read-only');
            expect(output).toEqual([]);
            expect(host.execute('Child .value')).toBe(1n);
            expect(host.execute('Plan')).toBe(1n);
        } finally { host.dispose(); }
    });

    it('protects records reached through an index and a tuple', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute([
                'use algo', 'Child = record', ' .value = 1', 'end',
                'Index = new index', 'Index 0 = tuple Child 7', 'A = tuple Index 8', "Plan' = A",
            ].join('\n'));
            expect(() => host.execute('Child .value = 9')).toThrowError('A is read-only');
            expect(() => host.execute('Index 0 = tuple Child 10')).toThrowError('A is read-only');
            expect(host.execute('Child .value')).toBe(1n);
        } finally { host.dispose(); }
    });

    it('protects heap priorities as well as payloads', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute([
                'use algo', 'Priority = record', ' .value = 1', 'end',
                'Payload = record', ' .value = 2', 'end', 'A = new heap',
                'A Priority Payload enqueue', "Plan' = A len",
            ].join('\n'));
            expect(() => host.execute('Priority .value = 9')).toThrowError('A is read-only');
            expect(() => host.execute('Payload .value = 9')).toThrowError('A is read-only');
            expect(host.execute('A len')).toBe(1n);
        } finally { host.dispose(); }
    });

    it('rejects a mutation through a helper before entering its body', () => {
        const output: string[] = [];
        const host = new Interpreter(text => output.push(text), { compilation });
        try {
            host.execute([
                'use algo', 'use io', 'fun Items append_item', ' "must not print" print',
                ' Items push 9', ' return 0', 'end', 'A = new queue', 'Alias = A', "Plan' = A len",
            ].join('\n'));
            expect(() => host.execute('Alias append_item')).toThrowError('A is read-only');
            expect(output).toEqual([]);
            expect(host.execute('Plan')).toBe(0n);
        } finally { host.dispose(); }
    });

    it('protects actual global callback dependencies without protecting unrelated data', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute([
                'use algo', 'Child = record', ' .value = 3', 'end',
                'Alias = Child', 'Unrelated = new queue',
                'fun X below = X less Child .value', "Plan' = 1 to 10 filter below",
                'Unrelated push 7',
            ].join('\n'));
            expect(() => host.execute('Alias .value = 9')).toThrowError('below is read-only');
            expect(host.execute('Unrelated len')).toBe(1n);
            expect(host.execute('Child .value')).toBe(3n);
        } finally { host.dispose(); }
    });

    it('protects a deferred parameter against writes through an ordinary local alias', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute("fun X' change\n Local = X\n Local .value = 9\n return 0\nend\nA = record\n .value = 1\nend");
            expect(() => host.execute('A change')).toThrowError('X is a deferred parameter and is read-only');
            expect(host.execute('A .value')).toBe(1n);
        } finally { host.dispose(); }
    });

    it('retains array CoW for cells stored inside a captured record', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute([
                'Cells = array 1 2', 'A = record', ' .values = Cells', 'end',
                'Alias = Cells', "Plan' = A .values sum", 'Alias 0 = 9',
            ].join('\n'));
            expect(formatValue(host.execute('Alias')!)).toBe('9 2');
            expect(host.execute('Plan')).toBe(3n);
        } finally { host.dispose(); }
    });

    it('allows fresh record and container storage to be updated', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute([
                'use algo', 'A = record', ' .value = 1', 'end', "Plan' = A .value",
                'Work = A with', ' .value = 2', 'end', 'Work .value = 3',
                'Q = new queue', 'Q push 1', "Size' = Q len", 'Copy = new queue Q', 'Copy push 9',
            ].join('\n'));
            expect(host.execute('A .value')).toBe(1n);
            expect(host.execute('Work .value')).toBe(3n);
            expect(host.execute('Copy len')).toBe(2n);
            expect(host.execute('Size')).toBe(1n);
        } finally { host.dispose(); }
    });

    it('carries data protection into an alias in a preview fork', () => {
        const host = new Interpreter(undefined, { compilation });
        let preview: Interpreter | undefined;
        try {
            host.execute("use algo\nA = new queue\nAlias = A\nPlan' = A len");
            preview = host.forkForPreview();
            expect(() => preview!.execute('Alias push 9')).toThrowError('A is read-only');
            expect(host.execute('Plan')).toBe(0n);
        } finally { preview?.dispose(); host.dispose(); }
    });
});
