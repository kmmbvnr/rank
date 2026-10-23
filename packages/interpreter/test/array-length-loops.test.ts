import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function execute(source: string, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    let error: string | undefined;
    try {
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}

function compare(source: string) {
    const reference = execute(source, { compilation: false });
    const exact = execute(source, { numberLoopCompilation: false });
    const candidate = execute(source);
    expect(exact.observation).toEqual(reference.observation);
    expect(candidate.observation).toEqual(reference.observation);
    return candidate;
}

describe('array lengths in compiled loop bounds', () => {
    it('compiles nested indexed scans with early termination as one region', () => {
        const primes = [2, 3, 5, 7, 11, 13, 17, 19];
        let expected = 0;
        for (let i = 0; i < primes.length; i++) {
            if (primes[i] * primes[i] > 40) break;
            for (let j = i + 1; j < primes.length; j++) {
                if (primes[i] * primes[j] > 40) break;
                expected += primes[i] * primes[j];
            }
        }
        const result = compare(`Ps = array ${primes.join(' ')}
Sum = 0
for I in 0 till (Ps len)
 P = Ps I
 if P * P greater 40
  break
 end
 for J in (I + 1) till (Ps len)
  Q = Ps J
  if P * Q greater 40
   break
  end
  Sum += P * Q
 end
end`);
        expect(result.observation.variables).toContainEqual(['Sum', String(expected)]);
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.fallbacks['loop:unstable-bindings:ForStatement']).toBeUndefined();
    });

    it('recognizes stored integers even without a semantic array type', () => {
        const result = compare(`use sequences
fun Limit countprimes
 Ps = primes till Limit array
 Count = 0
 for I in 0 till (Ps len)
  if I greater 2
   break
  end
  Count += 1
 end
 return Count
end
Count = 10000000 countprimes`);
        expect(result.observation.variables).toContainEqual(['Count', '3']);
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('does not depend on text compilation for array lengths', () => {
        const source = 'A = array 2 3 5\nSum = 0\nfor I in 0 till (A len)\n Sum += A I\nend';
        const result = execute(source, { scalarTextCompilation: false });
        expect(result.observation).toEqual(execute(source, { compilation: false }).observation);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('replays an overflowing length-bounded region without publishing private writes', () => {
        const result = compare('A = array 2 3 5\nSum = 9007199254740990\nfor I in 0 till (A len)\n Sum += A I\nend');
        expect(result.observation.variables).toContainEqual(['Sum', '9007199254741000']);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each([
        ['array 2 3 5 7', '17'],
        ['array shape 0 fill 0', '0'],
        ['array 9007199254740992 3', '9007199254740995'],
    ])('preserves indexed sum and empty-loop state for %s', (array, expected) => {
        const result = compare(`A = ${array}\nSum = 0\nfor I in 0 till (A len)\n Sum += A I\nend`);
        expect(result.observation.variables).toContainEqual(['Sum', expected]);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it.each([
        ['array shape 2 3 fill 0', '2'],
        ['array shape 0 3 fill 0', '0'],
        ['array "a" "b"', '2'],
        ['array true false', '2'],
        ['array 1.0 2.0', '2'],
    ])('uses the first dimension of %s', (array, expected) => {
        const result = compare(`A = ${array}\nSum = 0\nfor I in 0 till (A len)\n Sum += 1\nend`);
        expect(result.observation.variables).toContainEqual(['Sum', expected]);
        expect(result.diagnostics.compiledLoops).toBe(1);
    });

    it.each([
        'A = array 2 3 5\nSum = 0\nfor I in 0 till (A len)\n Sum += 1\n A = array 7\nend',
        'A = array 2 3 5\nSum = 9007199254740990\nfor I in 0 till (A len)\n Sum += A I\nend',
        'A = array 2 3 5\nSum = 0\nfor I in 0 to (A len)\n Sum += A I\nend',
    ])('preserves rebinding, exact overflow and partial state: %s', source => {
        expect(compare(source).observation).toEqual(execute(source, { compilation: false }).observation);
    });

    it('rechecks array shape, element types and len identity on a cached loop', () => {
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
            const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
            try {
                runtime.execute(`fun A count
 Sum = 0
 for I in 0 till (A len)
  Sum += 1
 end
 return Sum
end`);
                expect(runtime.execute('(array 2 3) count')).toBe(2n);
                expect(runtime.execute('(array 2 3 5 7) count')).toBe(4n);
                expect(runtime.execute('(array "a" "b" "c") count')).toBe(3n);
                expect(runtime.execute('(array shape 2 3 fill 0) count')).toBe(2n);
                runtime.execute('fun A replacement\n return 1\nend');
                runtime.variables.set('len', runtime.variables.get('replacement')!);
                expect(runtime.execute('(array 2 3 5) count')).toBe(1n);
            } finally { runtime.dispose(); }
        }
    });
});
