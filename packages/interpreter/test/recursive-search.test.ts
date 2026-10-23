import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Interpreter, RankError, formatValue, isNativeFunction, withDemandBudget, DemandBudgetExhausted } from '../src/index.js';
import { RankDeque } from '../src/containers.js';
import { protectValue } from '../src/value-protection.js';

const search = `use algo
fun A Cache N lookup
  if N in Cache
    return Cache N
  end
  Value = A N
  Cache N = Value
  return Value
end
fun A Cache N search
  if N equal 0
    return A Cache 0 lookup
  end
  return (A Cache N lookup) + (A Cache (N - 1) search)
end
A = array 2 3 5 7
Cache = new index`;

function compare(source: string, expressions: string[], maxCallDepth?: number) {
    const runs = [false, true].map(compilation => {
        let bodies = 0;
        const runtime = new Interpreter(() => {}, { compilation, maxCallDepth,
            onFunctionBodyExecuted: () => bodies++ });
        try {
            runtime.execute(source);
            const values = expressions.map(expression => {
                try {
                    const value = runtime.execute(expression);
                    return { value: value === undefined ? 'undefined' : formatValue(value) };
                }
                catch (error) {
                    if (!(error instanceof RankError)) throw error;
                    return { error: error.format() };
                }
            });
            return { values, bodies };
        } finally { runtime.dispose(); }
    });
    expect(runs[1].values).toEqual(runs[0].values);
    return runs[1];
}

describe('linked recursive searches with arrays and indices', () => {
    it('shares memo writes across nested and recursive calls without ordinary bodies', () => {
        const result = compare(search, ['A Cache 3 search', 'Cache 2', 'A Cache 3 search', 'A 2']);
        expect(result.values.map(result => result.value)).toEqual(['17', '5', '17', '5']);
        expect(result.bodies).toBe(0);
    });

    it('preserves selection failures and nested call locations', () => {
        const result = compare(search, ['A Cache 4 search', 'A Cache -1 search', 'A Cache 0 search']);
        expect(result.values[0].error).toContain('out of bounds');
        expect(result.values[1].error).toContain('out of bounds');
        expect(result.values[2].value).toBe('2');
    });

    it.each([1, 2, 5])('preserves logical depth limits and recovery at depth %s', depth => {
        compare(search, ['A Cache 3 search', 'A Cache 0 search'], depth);
    });

    it('keeps helpers that write arrays on the ordinary path', () => {
        const result = compare(`fun A writecell N
 A 0 = N
 return A 0
end
fun A outer N
 return A writecell N
end
A = array 1 2
Alias = A`, ['A outer 8', 'A 0', 'Alias 0']);
        expect(result.values.map(result => result.value)).toEqual(['8', '1', '1']);
        expect(result.bodies).toBeGreaterThan(0);
    });

    it('polls linked calls and recovers after interruption', () => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(search);
            const fn = runtime.variables.get('search');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing search');
            const args = [runtime.variables.get('A')!, runtime.variables.get('Cache')!, 3n];
            expect(() => withDemandBudget(1, () => fn.call(args))).toThrow(DemandBudgetExhausted);
            expect(fn.call(args)).toBe(17n);
        } finally { runtime.dispose(); }
    });

    it.each(['queue', 'stack', 'deque'])('links recursive reads from a shared integer %s', mode => {
        const source = search.replace('A = array 2 3 5 7', `A = new ${mode}\nA push 2\nA push 3\nA push 5\nA push 7`);
        const result = compare(source, ['A Cache 3 search', 'A 0', 'A 3', 'A Cache 4 search', 'A Cache -1 search']);
        expect(result.values[0].value).toBe('17');
        expect(result.bodies).toBe(0);
    });

    it.each(['queue', 'stack', 'deque'] as const)('rechecks a %s after front/back operations', mode => {
        const runtime = new Interpreter(() => {});
        const queue = new RankDeque(mode).push(9n).push(2n).push(3n);
        runtime.variables.set('Q', queue);
        try {
            runtime.execute('fun Q readcell I\nreturn Q I\nend');
            expect(runtime.execute('Q readcell 0')).toBe(9n);
            queue.pop(false);
            queue.pushFront(1n);
            expect(runtime.execute('Q readcell 0')).toBe(1n);
            queue.pop(true);
            expect(() => runtime.execute('Q readcell 2')).toThrow('queue index out of bounds: 2');
            expect(() => queue.push('wrong')).toThrow('holds integer');
            expect(runtime.execute('Q readcell 1')).toBe(2n);
        } finally { runtime.dispose(); }
    });

    it('retains ordinary execution for real and legacy queues', () => {
        let kernels = 0;
        const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => kernels++ });
        try {
            runtime.execute('fun Q readcell I\nreturn Q I\nend');
            for (const queue of [new RankDeque().push(1.5), { kind: 'queue' as const, items: [2.5] }]) {
                runtime.variables.set('Q', queue);
                expect(runtime.execute('Q readcell 0')).toBe(queue.items[0]);
            }
            expect(kernels).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('keeps host queue overrides outside the integer entry proof', () => {
        let kernels = 0;
        const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => kernels++ });
        class HostQueue extends RankDeque {
            override at(): bigint { return 42n; }
        }
        const overridden = new RankDeque().push(1n);
        overridden.at = () => 43n;
        try {
            runtime.execute('fun Q readcell I\nreturn Q I\nend');
            for (const [queue, expected] of [[new HostQueue().push(1n), 42n], [overridden, 43n]] as const) {
                runtime.variables.set('Q', queue);
                expect(runtime.execute('Q readcell 0')).toBe(expected);
            }
            expect(kernels).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('rechecks linked helper bindings and index domains', () => {
        const result = compare(search, ['A Cache 0 search', 'Cache 0 = 1.5', 'A Cache 0 search', 'Cache 0 = 2', 'A Cache 0 search']);
        expect(result.values[0].value).toBe('2');
        expect(result.values[2].error).toContain('cannot return real');
        expect(result.values[4].value).toBe('2');
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(search + '\nfun A Cache N replacement\nreturn 11\nend');
                expect(runtime.execute('A Cache 0 search')).toBe(2n);
                runtime.variables.set('lookup', runtime.variables.get('replacement')!);
                expect(runtime.execute('A Cache 0 search')).toBe(11n);
            } finally { runtime.dispose(); }
        }
    });

    it('checks queue protection before evaluating a pushed value', () => {
        for (const compilation of [false, true]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute('use algo\nfun Q insertvalue N\nQ push (1 // N)\nreturn 0\nend');
                const queue = new RankDeque().push(1n);
                protectValue(queue, 'protected queue');
                runtime.variables.set('Q', queue);
                expect(() => runtime.execute('Q insertvalue 0')).toThrow('protected queue');
                expect(queue.items).toEqual([1n]);
            } finally { runtime.dispose(); }
        }
    });

    it('runs the unchanged Euler 362 recurrence against enumerated factorizations', () => {
        const source = readFileSync(new URL('../../../demos/euler/362_squarefree.ra', import.meta.url), 'utf8');
        for (const limit of [4, 5, 10, 30, 100, 200]) {
            const factors = Array.from({ length: limit - 1 }, (_, i) => i + 2).filter(value => {
                for (let d = 2; d * d <= value; d++) if (value % (d * d) === 0) return false;
                return true;
            });
            const count = (product: number, start: number): number => {
                let result = 0;
                for (let i = start; i < factors.length && product * factors[i] <= limit; i++) {
                    result += 1 + count(product * factors[i], i);
                }
                return result;
            };
            for (const compilation of [false, true]) {
                const runtime = new Interpreter(() => {}, { compilation, args: ['--limit', String(limit)] });
                try { expect(runtime.execute(source)).toBe(BigInt(count(1, 0))); }
                finally { runtime.dispose(); }
            }
        }
    });
});
