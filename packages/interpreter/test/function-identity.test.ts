import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction } from '../src/index.js';

describe('function identity', () => {
    it('returns the same standard function across reads, aliases and calls', () => {
        const runtime = new Interpreter();
        expect(runtime.execute('use numbers\nabs equal abs')).toBe(true);
        runtime.execute('F = abs\n-3 abs');
        expect(runtime.execute('F equal abs')).toBe(true);
        expect(runtime.execute('F not equal abs')).toBe(false);
        expect(runtime.execute('abs equal sqrt')).toBe(false);
        expect(runtime.execute('use numbers\nF equal abs')).toBe(true);
    });

    it('compares user functions and aliases by identity, not source or results', () => {
        const runtime = new Interpreter();
        runtime.execute(`
fun first X
  return X + 1
end
fun second X
  return X + 1
end
F = first
`);
        expect(runtime.execute('first equal first')).toBe(true);
        expect(runtime.execute('F equal first')).toBe(true);
        expect(runtime.execute('first equal second')).toBe(false);
        runtime.execute('fun first X\n return X + 1\nend');
        expect(runtime.execute('F equal first')).toBe(false);
    });

    it('keeps separate closure instances distinct even with equal captures', () => {
        const runtime = new Interpreter();
        runtime.execute(`
fun make Base
  fun add X
    return Base + X
  end
  return add
end
A = 1 make
B = 1 make
C = A
`);
        expect(runtime.execute('A equal B')).toBe(false);
        expect(runtime.execute('A equal C')).toBe(true);
        expect(runtime.execute('(5 A) equal (5 B)')).toBe(true);
    });

    it('keeps cached functions and their host contexts private to each interpreter', () => {
        const firstOutput: string[] = [];
        const secondOutput: string[] = [];
        const first = new Interpreter(line => firstOutput.push(line));
        const second = new Interpreter(line => secondOutput.push(line));
        const a = first.execute('use io\nprint');
        const b = second.execute('use io\nprint');
        expect(a).not.toBe(b);
        if (!a || !b || !isNativeFunction(a) || !isNativeFunction(b)) {
            throw new Error('expected functions');
        }
        a.call([1n]);
        b.call([2n]);
        expect(firstOutput).toEqual(['1']);
        expect(secondOutput).toEqual(['2']);
        expect(first.execute('print')).toBe(a);
        expect(second.execute('print')).toBe(b);
    });
});
