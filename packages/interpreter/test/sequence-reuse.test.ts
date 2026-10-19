import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, pureHostFunction } from '../src/index.js';

const prelude = `use sequences
fun X odd = X mod 2 equal 1
`;

for (const compilation of [false, true]) describe(`sequence reuse (compiled=${compilation})`, () => {
    function run(source: string, options = {}) {
        const runtime = new Interpreter(() => {}, { compilation, ...options });
        const stats = new RuntimeDiagnostics();
        try {
            const result = stats.run(() => runtime.execute(source));
            return { result, stats };
        } finally { runtime.dispose(); }
    }

    it('retains the reused filtered result and leaves its one-consumer input streaming', () => {
        const { result, stats } = run(prelude + `Candidates = 1 to 100
Solutions = Candidates filter odd
A = Solutions len
B = Solutions sum
A equal 50 and B equal 2500`);
        expect(result).toBe(true);
        expect(stats.sequenceCachedValues).toBe(50);
        expect(stats.sequenceReplayHits).toBe(50);
    });

    it('retains pure composed callbacks', () => {
        const { result, stats } = run(`use numbers
use sequences
divisor_count = divisors count
S = (1 to 6) divisor_count rank 0
A = S sum
B = S sum
A + B`);
        expect(result).toBe(28n);
        expect(stats.sequenceCachedValues).toBe(6);
    });

    it('snapshots fixed array configuration of ranked callbacks', () => {
        const { result, stats } = run(`use sequences
fun X scale .by Factors = X * (Factors 0)
Factors = array 2 3
S = (1 to 3) scale by Factors rank 0
Factors 0 = 10
A = S sum
B = S sum
A + B`);
        expect(result).toBe(24n);
        expect(stats.sequenceCachedValues).toBe(3);
    });

    it('freezes composed callback identities before later rebinding', () => {
        const { result } = run(`use numbers
use sequences
fun X double = X * 2
step = double
pipeline = step abs
S = (1 to 3) pipeline rank 0
fun X triple = X * 3
step = triple
S sum`);
        expect(result).toBe(12n);
    });

    it('rejects effects hidden in composed callbacks', () => {
        expect(() => run(`use io
use numbers
use sequences
pipeline = print abs
S = (1 to 3) pipeline rank 0`)).toThrow(/must be pure/);
    });

    it('keeps a single consumer uncached', () => {
        const { result, stats } = run(prelude + 'S = 1 to 100 filter odd\nS sum');
        expect(result).toBe(2500n);
        expect(stats.sequenceCachedValues).toBe(0);
    });

    it('keeps a fresh single-consumer pipeline streaming in each iteration', () => {
        const { result, stats } = run(prelude + `Total = 0
for I in 1 to 2
  S = 1 to 100 filter odd
  Total += S sum
end
Total`);
        expect(result).toBe(5000n);
        expect(stats.sequenceCachedValues).toBe(0);
    });

    it('retains an outer value consumed through loop-local aliases', () => {
        const { result, stats } = run(prelude + `S = 1 to 100 filter odd
Total = 0
for I in 1 to 2
  Alias = S
  Total += Alias sum
end
Total`);
        expect(result).toBe(5000n);
        expect(stats.sequenceCachedValues).toBe(50);
        expect(stats.sequenceReplayHits).toBe(50);
    });

    it('follows aliases before the first consuming traversal', () => {
        const { result, stats } = run(prelude + `S = 1 to 100 filter odd
Alias = S
A = S len
B = Alias sum
A equal 50 and B equal 2500`);
        expect(result).toBe(true);
        expect(stats.sequenceCachedValues).toBe(50);
        expect(stats.sequenceReplayHits).toBe(50);
    });

    it('follows repeated consumption through ordinary helper parameters', () => {
        const { result, stats } = run(prelude + `fun Values consume = (Values len) + (Values sum)
fun Input forward = Input consume
S = 1 to 100 filter odd
S forward`);
        expect(result).toBe(2550n);
        expect(stats.sequenceCachedValues).toBe(50);
        expect(stats.sequenceReplayHits).toBe(50);
    });

    it('retains a returned pure result at its consuming caller', () => {
        const { result, stats } = run(prelude + `fun N selected
  Result = 1 to N filter odd
  return Result
end
S = 100 selected
A = S len
S sum`);
        expect(result).toBe(2500n);
        expect(stats.sequenceCachedValues).toBe(50);
        expect(stats.sequenceReplayHits).toBe(50);
    });

    it('protects retained array values when a reader writes its own result', () => {
        const { result, stats } = run(`use algo
use sequences
fun Q accepted = true
S = (array 1 2) permutations filter accepted
A = S first
A 0 = 9
B = S first
B 0`);
        expect(result).toBe(1n);
        expect(stats.sequenceCachedValues).toBe(1);
    });

    it('permits local array work in a predicate without changing yielded values', () => {
        const { result, stats } = run(`use algo
use sequences
fun Q accepted
  Work = Q copy
  Work 0 = 9
  return Work 0 equal 9
end
S = (array 1 2) permutations filter accepted
A = S len
B = S first
B 0`);
        expect(result).toBe(1n);
        expect(stats.sequenceCachedValues).toBe(2);
    });

    it('permits a mutating helper when only a local working copy reaches it', () => {
        const { result } = run(`use algo
use sequences
fun Work change
  Work 0 = 9
  return true
end
fun Q accepted
  Work = Q copy
  return Work change
end
S = (array 1 2) permutations filter accepted
A = S len
B = S first
B 0`);
        expect(result).toBe(1n);
    });

    it('rejects mutation through a callback parameter and an alias', () => {
        expect(() => run(`use algo
use sequences
fun Items change
  Items 0 = 9
  return true
end
fun Q accepted
  Alias = Q
  return Alias change
end
S = (array 1 2) permutations filter accepted`)).toThrow('lazy callback accepted must be pure');
    });

    it('does not confuse a function parameter with a same-spelled global', () => {
        const { result, stats } = run(prelude + `S = 1 to 100 filter odd
fun S twice = S + S
A = 2 twice
S sum`);
        expect(result).toBe(2500n);
        expect(stats.sequenceCachedValues).toBe(0);
    });

    it('can disable retention for differential measurements', () => {
        const { result, stats } = run(prelude + 'S = 1 to 100 filter odd\nA = S len\nS sum', { sequenceReuse: false });
        expect(result).toBe(2500n);
        expect(stats.sequenceCachedValues).toBe(0);
    });

    it('retains a pure mapped sequence and resumes it after a prefix', () => {
        const { result, stats } = run(`use numbers
use sequences
fun X doubled = X * 2
S = (1 to 10) doubled rank 0
A = (S take 3) sum
B = S sum
A equal 12 and B equal 110`);
        expect(result).toBe(true);
        expect(stats.sequenceCachedValues).toBe(10);
        expect(stats.sequenceReplayHits).toBe(3);
    });

    it('retains a pure scan', () => {
        const { result, stats } = run(`use sequences
S = 1 to 4 scan +
A = S sum
B = S sum
A equal 20 and B equal 20`);
        expect(result).toBe(true);
        expect(stats.sequenceCachedValues).toBe(4);
        expect(stats.sequenceReplayHits).toBe(4);
    });

    it('does not retain direct ranges just because they are reused', () => {
        const { result, stats } = run('S = 1 to 10\nA = S sum\nB = S sum\nA equal B');
        expect(result).toBe(true);
        expect(stats.sequenceCachedValues).toBe(0);
    });

    it('preserves positional mask identity when its plan is retained', () => {
        const { result, stats } = run(`use sequences
A = 1 to 10
B = 11 to 20
Mask = (A less 5) or (B greater 18)
C = Mask count
D = A Mask sum
C equal 6 and D equal 29`);
        expect(result).toBe(true);
        expect(stats.sequenceCachedValues).toBe(10);
    });

    it.each(['X print', '(array X X) shuffle'])('rejects transitive effects in lazy predicates: %s', body => {
        expect(() => run(`use sequences
use io
use random
fun X helper
  ${body}
  return true
end
fun X predicate = X helper
S = 1 to 3 filter predicate`)).toThrow('lazy callback predicate must be pure');
    });

    it('requires the host purity contract for an overridden builtin', () => {
        const source = `use sequences
use crypto
fun X accepted = (X text md5 len) equal 16
S = 1 to 3 filter accepted
A = S len
S sum`;
        let calls = 0;
        const md5 = () => { calls++; return new Uint8Array(16); };
        expect(() => run(source, { md5 })).toThrow('lazy callback accepted must be pure');
        expect(calls).toBe(0);
        expect(run(source, { md5: pureHostFunction(md5) }).result).toBe(6n);
        expect(calls).toBe(3);
    });

    it('recomputes an uncached value in a later REPL command', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const stats = new RuntimeDiagnostics();
        try {
            expect(stats.run(() => runtime.execute(prelude + 'S = 1 to 100 filter odd\nS len'))).toBe(50n);
            expect(stats.run(() => runtime.execute('S sum'))).toBe(2500n);
            expect(stats.sequenceCachedValues).toBe(0);
        } finally { runtime.dispose(); }
    });

    it('rejects effectful lazy predicates before running their effects', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        const stats = new RuntimeDiagnostics();
        try {
            expect(() => stats.run(() => runtime.execute(`use sequences
use io
fun X visible
  X print
  return true
end
S = 1 to 3 filter visible
A = S len
B = S sum`))).toThrow('lazy callback visible must be pure');
            expect(output).toEqual([]);
            expect(stats.sequenceCachedValues).toBe(0);
        } finally { runtime.dispose(); }
    });
});
