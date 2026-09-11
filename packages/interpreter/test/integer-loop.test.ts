import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function execute(source: string, integerLoopCompilation: boolean) {
    let loops = 0;
    const runtime = new Interpreter(undefined, { integerLoopCompilation,
        onIntegerLoopExecuted: () => loops++ });
    try {
        const value = runtime.execute(source);
        return { value: value === undefined ? undefined : formatValue(value), loops,
            variables: [...runtime.variables].filter(([, v]) => typeof v !== 'object').map(([k, v]) => [k, formatValue(v)]) };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), loops,
            variables: [...runtime.variables].filter(([, v]) => typeof v !== 'object').map(([k, v]) => [k, formatValue(v)]) };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = execute(source, false), compiled = execute(source, true);
    expect({ ...compiled, loops: 0 }).toEqual({ ...reference, loops: 0 });
    return compiled;
}

describe('whole integer loops', () => {
    it('keeps arithmetic in registers while writing final observable state', () => {
        const result = compare(`I = 0
Total = 0
for I less 1000
  I += 1
  Total += I
end
Total
`);
        expect(result.value).toBe('500500');
        expect(result.loops).toBe(1);
    });

    it.each(['-7', '7'])('preserves signed division and modulo for %s', value => {
        const result = compare(`I = 0
A = ${value}
B = 0
for I less 4
  B = A // -3
  A %= -3
  I += 1
end
array A B I
`);
        expect(result.loops).toBe(1);
    });

    it.each([
        'I = 0\nDone = 0\nfor I less 3\n  I += 1\n  Done = I\n  Bad = 7 // (I - 1)\nend',
        'I = 0\nReal = 1.0\nfor I less 3\n  I += 1\n  Real = I + 1\nend',
        'I = 0\nfor I // 0 less 2\n  I += 1\nend',
    ])('preserves partial writes and exact diagnostics', source => {
        const result = compare(source);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('declines noninteger inputs without executing or replaying the body', () => {
        expect(compare('I = 0.0\nfor I less 3.0\n  I += 1.0\nend\nI').loops).toBe(0);
        expect(compare('I = 0\nfor I less 0\n  I += Missing\nend\nI').value).toBe('0');
    });

    it('binds fresh function inputs on every invocation', () => {
        const result = compare(`fun sum N
  I = 0
  Total = 0
  for I less N
    I += 1
    Total += I
  end
  return Total
end
A = 3 sum
B = 5 sum
array A B
`);
        expect(result.value).toBe('6 15');
        expect(result.loops).toBe(2);
    });

    it('does not reinterpret modifier spellings as integer variables', () => {
        const result = compare('I = 0\nA = 1\nscan = 2\nfor I less 1\n  X = A + scan\n  I += 1\nend\nX');
        expect(result.loops).toBe(0);
        expect(result).toHaveProperty('error');
    });

    it('falls back under CSP', () => {
        const spy = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw new Error('CSP'); });
        try {
            const result = execute('I = 0\nfor I less 3\n  I += 1\nend\nI', true);
            expect(result.loops).toBe(0);
            expect(result.value).toBe('3');
        } finally { spy.mockRestore(); }
    });
});


describe('compiled numeric range loops', () => {
    it.each(['1 to 5', '1 until 5', '5 to 1 by -2', '5 until 1 by -2',
        '5 to 1', '1 to 5 by -1', '3 until 3', '3 to 3'])('preserves %s', range => {
        const result = compare(`use ranges
Total = 0
for Value i in ${range}
  Total += Value + i
end
Total
`);
        expect(result.loops).toBe(1);
    });

    it('evaluates bounds once and keeps progression independent of bindings', () => {
        const result = compare(`use ranges
N = 3
Step = 1
Count = 0
for I in 0 until N by Step
  N = 0
  Step = 10
  I += 100
  Count += 1
end
array I Count N Step
`);
        expect(result.value).toBe('102 3 0 10');
        expect(result.loops).toBe(1);
    });

    it.each(['# i', 'Value #', '# #'])('supports discarded bindings: %s', bindings => {
        const result = compare(`use ranges
Count = 0
for ${bindings} in 1 to 3
  Count += 1
end
Count
`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it.each([
        'use ranges\nI = "text"\nfor I in 1 to 2\n  X = I + 1\nend',
        'use ranges\nfor I in 1 to 0 by 0\n  X = I + 1\nend',
        'for I in 1 to 2\n  X = I + 1\nend',
        'for I in 1 // 0 to 2\n  X = I + 1\nend',
        'use ranges\nfor I j k in 1 to 2\n  X = I + 1\nend',
    ])('preserves binding, module and range errors', source => {
        expect(compare(source)).toHaveProperty('error');
    });
});


describe('compiled integer powers', () => {
    it.each([
        ['-I ** 2', '-9'], ['(-I) ** 2', '9'],
        ['+I ** 2', '9'], ['I ** (0)', '1'],
        ['I ** 40', '12157665459056928801'],
        ['I ** 2 ** 3', '6561'],
    ])('preserves precedence and exact integers: %s', (expression, expected) => {
        const result = compare(`use ranges
Total = 0
for I in 3 to 3
  Total = ${expression}
end
Total`);
        expect(result.value).toBe(expected);
        // A computed exponent remains on the reference path.
        expect(result.loops).toBe(expression === 'I ** 2 ** 3' ? 0 : 1);
    });

    it.each(['I ** -1', 'I ** N', 'I ** 0.5'])('declines %s before execution', expression => {
        const result = compare(`use ranges
N = 2
for I in 1 to 3
  Answer = ${expression}
end
Answer`);
        expect(result.loops).toBe(0);
    });

    it('preserves partial writes and fixed-type errors', () => {
        const result = compare(`use ranges
Answer = 0.0
Done = 0
for I in 1 to 3
  Done = I ** 2
  Answer = I ** 2
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });
});


describe('compiled loop branches', () => {
    it('executes branching conditional loops', () => {
        const result = compare(`N = 27
Steps = 0
for N greater 1
  if N % 2 equal 0
    N //= 2
  else
    N = 3 * N + 1
  end
  Steps += 1
end
Steps`);
        expect(result.value).toBe('111');
        expect(result.loops).toBe(1);
    });

    it('merges definite assignments across if, elif and else', () => {
        const result = compare(`use ranges
Total = 0
for I in 0 to 5
  if I less 2
    Value = 10
  elif I less 4
    Value = 20
  else
    Value = 30
  end
  Total += Value
end
Total`);
        expect(result.value).toBe('120');
        expect(result.loops).toBe(1);
    });

    it('preserves values assigned only on some iterations', () => {
        const result = compare(`use ranges
Value = 1
Total = 0
for I in 0 to 5
  if I % 2 equal 0
    Value = I
  end
  Total += Value
end
Total`);
        expect(result.value).toBe('12');
        expect(result.loops).toBe(1);
    });

    it('keeps unselected conditions and bodies unevaluated', () => {
        const result = compare(`use ranges
Total = 0
for I in 1 to 3
  if I greater 0
    if I less 3
      Total += I
    else
      Total += 10
    end
  elif 1 // 0 equal 0
    Total = 1 // 0
  end
end
Total`);
        expect(result.value).toBe('13');
        expect(result.loops).toBe(1);
    });

    it.each([
        'if I equal 2\n    Done = I\n    X = 1 // 0\n  end',
        'if I less 0\n    Done = I\n  elif 1 // (I - 2) equal 0\n    Done = 4\n  end',
        'if I greater 0\n    Done = I\n    Real = I\n  end',
    ])('preserves nested error locations and partial state', branch => {
        const result = compare(`use ranges
Done = 0
Real = 0.0
for I in 1 to 3
  ${branch}
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('declines a potentially missing input before any writes', () => {
        const result = compare(`use ranges
Total = 0
for I in 1 to 2
  if I equal 2
    Value = I
  end
  Total += Value
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });

    it.each(['if false\n  X = 1\nend', 'if true\nend'])('preserves empty branch results', branch => {
        expect(compare(`use ranges
for I in 1 to 2
  ${branch}
end`).loops).toBe(1);
    });
});
