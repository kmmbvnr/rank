import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, isRankArray, pureHostFunction } from '../src/index.js';

function run(source: string, nativeLoopCompilation: boolean, typedNativeCalls = true) {
    let loops = 0;
    const runtime = new Interpreter(undefined, {
        nativeLoopCompilation, typedNativeCalls, onIntegerLoopExecuted: () => loops++,
    });
    try {
        let result: string | undefined, error: string | undefined;
        try {
            const value = runtime.execute(source);
            result = value === undefined ? undefined : formatValue(value);
        }
        catch (caught) { error = caught instanceof RankError ? caught.format() : String(caught); }
        const values = [...runtime.variables].filter(([, value]) => typeof value !== 'object' || isRankArray(value))
            .map(([name, value]) => [name, formatValue(value)]);
        return { result, error, values, loops };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = run(source, false), compiled = run(source, true);
    expect(run(source, true, false)).toEqual(compiled);
    expect({ ...compiled, loops: 0 }).toEqual({ ...reference, loops: 0 });
    return compiled;
}

describe('guarded native loop calls', () => {
    it.each([
        'use text\nInput = "ABC"\nTotal = 0\nfor I in 1 to 3\n if Input equal ("abc" + "")\n  Total += 1\n end\nend\nTotal',
        'Total = 0\nfor I in 1 to 3\n Total += ("ёж" bytes) len\nend\nTotal',
    ])('uses shared expression facts to choose guarded specializations: %s', source => {
        expect(compare(source).loops).toBeGreaterThan(0);
    });

    it('rechecks shared type hints when a function is called with another type', () => {
        const result = compare('fun check X\n Total = 0\n for I in 1 to 2\n'
            + '  if X equal ("abc" + "")\n   Total += 1\n  end\n end\n return Total\nend\n'
            + 'array ("abc" check) (42 check) ("abc" check)');
        expect(result.result).toBe('2 0 2');
        expect(result.loops).toBeGreaterThan(0);
    });

    it.each([
        `S = "a😀ёж"\nOut = ""\nfor I in 0 until 4\n Out += S I\nend\nOut`,
        `S = "😀"\nOut = ""\nfor I in 0 to 1\n Out += S I\nend`,
        `S = "😀"\nfor I in -1 to 0\n Out = S I\nend`,
        `S = "😀"\nfor I in 9007199254740993 to 9007199254740994\n Out = S I\nend`,
        `use text\nA = array "a" "b"\nB = A\nfor I in 0 until 2\n A I = "😀"\nend\narray (A "" join) (B "" join)`,
        `use text\nS = ""\nfor I in 0 until 2\n A = array shape 2 fill "ё"\n A I = "😀"\n S = A ":" join\nend\nS`,
        `use text\nS = ""\nfor I in 0 until 2\n A = array shape 2 fill "a"\n B = A\n S = B "" join\nend\nS`,
        `use text\nA = array "a" "b"\nOut = ""\nfor I in 0 to 2\n Out += A I\nend`,
        `use text\nA = array "a" "b"\nfor I in 0 to 2\n A I = "😀"\nend`,
        `use text\nA = array "a" "b"\nS = ""\nfor I in 0 until 2\n S += A "" join\n A I = "x"\n S += A "" join\nend\nS`,
    ])('compiles text storage with matching state and errors: %s', source => {
        expect(compare(source).loops).toBeGreaterThan(0);
    });

    it('trusts only the exact host function, not a wrapper around it', () => {
        const implementation = pureHostFunction((_value: string | Uint8Array) => new Uint8Array(16));
        for (const md5 of [implementation, (value: string | Uint8Array) => implementation(value)]) {
            let loops = 0;
            const runtime = new Interpreter(undefined, { md5, onIntegerLoopExecuted: () => loops++ });
            try {
                expect(runtime.execute('use crypto\nH = "" bytes\nfor I in 1 to 2\n H = "abc" md5\nend\nH 0')).toBe(0n);
                expect(loops).toBe(md5 === implementation ? 1 : 0);
            } finally { runtime.dispose(); }
        }
    });

    it('preserves partial state and diagnostics when a trusted host throws', () => {
        const results = [];
        for (const pure of [false, true]) {
            let loops = 0;
            const digest = (value: string | Uint8Array) => {
                if (value === '2') throw new RankError('host digest failed');
                return new Uint8Array(16);
            };
            const runtime = new Interpreter(undefined, {
                md5: pure ? pureHostFunction(digest) : digest,
                onIntegerLoopExecuted: () => loops++,
            });
            try {
                let message;
                try {
                    runtime.execute('use crypto\nTotal = 0\nfor I in 1 to 3\n Total += 1\n H = (I text) md5\nend');
                } catch (error) { message = (error as RankError).format(); }
                expect(message).toContain('host digest failed');
                expect(loops).toBe(pure ? 1 : 0);
                results.push([message, runtime.variables.get('Total'), runtime.variables.get('I')]);
                expect(runtime.execute('7')).toBe(7n);
            } finally { runtime.dispose(); }
        }
        expect(results[1]).toEqual(results[0]);
    });

    it.each([
        ['text prefix and integer formatting', `use text
Total = 0
for I in 0 until 100
  S = "item" + (I text)
  if S "item1" startswith
    continue
  end
  Total += S len
end
Total`],
        ['Unicode text builtins', `use text
Total = 0
for I in 1040 to 1045
  S = (I character) lower
  Total += S codepoint
end
Total`],
        ['byte locals, aliases, length and indexing', `use text
Total = 0
for I in 1 to 5
  B = "ёж" bytes
  C = B
  if C ("ё" bytes) startswith
    Total += C 0
  end
  Total += B len
end
Total`],
        ['external bytes', `use text
B = "ёж" bytes
P = "ё" bytes
Total = 0
for I in 1 to 5
  if B P startswith
    Total += B 1
  end
end
Total`],
        ['portable hash and byte prefix', `use crypto
use text
Prefix = "" bytes
Total = 0
for I in 0 until 100
  H = ("abc" + (I text)) md5
  if not (H Prefix startswith)
    continue
  end
  if H 2 less 16
    Total += 1
  end
end
Total`],
        ['nested byte conversion and hash calls', `use crypto
Total = 0
for I in 1 to 3
  H = (("abc" bytes) md5) md5
  Total += H 0
end
Total`],
        ['partial writes and builtin errors', `use text
Total = 0
for I in 0 to 2
  Total += 1
  S = (I - 1) character
end`],
        ['byte bounds diagnostics', `Total = 0
for I in 0 to 3
  B = "x" bytes
  Total += 1
  X = B I
end`],
        ['negative byte index diagnostics', `for I in 1 to 2
  B = "x" bytes
  X = B (-1)
end`],
    ])('%s', (_name, source) => {
        expect(compare(source).loops).toBeGreaterThan(0);
    });

    it('guards rebound builtins on each invocation of a cached loop', () => {
        let loops = 0;
        const runtime = new Interpreter(undefined, { onIntegerLoopExecuted: () => loops++ });
        try {
            runtime.execute(`use text
fun work
  Total = 0
  for I in 1 to 3
    if "abc" "a" startswith
      Total += 1
    end
  end
  return Total
end`);
            expect(runtime.execute('work')).toBe(3n);
            expect(loops).toBe(1);
            runtime.execute('fun startswith A B\n return false\nend');
            expect(runtime.execute('work')).toBe(0n);
            expect(loops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('guards changing text/byte inputs without replaying a body', () => {
        let loops = 0;
        const runtime = new Interpreter(undefined, { onIntegerLoopExecuted: () => loops++ });
        try {
            runtime.execute(`use text
fun work S P
  Total = 0
  for I in 1 to 3
    if S P startswith
      Total += 1
    end
  end
  return Total
end`);
            expect(runtime.execute('"abc" "a" work')).toBe(3n);
            expect(loops).toBe(1);
            expect(runtime.execute('("abc" bytes) ("a" bytes) work')).toBe(3n);
            expect(loops).toBe(1);
            expect(runtime.execute('"abc" "z" work')).toBe(0n);
            expect(loops).toBe(2);
        } finally { runtime.dispose(); }
    });

    it.each([
        `use text\nA = array "a" 1\nfor I in 0 until 2\n S = A "" join\nend\nS`,
        `use text\nA = array shape 2 2 fill "a"\nfor I in 0 until 2\n S = A "" join\nend\nS`,
        `use text\nfor I in 0 until 2\n A = array shape 2 fill "a"\n B = A\n A 0 = "😀"\n S = B "" join\nend\nS`,
        `use text\nfor I in 0 until 2\n A = array shape 2 fill "a"\n B = A\n B 0 = "😀"\n S = A "" join\nend\nS`,
        `use text\nfor I in 1 to 2\n fun startswith A B\n  return false\n end\n B = "x" "x" startswith\nend\nB`,
        `use text\nfor I in 1 to 2\n B = (array "a" "b") "a" startswith\nend\nB`,
        `for I in 1 to 2\n B = "x" bytes\n B 0 = 120\nend\nB`,
        `for I in 1 to 2\n B = "x" bytes\n A = array shape 2 fill B\nend\nA`,
        `for I in 1 to 2\n B = "abc" "a" startswith\nend`,
    ])('retains the fallback for unsupported input or effects: %s', source => {
        expect(compare(source).loops).toBe(0);
    });

    it('does not assume host MD5 callbacks are pure', () => {
        let loops = 0, calls = 0;
        const runtime = new Interpreter(undefined, {
            onIntegerLoopExecuted: () => loops++,
            md5: () => {
                calls++;
                runtime.variables.set('Total', 100n);
                return new Uint8Array(16);
            },
        });
        try {
            expect(runtime.execute(`use crypto
Total = 0
for I in 1 to 3
  H = "abc" md5
  Total += 1
end
Total`)).toBe(101n);
            expect(calls).toBe(3);
            expect(loops).toBe(0);
        } finally { runtime.dispose(); }
    });
});
