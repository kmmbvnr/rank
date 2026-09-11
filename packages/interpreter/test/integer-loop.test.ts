import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function execute(source: string, integerLoopCompilation: boolean, nestedLoopCompilation = true) {
    let loops = 0;
    const runtime = new Interpreter(undefined, { integerLoopCompilation, nestedLoopCompilation,
        onIntegerLoopExecuted: () => loops++ });
    const containers = () => [...runtime.variables].flatMap<unknown>(([name, value]) => {
        if (typeof value !== 'object' || value === null) return [];
        if (value.kind === 'queue') return [[name, value.items.map(formatValue)]];
        if (value.kind === 'index') return [[name, [...value.entries].map(([key, item]) => [key, formatValue(item)])]];
        return [];
    });
    try {
        const value = runtime.execute(source);
        return { value: value === undefined ? undefined : formatValue(value), loops, containers: containers(),
            variables: [...runtime.variables].filter(([, v]) => typeof v !== 'object').map(([k, v]) => [k, formatValue(v)]) };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), loops, containers: containers(),
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


describe('compiled container loops', () => {
    it.each(['stack', 'queue', 'deque'])('pushes and drains a %s through runtime methods', kind => {
        const result = compare(`use algo
use sequences
use ranges
P = new ${kind}
Cache = new index
for I in 1 to 5
  P push I
end
Total = 0
for P len greater 0
  V = P pop
  Total += V
  Cache V = Total
end
Total`);
        expect(result.value).toBe('15');
        expect(result.loops).toBe(2);
    });

    it('compiles the Collatz walk with membership and native predicates', () => {
        const result = compare(`use algo
use numbers
Cache = new index
Cache 1 = 1
Path = new stack
N = 27
for not (N in Cache)
  Path push N
  if N even
    N //= 2
  else
    N = 3 * N + 1
  end
end
N`);
        expect(result.value).toBe('1');
        expect(result.loops).toBe(1);
    });

    it('preserves mutation order for aliased containers', () => {
        const result = compare(`use algo
use sequences
use ranges
P = new stack
Q = P
Cache = new index
for I in 1 to 3
  P push I
  V = Q pop
  Cache I I = V
end
P len`);
        expect(result.value).toBe('0');
        expect(result.loops).toBe(1);
    });

    it('retains writes and removals preceding an error', () => {
        const result = compare(`use algo
use sequences
use ranges
P = new stack
P push 7
Cache = new index
for I in 1 to 2
  V = P pop
  Cache I = V
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('declines mixed deque values before destructive reads', () => {
        const result = compare(`use algo
use sequences
P = new stack
P push 1
P push "text"
for P len greater 0
  V = P pop
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });

    it.each(['even', 'len', 'pop'])('respects a user function shadowing %s', name => {
        const expr = name === 'even' ? 'N even' : 'P len greater 0';
        const body = name === 'pop' ? 'V = P pop' : 'N += 1';
        const result = compare(`use algo
use sequences
use numbers
fun ${name} X
  return 0
end
P = new stack
N = 0
for ${expr}
  ${body}
end`);
        expect(result.loops).toBe(0);
    });

    it('rejects a container binding assigned on just one branch', () => {
        const result = compare(`use algo
use ranges
P = new stack
for I in 1 to 2
  P push I
  if I equal 2
    P = 1
  end
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });
});


it('does not retain native bindings reassigned inside a compiled loop', () => {
    const result = compare(`use numbers
use ranges
Total = 0
for I in 1 to 2
  even = 1
  if I even
    Total += I
  end
end`);
    expect(result).toHaveProperty('error');
    expect(result.loops).toBe(0);
});


describe('compiled loop control', () => {
    it.each(['break', 'continue'])('retains the last completed body result on %s', operation => {
        const result = compare(`I = 0
for I less 3
  I += 1
  if I at least 2
    ${operation}
  end
  Value = 10
end`);
        expect(result.value).toBe('10');
        expect(result.loops).toBe(1);
    });

    it('supports a bare loop with no register variables', () => {
        const result = compare('for\n  break\nend');
        expect(result.value).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('merges only paths that reach the next statement', () => {
        const result = compare(`use ranges
Total = 0
for I in 1 to 5
  if I less 3
    continue
  elif I equal 5
    break
  else
    Value = I
  end
  Total += Value
end
Total`);
        expect(result.value).toBe('7');
        expect(result.loops).toBe(1);
    });

    it('does not prepare unreachable statements after unconditional control', () => {
        const result = compare(`for true
  if true
    break
  else
    continue
  end
  Unknown print
end`);
        expect(result.value).toBeUndefined();
        expect(result.loops).toBe(1);
    });

    it('keeps descending range progress and its index after continue', () => {
        const result = compare(`use ranges
Total = 0
for V i in 7 to 1 by -2
  if V equal 5
    V = 100
    continue
  end
  Total += V + i
end
Total`);
        expect(result.value).toBe('16');
        expect(result.loops).toBe(1);
    });

    it.each(['break', 'continue'])('preserves the ban on %s inside finally', operation => {
        const result = compare(`I = 0
try
  I = 1
finally
  for I less 3
    I += 1
    ${operation}
  end
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });

    it('reports condition errors at the loop after continue', () => {
        const result = compare(`I = 1
for 1 // (2 - I) greater 0
  I += 1
  continue
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });
});

it('keeps mutations preceding a compiled break', () => {
    const result = compare(`use algo
use ranges
use sequences
P = new stack
for I in 1 to 3
  P push I
  if I equal 2
    break
  end
end
P len`);
    expect(result.value).toBe('2');
    expect(result.loops).toBe(1);
});

it('limits a compiled break to its inner loop', () => {
    const result = compare(`use ranges
Total = 0
for O in 1 to 3
  for I in 1 to 4
    if I equal 2
      break
    end
    Total += O * I
  end
end
Total`);
    expect(result.value).toBe('6');
    expect(result.loops).toBe(1);
});


describe('compiled nested regions', () => {
    it('captures dependent bounds afresh and independent cursors at every level', () => {
        const source = `use ranges
Total = 0
for I i in 1 to 3
  for J j in I to (I + 1)
    Total += J + i + j
    J = 99
  end
end
Total`;
        const result = compare(source);
        expect(result.value).toBe('24');
        expect(result.loops).toBe(1);
        const innerOnly = execute(source, true, false);
        expect(innerOnly.value).toBe(result.value);
        expect(innerOnly.loops).toBe(3);
    });

    it('separates inner and outer continue edges', () => {
        const result = compare(`use ranges
Total = 0
for I in 1 to 4
  if I equal 2
    continue
  end
  for J in 3 to 1 by -1
    if J equal 2
      continue
    end
    Total += I * J
  end
end
Total`);
        expect(result.value).toBe('32');
        expect(result.loops).toBe(1);
    });

    it('supports mixed conditional and bare loops', () => {
        const result = compare(`I = 0
Total = 0
for I less 3
  I += 1
  J = I
  for
    if J equal 0
      break
    end
    Total += J
    J -= 1
  end
end
Total`);
        expect(result.value).toBe('10');
        expect(result.loops).toBe(1);
    });

    it('preserves the completed result of nested loops', () => {
        const result = compare(`use ranges
for I in 1 to 3
  for J in 1 to 2
    if J equal 2
      break
    end
    Value = I * 10
  end
end`);
        expect(result.value).toBe('30');
        expect(result.loops).toBe(1);
    });

    it.each([
        `for J in 1 to 0 by 0
    X = I
  end`,
        `for J in 1 to 2
    X = 1 // (2 - J)
  end`,
        `J = 1
  for 1 // (2 - J) greater 0
    J += 1
  end`,
    ])('retains nested error locations and writes', inner => {
        const result = compare(`use ranges
for I in 1 to 2
  Done = I
  ${inner}
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('does not treat assignments in an empty inner loop as definite', () => {
        const result = compare(`use ranges
I = 0
for I less 1
  I += 1
  for J in 1 until 1
    Value = 5
  end
  Answer = Value
end`);
        expect(result).toHaveProperty('error');
        // Outer region declines; its empty inner range still compiles.
        expect(result.loops).toBe(1);
    });

    it('preserves missing-range-module errors after earlier outer writes', () => {
        const result = compare(`I = 0
for I less 1
  I += 1
  for J in 1 to 2
    Value = J
  end
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });
});
