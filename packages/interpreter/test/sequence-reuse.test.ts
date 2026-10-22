import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, pureHostFunction, isRankArray, isRankPlan } from '../src/index.js';

const prelude = `use sequences
fun X odd = X mod 2 equal 1
`;

describe.each([false, true])('explicit sequence reuse (compilation=%s)', compilation => {
    function run(source: string, options = {}) {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation, ...options });
        const stats = new RuntimeDiagnostics();
        try { return { result: stats.run(() => runtime.execute(source)), stats, output }; }
        finally { runtime.dispose(); }
    }

    it.each(['', "'"])('uses binding mode independently of later consumer count: %s', marker => {
        const runtime = new Interpreter(undefined, { compilation });
        const stats = new RuntimeDiagnostics();
        try {
            stats.run(() => runtime.execute(prelude + `S${marker} = 1 to 100 filter odd`));
            expect(stats.sequencePredicateCalls).toBe(marker ? 0 : 100);
            const value = runtime.variables.get('S')!;
            expect(isRankPlan(value)).toBe(Boolean(marker));
            expect(isRankArray(value)).toBe(!marker);
            expect(stats.run(() => runtime.execute('A = S len\nB = S sum\nA equal 50 and B equal 2500'))).toBe(true);
            expect(stats.sequencePredicateCalls).toBe(marker ? 200 : 100);
        } finally { runtime.dispose(); }
    });

    it.each(['', "'"])('preserves explicit reuse through aliases and loop-local names: %s', marker => {
        const { result, stats } = run(prelude + `S${marker} = 1 to 100 filter odd
Total = 0
for I in 1 to 2
 Alias' = S
 Total += Alias sum
end
Total`);
        expect(result).toBe(5000n);
        expect(stats.sequencePredicateCalls).toBe(marker ? 200 : 100);
    });

    it('computes each fresh ordinary loop binding once', () => {
        const { result, stats } = run(prelude + `Total = 0
for I in 1 to 2
 S = 1 to 100 filter odd
 Total += S sum
end
Total`);
        expect(result).toBe(5000n);
        expect(stats.sequencePredicateCalls).toBe(200);
    });

    it.each(['', "'"])('completes an ordinary helper argument and preserves a deferred one: %s', marker => {
        const { result, stats } = run(prelude + `fun Values${marker} consume = (Values len) + (Values sum)
fun Input' forward = Input consume
S' = 1 to 100 filter odd
S forward`);
        expect(result).toBe(2550n);
        expect(stats.sequencePredicateCalls).toBe(marker ? 200 : 100);
    });

    it.each(['', "'"])('applies caller binding mode to a returned plan: %s', marker => {
        const { result, stats } = run(prelude + `fun N selected
 Result' = 1 to N filter odd
 return Result
end
S${marker} = 100 selected
A = S len
S sum`);
        expect(result).toBe(2500n);
        expect(stats.sequencePredicateCalls).toBe(marker ? 200 : 100);
    });

    it.each(['', "'"])('keeps composed callbacks and explicit retention: %s', marker => {
        const { result } = run(`use numbers
use sequences
divisor_count = divisors count
S${marker} = (1 to 6) divisor_count rank 0
A = S sum
B = S sum
A + B`);
        expect(result).toBe(28n);
    });

    it('snapshots fixed array configuration before writes through a separate alias', () => {
        const { result } = run(`use sequences
fun X scale .by Factors = X * (Factors 0)
Factors = array 2 3
Writable = Factors
S' = (1 to 3) scale by Factors rank 0
Writable 0 = 10
A = S sum
B = S sum
A + B`);
        expect(result).toBe(24n);
    });

    it('keeps composed callback identities after rebinding their source name', () => {
        const { result } = run(`use numbers
use sequences
fun X double = X * 2
step = double
pipeline = step abs
S' = (1 to 3) pipeline rank 0
fun X triple = X * 3
step = triple
S sum`);
        expect(result).toBe(12n);
    });

    it.each(['', "'"])('permits effects in composed callbacks and repeats only deferred work: %s', marker => {
        const { result, output } = run(`use io
use numbers
use sequences
pipeline = print abs
S${marker} = (1 to 3) pipeline rank 0
A = S sum
B = S sum
A + B`);
        expect(result).toBe(12n);
        expect(output).toEqual(marker ? ['1', '2', '3', '1', '2', '3'] : ['1', '2', '3']);
    });

    it.each(['', "'"])('preserves yielded array values when a reader writes a result: %s', marker => {
        const { result } = run(`use algo
use sequences
fun Q accepted = true
S${marker} = (array 1 2) permutations filter accepted
A = S first
A 0 = 9
B = S first
B 0`);
        expect(result).toBe(1n);
    });

    it.each(['Work = Q copy', 'Work = Q'])('allows local array work in callbacks with value semantics: %s', binding => {
        const { result } = run(`use algo
use sequences
fun Items change
 Items 0 = 9
 return true
end
fun Q accepted
 ${binding}
 return Work change
end
S' = (array 1 2) permutations filter accepted
A = S len
B = S first
B 0`);
        expect(result).toBe(1n);
    });

    it('does not confuse a helper parameter with a same-spelled outer plan', () => {
        const { result, stats } = run(prelude + `S' = 1 to 100 filter odd
fun S twice = S + S
A = 2 twice
S sum`);
        expect(result).toBe(2500n);
        expect(stats.sequencePredicateCalls).toBe(100);
    });

    it('recomputes mapped prefixes without traversing the infinite tail', () => {
        const { result } = run(`use sequences
fun X doubled = X * 2
S' = (1 to #) doubled rank 0
A = (S take 3) sum
B = (S take 5) sum
A equal 12 and B equal 30`);
        expect(result).toBe(true);
    });

    it.each(['', "'"])('preserves scan results with either binding mode: %s', marker => {
        const { result } = run(`use sequences
S${marker} = 1 to 4 scan +
A = S sum
B = S sum
A equal 20 and B equal 20`);
        expect(result).toBe(true);
    });

    it('keeps a reusable arithmetic range consistent across two reductions', () => {
        expect(run("S' = 1 to 10\nA = S sum\nB = S sum\nA equal 55 and B equal 55").result).toBe(true);
    });

    it('preserves positional mask identity across repeated demands', () => {
        expect(run(`use sequences
A = 1 to 10
B = 11 to 20
Mask' = (A less 5) or (B greater 18)
C = Mask count
D = A Mask sum
C equal 6 and D equal 29`).result).toBe(true);
    });

    it.each([false, true])('allows a host callback whether or not it proves purity: %s', certified => {
        let calls = 0;
        const md5 = () => { calls++; return new Uint8Array(16); };
        expect(run(`use sequences
use crypto
fun X accepted = (X text md5 len) equal 16
S' = 1 to 3 filter accepted
A = S len
S sum`, { md5: certified ? pureHostFunction(md5) : md5 }).result).toBe(6n);
        expect(calls).toBe(6);
    });

    it.each(['', "'"])('preserves the same binding rule in later REPL commands: %s', marker => {
        const runtime = new Interpreter(undefined, { compilation });
        const stats = new RuntimeDiagnostics();
        try {
            expect(stats.run(() => runtime.execute(prelude + `S${marker} = 1 to 100 filter odd\nS len`))).toBe(50n);
            expect(stats.run(() => runtime.execute('S sum'))).toBe(2500n);
            expect(stats.sequencePredicateCalls).toBe(marker ? 200 : 100);
        } finally { runtime.dispose(); }
    });
});
