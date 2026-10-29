import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';

function execute(source: string, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const actual = execute(source);
    expect(actual.observation).toEqual(execute(source, false).observation);
    return actual;
}

describe('exact integer consumers inside Number loops', () => {
    it('uses exact setup and predicates around numeric array writes', () => {
        const { diagnostics, observation } = compare(`use bits
N = 1000000000000000000
A = array 0 0
Alias = A
for B in (N binary len - 2) to 0 by -1
 A 0 += 1
 if N bit B
  A 1 += 1
 end
end`);
        expect(observation.error).toBeUndefined();
        expect(diagnostics.mixedIntegerLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    });

    it('retains exact loop-carried assignments and computed predicate operands', () => {
        const { diagnostics } = compare(`use bits
N = 1000000000000000000
A = array 0 0
for I in 0 to 3
 N += I
 if (N + 1) bit (I + 1)
  A 0 += 1
 else
  A 1 += 1
 end
end`);
        expect(diagnostics.mixedIntegerLoops).toBe(1);
    });

    it('preserves numeric requirements from another use of a wide operand', () => {
        const { diagnostics, observation } = compare(`use bits
N = 1000000000000000000
A = array 0 0
for I in 0 to 3
 if N bit I
  A 0 += 1
 end
 A 1 += N
end`);
        expect(observation.error).toBeUndefined();
        expect(diagnostics.mixedIntegerLoops).toBe(0);
    });

    it('discards the mixed attempt on a later numeric overflow', () => {
        const { diagnostics, observation } = compare(`use bits
N = 1000000000000000000
A = array 0 0
Alias = A
for I in 0 to 2
 if N bit I
  A 0 += 1
 end
 A 1 += 9007199254740991
end`);
        expect(observation.error).toBeUndefined();
        expect(diagnostics.mixedIntegerLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(1);
    });

    it.each(['-1 bit I', 'N bit -1', 'N bit (I - 1)'])('publishes only preceding writes when %s fails', predicate => {
        const { observation } = compare(`use bits
N = 1000000000000000000
A = array 0 0
Alias = A
for I in 0 to 2
 A 0 += 1
 if ${predicate}
  A 1 += 1
 end
end`);
        expect(observation.error).toBeDefined();
    });

    it('does not evaluate an unused exact predicate', () => {
        const { observation } = compare(`use bits
N = 1000000000000000000
A = array 0
for I in 0 to 2
 if false
  Bad = N bit -1
 end
 A 0 += 1
end`);
        expect(observation.error).toBeUndefined();
    });

    it('keeps Unicode code-point lengths and zero-trip setup errors', () => {
        expect(compare('A = array 0\nfor I in 0 till ("a😀" len)\n A 0 += 1\nend').observation.error).toBeUndefined();
        expect(compare('use bits\nN = -1\nA = array 0\nfor I in (N binary len) till 0\n A 0 += 1\nend').observation.error).toBeDefined();
    });

    it.each(['bit', 'binary'])('rechecks a replaced %s native on cached loop entry', name => {
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, { compilation, scalarEntryCompilation: false });
            try {
                runtime.execute(`use bits
fun score N
 A = array 0
 for I in 0 till (N binary len)
  if N bit I
   A 0 += 1
  end
 end
 return A 0
end`);
                expect(runtime.execute('score 1000000000000000007')).toBe(27n);
                runtime.variables.set(name, { kind: 'function', name, arities: [name === 'bit' ? 2 : 1],
                    monadicRank: 0, call: () => name === 'bit' ? false : '😀' });
                expect(runtime.execute('score 1000000000000000007')).toBe(name === 'bit' ? 0n : 1n);
            } finally { runtime.dispose(); }
        }
    });
});
