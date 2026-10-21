import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { completed } from '../src/execution.js';
import { native } from '../src/modules/shared.js';
import type { RankPlan } from '../src/plan.js';
import { sequence } from '../src/sequence.js';

const graphPrefix = `use graph
use algo
fun Offset build
 fun A B match = A + Offset equal B
 G = new graph (1 to 5) with match .directed
`;

describe.each([false, true])('computation plan escape (compilation=%s)', compilation => {
    it('returns a local callback plan with frozen dependencies and repeats its effects', () => {
        const output: string[] = [];
        const host = new Interpreter(text => output.push(text), { compilation });
        try {
            host.execute([
                'use io', 'fun Limit selected', ' fun X below', '  X print',
                '  return X less Limit', ' end', " Plan' = 1 to 3 filter below",
                ' Limit = 0', ' return Plan', 'end', "Saved' = 3 selected",
            ].join('\n'));
            expect(output).toEqual([]);
            expect(host.execute('Saved sum')).toBe(3n);
            expect(output).toEqual(['1', '2', '3']);
            expect(host.execute('Saved sum')).toBe(3n);
            expect(output).toEqual(['1', '2', '3', '1', '2', '3']);
        } finally { host.dispose(); }
    });

    it('returns plans through mutually recursive helpers', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute(`fun Limit outer
 fun X below = X less Limit
 fun N left
  if N equal 0
   return 1 to 10 filter below
  end
  return (N - 1) right
 end
 fun N right = N left
 return 3 right
end
Saved' = 6 outer`);
            expect(host.execute('Saved sum')).toBe(15n);
            expect(host.execute('Saved sum')).toBe(15n);
        } finally { host.dispose(); }
    });

    it('completes a nested generator at an ordinary parameter boundary', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            host.execute(`fun Source forward = Source
fun Limit outer
 fun values
  yield Limit
  yield Limit + 1
 end
 return values forward
end
Saved = 6 outer`);
            expect(formatValue(host.execute('Saved')!)).toBe('6 7');
        } finally { host.dispose(); }
    });

    it('keeps the live nested-generator restriction across deferred parameters', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            expect(() => host.execute(`fun Source' forward = Source
fun Limit outer
 fun values
  yield Limit
 end
 return values forward
end
Saved' = 6 outer`)).toThrow('lazy result retains nested function values');
        } finally { host.dispose(); }
    });

    it.each(['return Items sort by key', 'return Items copy', 'return Items array'])('preserves nested stream provenance through %s', result => {
        const host = new Interpreter(undefined, { compilation });
        try {
            const source = `fun Limit outer
 fun values
  yield Limit
 end
 fun X key = 0
 Items' = array (tuple values)
 ${result}
end
Saved' = 6 outer`;
            if (result.endsWith(' array')) {
                host.execute(source);
                expect(host.execute('((Saved 0) 0) sum')).toBe(6n);
            } else {
                expect(() => host.execute(source)).toThrow('lazy result retains nested function values');
            }
        } finally { host.dispose(); }
    });

    it('detects a nested callback retained by a top-level generator parameter', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            expect(() => host.execute(`fun produce action
 yield 1 action
end
fun Limit outer
 fun X below = X less Limit
 return produce below
end
Saved' = 6 outer`)).toThrow('lazy result retains nested function below');
        } finally { host.dispose(); }
    });

    it.each([
        'return G',
        'return tuple G 7',
        'Box = record\n .graph = G\nend\nreturn Box',
        'Box = new queue\nBox push G\nreturn Box 0',
    ])('keeps an opaque live callback protected through nested storage: %s', result => {
        const host = new Interpreter(undefined, { compilation });
        try {
            expect(() => host.execute(`${graphPrefix}${result}\nend\n2 build`))
                .toThrow('lazy result retains nested function match');
        } finally { host.dispose(); }
    });

    it('allows a known helper to complete relation neighbors before return', () => {
        const host = new Interpreter(undefined, { compilation });
        try {
            const source = 'fun Relation Start neighbors = (Relation Start) array\n'
                + graphPrefix + 'return G 1 neighbors\nend\n2 build';
            expect(formatValue(host.execute(source)!)).toBe('3');
        } finally { host.dispose(); }
    });

    it('rejects passing an opaque local relation to a host that could retain it', () => {
        let calls = 0;
        const host = new Interpreter(undefined, { compilation });
        host.variables.set('retain', native('retain', 1, () => { calls++; return 0n; }));
        try {
            expect(() => host.execute(`${graphPrefix}G retain\nreturn 0\nend\n2 build`))
                .toThrow('nested function match');
            expect(calls).toBe(0);
        } finally { host.dispose(); }
    });

    it('recursively completes explicit array output without an assignment', () => {
        let calls = 0;
        const item: RankPlan = { kind: 'plan', dependencies: new Map(), evaluate: () => { calls++; return completed(7n); } };
        const host = new Interpreter(undefined, { compilation });
        host.variables.set('Source', sequence({ name: 'nested plans', size: { kind: 'exact', value: 2n },
            *iterate() { yield item; yield item; },
        }));
        try {
            const result = host.execute('Source array')!;
            expect(calls).toBe(2);
            expect(formatValue(result)).toBe('7 7');
            expect(calls).toBe(2);
            expect(formatValue(host.execute('(array 1 2) array')!)).toBe('1 2');
        } finally { host.dispose(); }
    });
});
