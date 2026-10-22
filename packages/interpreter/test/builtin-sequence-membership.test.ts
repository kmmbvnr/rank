import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { createArraySnapshot } from '../src/array-storage.js';

describe('builtin sequence membership in compiled loops', () => {
    it.each([
        { name: 'primes', operator: 'in', expected: 168n },
        { name: 'primes', operator: 'not in', expected: 833n },
        { name: 'fibonacci', operator: 'in', expected: 15n },
    ])('compiles $operator $name without an alias', ({ name, operator, expected }) => {
        let loops = 0;
        const runtime = new Interpreter(undefined, { onIntegerLoopExecuted: () => loops++ });
        try {
            const result = runtime.execute(`use sequences
Total = 0
for N in 0 to 1000
  if N ${operator} ${name}
    Total += 1
  end
end
Total`);
            expect(result).toBe(expected);
            expect(loops).toBeGreaterThan(0);
        } finally { runtime.dispose(); }
    });

    it('rechecks a shadowed builtin on cached loop entry', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`use sequences
fun Limit count_primes
  Total = 0
  for N in 0 to Limit
    if N in primes
      Total += 1
    end
  end
  return Total
end`);
            expect(runtime.execute('1000 count_primes')).toBe(168n);
            runtime.variables.set('primes', createArraySnapshot([4n, 9n]));
            expect(runtime.execute('1000 count_primes')).toBe(2n);
            runtime.variables.delete('primes');
            expect(runtime.execute('1000 count_primes')).toBe(168n);
        } finally { runtime.dispose(); }
    });

    it('retains rebinding within a loop', () => {
        const runtime = new Interpreter();
        try {
            expect(runtime.execute(`use sequences
Allowed' = primes
Total = 0
for N in 1 to 3
  if N in Allowed
    Total += 1
  end
  Allowed' = fibonacci
end
Total`)).toBe(2n);
        } finally { runtime.dispose(); }
    });

    it('does not open a module for an untaken branch', () => {
        const runtime = new Interpreter();
        try {
            expect(runtime.execute(`Total = 0
for N in 0 to 10
  if false and N in primes
    Total += 1
  end
end
Total`)).toBe(0n);
            expect(() => runtime.execute('2 in primes')).toThrow('use sequences');
        } finally { runtime.dispose(); }
    });

    it('honours disabled sequence membership compilation', () => {
        let loops = 0;
        const runtime = new Interpreter(undefined, {
            sequenceMembershipCompilation: false, onIntegerLoopExecuted: () => loops++,
        });
        try {
            expect(runtime.execute(`use sequences
Total = 0
for N in 0 to 10
  if N in primes
    Total += 1
  end
end
Total`)).toBe(4n);
            expect(loops).toBe(0);
        } finally { runtime.dispose(); }
    });
});
