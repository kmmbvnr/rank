import { describe, expect, it } from 'vitest';
import { Interpreter, parse } from '../src/index.js';

const forms = [
    ['new graph (array 1 2) with (callback) .directed', 2, 'graph predicate expects two arguments'],
    ['new graph with (callback) .directed', 1, 'graph successor expects one argument'],
    ['(1 to 3) scan callback', 2, 'scan requires a binary operation'],
    ['(1 to 3) reduce callback', 2, 'reduce requires a binary operation'],
    ['(array 1 2) segment callback with 0', 2, 'segment requires a binary operation'],
    ['(array 1 2) (array 3 4) outer callback', 2, 'outer operation invalid must accept 2 arguments'],
    ['0 (callback) repeat 3', 1, 'repeat requires a unary function'],
] as const;

describe.each([false, true])('callback reference positions (compilation=%s)', compilation => {
    it.each(forms)('validates current arity without invoking a nullary replacement: %s', (expression, arity, message) => {
        const output: string[] = [];
        const host = new Interpreter(text => output.push(text), { compilation });
        try {
            host.execute('use io\nfun invalid\n "unexpected" print\n return 7\nend');
            const program = parse(`use graph\nuse algo\n${expression}`, '<callback>', {
                bindings: new Map([['callback', [arity]]]),
            });
            // An embedder can change a callable after source grouping; runtime
            // guards must check the current function before entering its body.
            host.variables.set('callback', host.variables.get('invalid')!);
            expect(() => host.executeProgram(program)).toThrow(message);
            expect(output).toEqual([]);
        } finally { host.dispose(); }
    });

    it('keeps a parenthesized named callback as a reference during plan construction', () => {
        const output: string[] = [];
        const host = new Interpreter(text => output.push(text), { compilation });
        try {
            host.execute('use graph\nuse io\nfun invalid\n "unexpected" print\n return true\nend');
            host.execute("Plan' = new graph (array 1 2) with (invalid) .directed");
            expect(output).toEqual([]);
            expect(() => host.execute('Plan')).toThrow('graph predicate expects two arguments');
            expect(output).toEqual([]);
        } finally { host.dispose(); }
    });

    it('executes a compound expression that produces a callback', () => {
        const output: string[] = [];
        const host = new Interpreter(text => output.push(text), { compilation });
        try {
            host.execute([
                'use graph', 'use io', 'fun A B same = A equal B', 'fun N make', ' "made" print', ' return same', 'end',
                'G = new graph (array 1 2) with (1 make) .directed',
            ].join('\n'));
            expect(output).toEqual(['made']);
            expect(host.execute('G 1 1 adjacent')).toBe(true);
            expect(host.execute('G 1 2 adjacent')).toBe(false);
            expect(output).toEqual(['made']);
        } finally { host.dispose(); }
    });
});
