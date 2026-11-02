import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, isNativeFunction } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';

function observe(source: string, mode: 'reference' | 'exact' | 'number', setup?: (runtime: Interpreter) => void) {
    const diagnostics = new RuntimeDiagnostics();
    let calls = 0;
    const runtime = new Interpreter(() => {}, {
        compilation: mode !== 'reference', numberLoopCompilation: mode !== 'exact',
        onScalarFunctionExecuted: () => calls++,
    });
    let error: string | undefined;
    try {
        try { setup?.(runtime); diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { error, values: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]), diagnostics, calls };
    } finally { runtime.dispose(); }
}
function compare(source: string, setup?: (runtime: Interpreter) => void) {
    const { diagnostics: _, calls: __, ...reference } = observe(source, 'reference', setup);
    return ['exact', 'number'].map(mode => {
        const { diagnostics, calls, ...actual } = observe(source, mode as 'exact' | 'number', setup);
        expect(actual).toEqual(reference);
        return { diagnostics, calls, ...actual };
    });
}

describe('compiled scalar choose', () => {
    it.each(['C choose A B', 'C A B choose'])('compiles %s in scalar functions', choice => {
        const result = compare(`fun C A B pick
  return ${choice}
end
A = true 9007199254740997 7 pick
B = false 1.5 2.5 pick
C = false true false pick
D = true "A😀" "B" pick`);
        for (const value of result) {
            expect(value.calls).toBe(4);
            expect(value.values).toContainEqual(['A', '9007199254740997']);
        }
    });

    it('retains eager cell reads in borrowed array arguments', () => {
        const source = `fun C pick Values
  return C choose (Values 0) (Values 2)
end
A = true pick Values
B = false pick Values`;
        const results = compare(source, runtime => {
            runtime.variables.set('Values', typedArray(new Int32Array([7, 8, 9]), [3]));
        });
        expect(results[1].diagnostics.numberFunctions).toBeGreaterThan(0);
        expect(results[1].diagnostics.numberFunctionArrayBorrows).toBeGreaterThan(0);
        const missing = compare(source, runtime => {
            runtime.variables.set('Values', typedArray(new Int32Array([7, 8]), [2]));
        });
        expect(missing[1].error).toContain('out of bounds');
    });

    it('keeps boolean locals scalar across branch and array stores', () => {
        const results = compare(`Values = array 7 3 8
Result = array 0 0 0
for I in 0 to 2
  C = I mod 2 equal 0
  if C
    V = C choose (Values I) 10
    if C
      Result I = V
    end
  else
    C = I less 0
    Result I = C choose 9 (Values I)
  end
end`);
        expect(results[0].diagnostics.compiledLoops).toBeGreaterThan(0);
        expect(results[1].diagnostics.numberLoops).toBeGreaterThan(0);
    });

    it.each(['true', 'false'])('evaluates both branches eagerly for %s', condition => {
        const results = compare(`fun C pick
  return C choose 11 (7 // 0)
end
Answer = ${condition} pick`);
        expect(results[0].error).toContain('division by zero');
    });

    it('retains the first branch error before the second', () => {
        const results = compare(`Values = array 1
for I in 0 to 2
  Answer = true choose (Values 2) (7 // 0)
end`);
        expect(results[0].error).toContain('out of bounds');
    });

    it('replays overflowing Number operands exactly', () => {
        const results = compare(`Answer = 0
for I in 0 to 2
  A = 9007199254740991 + I
  Answer = true choose A 7
end`);
        expect(results[1].values).toContainEqual(['Answer', '9007199254740993']);
    });

    it('leaves mixed and array domains to ordinary selection', () => {
        compare(`fun C pick A B
  return C choose A B
end
A = true pick 1 2.5
B = false pick (array 1 2) (array 3 4)
for I in 0 to 2
  C = I equal 0
  D = C choose (array 1 2) (array 3 4)
end`);
    });

    it.each(['replacement', 'mutated'])('guards %s native bindings after warmup', replacement => {
        let calls = 0;
        const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(`fun C pick
  return C 1 2 choose
end
true pick`);
            expect(calls).toBe(1);
            const choice = runtime.execute('choose');
            if (replacement === 'replacement') runtime.variables.set('choose', native('replacement', 3, () => 77n));
            else {
                if (!choice || !isNativeFunction(choice)) throw new Error('expected builtin');
                Object.defineProperty(choice, 'call', { value: () => 77n });
            }
            expect(runtime.execute('false pick')).toBe(77n);
            expect(calls).toBe(1);
            expect(runtime.execute(`Answer = 0
for I in 0 to 2
  Answer += true 1 2 choose
end
Answer`)).toBe(231n);
        } finally { runtime.dispose(); }
    });
});

describe('choose callback boundaries', () => {
    it('does not inline across a host callback that changes the builtin', () => {
        const observations = [false, true].map(compilation => {
            let choice: unknown;
            const runtime = new Interpreter(() => {}, { compilation, md5: () => {
                Object.defineProperty(choice, 'call', { value: () => 'changed' });
                return new Uint8Array(16);
            } });
            try {
                choice = runtime.execute('choose');
                return runtime.execute(`use crypto
fun C pick
  return C choose ("first" md5) ("second" md5)
end
true pick`);
            } finally { runtime.dispose(); }
        });
        expect(observations).toEqual(['changed', 'changed']);
    });
});
