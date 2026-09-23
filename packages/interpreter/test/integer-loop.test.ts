import { describe, expect, it, vi } from 'vitest';
import { registerCachedArray } from '../src/array-storage.js';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function execute(source: string, integerLoopCompilation: boolean, nestedLoopCompilation = true) {
    let loops = 0;
    const runtime = new Interpreter(undefined, { integerLoopCompilation, nestedLoopCompilation,
        onIntegerLoopExecuted: () => loops++ });
    const containers = () => [...runtime.variables].flatMap<unknown>(([name, value]) => {
        if (typeof value !== 'object' || value === null) return [];
        if (value.kind === 'array' && Array.isArray(Object.getOwnPropertyDescriptor(value, 'items')?.value))
            return [[name, value.shape, value.items.map(formatValue)]];
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
        const result = compare(`Total = 0
for Value i in ${range}
  Total += Value + i
end
Total
`);
        expect(result.loops).toBe(1);
    });

    it('evaluates bounds once and keeps progression independent of bindings', () => {
        const result = compare(`N = 3
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
        const result = compare(`Count = 0
for ${bindings} in 1 to 3
  Count += 1
end
Count
`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it.each([
        'I = "text"\nfor I in 1 to 2\n  X = I + 1\nend',
        'for I in 1 to 0 by 0\n  X = I + 1\nend',
        'for I in 1 // 0 to 2\n  X = I + 1\nend',
        'for I j k in 1 to 2\n  X = I + 1\nend',
    ])('preserves binding and range errors', source => {
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
        const result = compare(`Total = 0
for I in 3 to 3
  Total = ${expression}
end
Total`);
        expect(result.value).toBe(expected);
        // A computed exponent remains on the reference path.
        expect(result.loops).toBe(expression === 'I ** 2 ** 3' ? 0 : 1);
    });

    it.each(['I ** -1', 'I ** N', 'I ** 0.5'])('declines %s before execution', expression => {
        const result = compare(`N = 2
for I in 1 to 3
  Answer = ${expression}
end
Answer`);
        expect(result.loops).toBe(0);
    });

    it('preserves partial writes and fixed-type errors', () => {
        const result = compare(`Answer = 0.0
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
        const result = compare(`Total = 0
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
        const result = compare(`Value = 1
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
        const result = compare(`Total = 0
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
        const result = compare(`Done = 0
Real = 0.0
for I in 1 to 3
  ${branch}
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('declines a potentially missing input before any writes', () => {
        const result = compare(`Total = 0
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
        expect(compare(`for I in 1 to 2
  ${branch}
end`).loops).toBe(1);
    });
});


describe('compiled container loops', () => {
    it.each(['stack', 'queue', 'deque'])('pushes and drains a %s through runtime methods', kind => {
        const result = compare(`use algo
use sequences
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
        const result = compare(`Total = 0
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
        const result = compare(`Total = 0
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
    const result = compare(`Total = 0
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
        const source = `Total = 0
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
        const result = compare(`Total = 0
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
        const result = compare(`for I in 1 to 3
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
        const result = compare(`for I in 1 to 2
  Done = I
  ${inner}
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('does not treat assignments in an empty inner loop as definite', () => {
        const result = compare(`I = 0
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

    it('compiles nested ranges without imports', () => {
        const result = compare(`I = 0
for I less 1
  I += 1
  for J in 1 to 2
    Value = J
  end
end`);
        expect(result.value).toBe('2');
        expect(result.loops).toBe(1);
    });
});

describe('integer array reads in compiled loops', () => {
    it('preserves partial writes and error order with a scalar helper between reads', () => {
        const result = compare('fun divide N\n return 10 // (N - 2)\nend\nB = array 6\nTotal = 0\nfor I in 1 to 3\n Total += B 0\n Value = I divide\nend');
        expect(result.loops).toBe(1);
        expect(result).toHaveProperty('error');
        expect(result.variables).toContainEqual(['Total', '12']);
    });

    it('reads full matrix coordinates inside one nested region', () => {
        const result = compare(`A = array shape 2 3
  1 2 3
  4 5 6
end
Total = 0
for I in 0 until 2
  for J in 0 until 3
    Total += A I J
  end
end
Total`);
        expect(result.value).toBe('21');
        expect(result.loops).toBe(1);
    });

    it.each(['-1', '3', '999999999999999999999999999999'])('preserves bounds errors at %s', index => {
        const result = compare(`A = array 2 4 6
Total = 0
for I in 0 to 1
  Total += A I
  Bad = A (${index})
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('uses array values in conditions and dependent bounds', () => {
        const result = compare(`A = array 2 4 6
Total = 0
for I in 0 until 3
  for J in 1 to (A I)
    if (A I) greater J
      Total += J
    end
  end
end
Total`);
        expect(result.value).toBe('22');
        expect(result.loops).toBe(1);
    });

    it('declines real atoms before execution', () => {
        const result = compare(`A = array 1.5 2.5
Total = 0.0
for I in 0 until 2
  Total += A I
end
Total`);
        expect(result.value).toBe('4');
        expect(result.loops).toBe(0);
    });

    it('retains partial indexing semantics', () => {
        const result = compare(`A = array shape 2 2
  1 2
  3 4
end
for I in 0 until 2
  Row = A I
end`);
        expect(result.loops).toBe(0);
    });

    it('declines receiver rebinding', () => {
        const result = compare(`A = array 1 2
Total = 0
for I in 0 until 2
  Total += A I
  A = array 3 4
end
Total`);
        expect(result.value).toBe('5');
        expect(result.loops).toBe(0);
    });
});

it('does not force lazy array input when the loop does not read it', () => {
    const read = vi.fn(() => 1n);
    const runtime = new Interpreter();
    runtime.variables.set('A', { kind: 'array', shape: [1], itemAt: read,
        get items(): never { throw new Error('forced lazy input'); } });
    try {
        runtime.execute(`for I in 0 until 0
  Value = A I
end`);
        expect(read).not.toHaveBeenCalled();
    } finally { runtime.dispose(); }
});

describe('array writes in compiled integer loops', () => {
    it.each(['-1', '2', '9007199254740993', '999999999999999999999999999999999999'])('keeps matrix write bounds and error order at %s', index => {
        const result = compare(`A = array shape 2 2 fill 0
for I in 0 until 2
  A I 0 = 9
  A I (${index}) = 1 // 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.error).toContain('axis 1');
        expect(result.loops).toBe(1);
        expect(result.containers).toContainEqual(['A', [2, 2], ['9', '0', '0', '0']]);
    });

    // B keeps the zeros it was given: the write to A goes to storage of its own.
    it('reads the value the other name kept, not the writes it did not see', () => {
        const result = compare(`A = array shape 6 fill 0
B = A
A 0 = 1
for I in 1 until 6
  A I = (B (I - 1)) * 2
end
A`);
        expect(result.value).toBe('1 0 0 0 0 0');
        expect(result.loops).toBe(1);
    });

    it('returns the right operand of the last completed array write', () => {
        const result = compare(`A = array shape 2 2 fill 0
for I in 0 until 2
  for J in 0 until 2
    A I J = I * 2 + J
  end
end`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it.each(['-1', '3'])('checks address %s before evaluating a failing right operand', index => {
        const result = compare(`A = array 1 2 3
for I in 0 until 2
  A I = 9
  A (${index}) = 1 // 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('preserves earlier writes when the right operand fails', () => {
        const result = compare(`A = array 1 2 3
for I in 0 until 3
  A I = 9 // (1 - I)
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('preserves array mutations and results across break', () => {
        const result = compare(`A = array 1 2 3
for I in 0 until 3
  A I = I + 10
  if I equal 1
    break
  end
end`);
        expect(result.loops).toBe(1);
    });

    it('retains partial row assignment', () => {
        const result = compare(`A = array shape 2 2 fill 0
for I in 0 until 2
  A I = 7
end`);
        expect(result.loops).toBe(0);
    });
});

describe('compiled array iteration', () => {
    it('keeps an independent cursor and ordinal across continue', () => {
        const result = compare(`A = array 10 20 30
Total = 0
for Value i in A
  if i equal 1
    continue
  end
  Total += Value + i
  Value = 99
end
Total`);
        expect(result.value).toBe('42');
        expect(result.loops).toBe(1);
    });

    it('keeps an iterated array clear of writes through another name', () => {
        const result = compare(`A = array 1 2 3
B = A
Total = 0
for Value i in A
  B 2 = 10
  Total += Value
end
Total`);
        expect(result.value).toBe('6');
        expect(result.loops).toBe(1);
    });

    it('composes named array and numeric-range loops', () => {
        const result = compare(`A = array 1 2 3
Total = 0
for I in 1 to 2
  for Value in A
    Total += I * Value
  end
end
Total`);
        expect(result.value).toBe('18');
        expect(result.loops).toBe(1);
    });

    it('supports discarded value and index bindings', () => {
        const result = compare(`A = array 10 20
Total = 0
for # i in A
  Total += i
end
for Value # in A
  Total += Value
end
Total`);
        expect(result.value).toBe('31');
        expect(result.loops).toBe(2);
    });

    it('checks index type even when the array is empty', () => {
        const result = compare(`A = array shape 0 fill 0
I = "text"
for Value I in A
  Total = 1
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('keeps the type-declaration error before any body write', () => {
        const result = compare(`A = array 1 2
Value = "text"
for Value in A
  Total = 1
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('declines heterogeneous arrays and receiver rebinding', () => {
        expect(compare(`A = array 1 2.5
for Value in A
  Result = Value
end`).loops).toBe(0);
        const result = compare(`A = array 1 2
Total = 0
for Value in A
  A = array 9 9
  Total += Value
end
Total`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(0);
    });
});

describe('compiled compound array assignments', () => {
    it.each(['+=', '-=', '*=', '//=', '%='])('preserves signed operands and RHS result for %s', operator => {
        const result = compare(`A = array -7 7 -7 7
B = array -3 -3 3 3
for I in 0 until 4
  A I ${operator} B I
end`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it('composes nested vector iteration with aliased matrix writes', () => {
        const result = compare(`A = array shape 2 2 fill 1
B = A
Factors = array 2 3
for I in 0 until 2
  for Factor j in Factors
    A I j *= Factor
    B I j += A I j
  end
end
A`);
        expect(result.loops).toBe(1);
    });

    it.each(['//=', '%='])('keeps earlier mutations when %s divides by zero', operator => {
        const result = compare(`A = array 7 7 7
for I in 0 until 3
  A I ${operator} (1 - I)
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('checks a bad address before the RHS error', () => {
        const result = compare(`A = array 7
for I in 0 until 1
  A 1 += 1 // 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('retains reference behavior for compound index updates', () => {
        const result = compare(`use algo
A = index
A 0 = 1
for I in 0 until 2
  A 0 += I
end`);
        expect(result.loops).toBe(0);
    });
});

describe('compiled integer extrema', () => {
    it('preserves infix chains, parentheses and postfix calls', () => {
        const result = compare(`use numbers
Total = 0
for I in -2 to 2
  X = I max 0 min 1
  Y = I (0 - I) max
  Total += X + Y
end
Total`);
        expect(result.value).toBe('8');
        expect(result.loops).toBe(1);
    });

    it('combines addressed left operands and exact large integers', () => {
        const result = compare(`use numbers
A = array 9007199254740993 9007199254740995
Total = 0
for I in 0 until 2
  X = A I max 9007199254740994
  Total += X
end
Total`);
        expect(result.value).toBe('18014398509481989');
        expect(result.loops).toBe(1);
    });

    it.each(['min', 'max'])('respects a shadowed %s and compiles the builtin without imports', name => {
        const result = compare(`use numbers
fun ${name} A B
  return A + B
end
for I in 1 to 2
  X = I ${name} 10
end
X`);
        expect(result.value).toBe('12');
        expect(result.loops).toBe(0);
        expect(compare(`for I in 0 until 1
  X = 2 ${name} 3
end`).loops).toBe(1);
    });

    it('retains right operand error timing and partial writes', () => {
        const result = compare(`use numbers
for I in 0 until 2
  Done = I
  X = I max (1 // (1 - I))
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('preserves scalar unary extrema', () => {
        const result = compare(`use numbers
for I in 0 until 1
  X = I max
end`);
        expect(result.value).toBe('0');
        expect(result.loops).toBe(1);
    });

    it('retains skipped malformed chains', () => {
        const result = compare(`use numbers
for I in 0 until 0
  X = 1 max 2 3
end`);
        expect(result).not.toHaveProperty('error');
    });
});

describe('compiled full scalar write addresses', () => {
    it('writes rectangular rank-three cells in row-major order', () => {
        const result = compare(`A = array shape 2 3 4 fill 0
for I in 0 until 2
  for J in 0 until 3
    for K in 0 until 4
      A I J K = I * 100 + J * 10 + K
    end
  end
end
A`);
        expect(result.loops).toBe(1);
    });

    it.each(['0 3 0', '0 0 4', '0 (0 - 1) 0', '0 0 999999999999999999999999'])('preserves error ordering for address %s', address => {
        const result = compare(`A = array shape 2 3 4 fill 0
for I in 0 until 1
  A 1 2 3 = 99
  A ${address} = 1 // 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('rejects a coordinate on an empty axis', () => {
        const result = compare(`A = array shape 2 0 4 fill 0
for I in 0 until 1
  A 0 0 0 = 1
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });
});

describe('invocation-bound integer writers', () => {
    it('binds fresh local frames on repeated function calls', () => {
        const result = compare(`fun tally Start
  Total = Start
  for I in 1 to 3
    Total += I
  end
  return Total
end
A = 1 tally
B = 100 tally
array A B`);
        expect(result.value).toBe('7 106');
        expect(result.loops).toBe(2);
    });

    it('updates captured parent variables across nested calls', () => {
        const result = compare(`fun outer Seed
  Total = Seed
  fun add N
    for I in 1 to N
      Total += I
    end
    return Total
  end
  First = 3 add
  Second = 2 add
  return Total
end
10 outer`);
        expect(result.value).toBe('19');
        expect(result.loops).toBe(2);
    });

    it('checks a new invocation with a different parameter type', () => {
        const result = compare(`fun replace Value
  for I in 0 until 2
    Done = I
    Value = I
  end
  return Value
end
First = 1 replace
Second = 1.0 replace`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(2);
    });

    it('does not check an assignment that never executes', () => {
        const result = compare(`Value = "kept"
for I in 0 until 2
  if I less 0
    Value = I
  end
end
Value`);
        expect(result.value).toBe('kept');
        expect(result.loops).toBe(1);
    });

    it('keeps prior writes before a late first-assignment type error', () => {
        const result = compare(`Wrong = "text"
Done = 0
for I in 0 until 4
  Done += I
  if I equal 2
    Wrong = I
  end
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('retains declared types after the compiled region returns', () => {
        const result = compare(`for I in 0 until 3
  Value = I
end
Value = "text"`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });
});

describe('boolean locals in compiled loops', () => {
    it('stores comparisons and combines boolean assignment operators', () => {
        const result = compare(`Count = 0
for I in 0 until 6
  Allowed = I less 2
  Allowed or= I equal 5
  Allowed and= I greater 0
  Allowed xor= I equal 3
  if Allowed
    Count += 1
  end
end
Count`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it('guards an incoming boolean loop condition', () => {
        const result = compare(`Active = true
I = 0
for Active
  I += 1
  Active = I less 4
end
I`);
        expect(result.value).toBe('4');
        expect(result.loops).toBe(1);
    });

    it('merges boolean definitions from both branches', () => {
        const result = compare(`Count = 0
for I in 0 until 4
  if I less 2
    Flag = true
  else
    Flag = false
  end
  Copy = Flag
  if Copy equal true
    Count += 1
  end
end
Count`);
        expect(result.value).toBe('2');
        expect(result.loops).toBe(1);
    });

    it('preserves a first-write type error after earlier mutations', () => {
        const result = compare(`Flag = 1
Done = 0
for I in 0 until 3
  Done += 1
  Flag = I less 2
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('does not make boolean compound operands short-circuit', () => {
        const result = compare(`Flag = true
for I in 0 until 1
  Flag or= (1 // 0) equal 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('keeps the boolean type after leaving the region', () => {
        const result = compare(`for I in 0 until 2
  Flag = I equal 0
end
Flag = 1`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('declines incompatible local types across branches', () => {
        const result = compare(`for I in 0 until 2
  if I equal 0
    Value = true
  else
    Value = 1
  end
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });
});

describe('boolean arrays in compiled regions', () => {
    it('keeps boolean cells private to the name that writes them', () => {
        const result = compare(`A = array true false false false
B = A
Count = 0
for I in 1 until 4
  if B (I - 1)
    A I = true
  end
  if B I
    Count += 1
  end
end
Count`);
        expect(result.value).toBe('0');
        expect(result.loops).toBe(1);
    });

    it.each(['and=', 'or=', 'xor='])('supports matrix boolean updates with %s', operator => {
        const result = compare(`A = array shape 2 2
  true false
  false true
end
for I in 0 until 2
  for J in 0 until 2
    A I J ${operator} I equal J
  end
end
A`);
        expect(result.loops).toBe(1);
    });

    it('validates an address before the boolean RHS fails', () => {
        const result = compare(`A = array true false
for I in 0 until 1
  A 0 = false
  A 2 or= (1 // 0) equal 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('retains ordinary behavior for mixed cells', () => {
        const result = compare(`A = array true 1
Count = 0
for I in 0 until 2
  if A I
    Count += 1
  end
end`);
        expect(result.loops).toBe(0);
    });

    it('declines mixed read/write types through different aliases', () => {
        const result = compare(`A = array 1 2
B = A
for I in 0 until 2
  X = B I + 1
  A I = true
end
A`);
        expect(result.loops).toBe(0);
    });

    it('does not treat an iterated boolean as an integer', () => {
        const result = compare(`A = array true false
Total = 0
for Value in A
  if A 0
    Total += Value
  end
end`);
        expect(result.loops).toBe(0);
    });
});

describe('array locals in compiled regions', () => {
    it('allocates fresh arrays and preserves aliases to earlier objects', () => {
        const result = compare(`Total = 0
for I in 0 until 3
  Current = array shape 2 fill I
  Saved = Current
  Current = array shape 2 fill 9
  Total += Saved 0
end
Total`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it('rebinds an input while retaining writes through an old alias', () => {
        const result = compare(`Source = array 1 1
Total = 0
for I in 0 until 2
  Seen = Source 0
  Old = Source
  Source = array shape 2 fill I
  Old 0 += 10
  Total += Old 0
end
Total`);
        expect(result.value).toBe('21');
        expect(result.loops).toBe(1);
    });

    it('evaluates changing dimensions and boolean fills on every iteration', () => {
        const result = compare(`Count = 0
for I in 1 to 3
  Row = array shape (I + 1) fill I less 3
  if Row I
    Count += 1
  end
end
Count`);
        expect(result.value).toBe('2');
        expect(result.loops).toBe(1);
    });

    it.each(['-1', '9007199254740992'])('checks dimension %s before a failing fill', dimension => {
        const result = compare(`for I in 0 until 1
  Done = I
  Row = array shape (${dimension}) fill (1 // 0)
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('keeps the prior array when a later allocation expression fails', () => {
        const result = compare(`for I in 0 until 2
  Row = array shape 2 fill (1 // (1 - I))
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('checks a destination type at the assignment, after earlier writes', () => {
        const result = compare(`Row = 1
Done = 0
for I in 0 until 2
  Done += 1
  Row = array shape 2 fill 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('does not assume a conditional array definition executed', () => {
        const result = compare(`for I in 0 until 1
  if I greater 0
    Row = array shape 2 fill 0
  end
  Value = Row 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });
});


it('does not make a cached lazy input writable through a local alias', () => {
    for (const integerLoopCompilation of [false, true]) {
        let loops = 0;
        const runtime = new Interpreter(undefined, { integerLoopCompilation,
            onIntegerLoopExecuted: () => loops++ });
        const read = vi.fn(() => 1n);
        runtime.variables.set('Source', registerCachedArray({ kind: 'array', shape: [1],
            get items() { return [1n]; }, itemAt: read }, () => [1n]));
        try {
            expect(() => runtime.execute(`for I in 0 until 1
  Seen = Source 0
  Alias = Source
  Alias 0 = 2
end`)).toThrow('cannot assign to a lazy array');
            expect(loops).toBe(0);
            expect(read).toHaveBeenCalledTimes(1);
        } finally { runtime.dispose(); }
    }
});


it('retains partial selection on locally created arrays', () => {
    const result = compare(`for I in 0 until 1
  A = array shape 2 2 fill 0
  A 0 = 1
end
A`);
    expect(result.loops).toBe(0);
});

it('retains excess-address diagnostics for local arrays', () => {
    const result = compare(`for I in 0 until 1
  A = array shape 2 fill 0
  A 0 0 = 1
end`);
    expect(result).toHaveProperty('error');
    expect(result.loops).toBe(0);
});

it('honors the array-write toggle for locally created arrays', () => {
    let loops = 0;
    const runtime = new Interpreter(undefined, { arrayWriteCompilation: false,
        onIntegerLoopExecuted: () => loops++ });
    try {
        const result = runtime.execute(`for I in 0 until 1
  A = array shape 2 fill 0
  A 0 = 7
end
A`);
        expect(formatValue(result!)).toBe('7 0');
        expect(loops).toBe(0);
    } finally { runtime.dispose(); }
});

describe('compiled loop returns', () => {
    it('returns from both nested loops while keeping prior writes', () => {
        const result = compare(`fun find N
  for I in 0 until N
    for J in 0 until N
      if I + J equal 5
        return I * 10 + J
      end
    end
  end
  return -1
end
4 find`);
        expect(result.value).toBe('23');
        expect(result.loops).toBe(1);
    });

    it('returns a created array with its mutations', () => {
        const result = compare(`fun build N
  for I in 1 to N
    Row = array shape 2 fill I
    Row 1 += 10
    if I equal 2
      return Row
    end
  end
  return array 0 0
end
4 build`);
        expect(result.value).toBe('2 12');
        expect(result.loops).toBe(1);
    });

    it('runs enclosing finally before completing the return', () => {
        const result = compare(`fun perform A
  try
    for I in 0 until 3
      A 0 += 1
      return I
    end
  finally
    A 1 = 9
  end
  return -1
end
A = array 0 0
Result = A perform
A`);
        expect(result.value).toBe('0 0');
        expect(result.loops).toBe(1);
    });

    it('retains return expression errors after earlier mutations', () => {
        const result = compare(`fun perform A
  for I in 0 until 3
    A 0 += 1
    return 1 // I
  end
  return 0
end
A = array 0
A perform`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('keeps invalid-context validation before the return expression', () => {
        const result = compare(`for I in 0 until 1
  return 1 // 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });

    it('retains the ban on return inside finally', () => {
        const result = compare(`fun perform N
  try
    Result = N
  finally
    for I in 0 until 1
      return 1 // 0
    end
  end
  return Result
end
1 perform`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });
});


describe('proven integer iteration types', () => {
    it('does not declare an element type for an empty vector', () => {
        const result = compare(`A = array shape 0 fill 0
Value = "kept"
Total = 0
for Value i in A
  Total += 1
end
Value`);
        expect(result.value).toBe('kept');
        expect(result.loops).toBe(1);
    });

    it('still checks the ordinal type when the vector is empty', () => {
        const result = compare(`A = array shape 0 fill 0
Index = "held"
Total = 0
for Value Index in A
  Total += 1
end`);
        expect(result).toHaveProperty('error');
    });

    it('checks the element binding before executing the body', () => {
        const result = compare(`A = array 1 2
Value = "held"
Total = 0
for Value in A
  Total += 1
end`);
        expect(result).toHaveProperty('error');
        expect(result.variables).toContainEqual(['Total', '0']);
    });
});


describe('compiled integer absolute values', () => {
    it('sums signed magnitudes without losing large integers', () => {
        const result = compare(`use numbers
A = array -9007199254740993 0 9007199254740993
Total = 0
for X in A
  Total += X abs
end
Total`);
        expect(result.value).toBe('18014398509481986');
        expect(result.loops).toBe(1);
    });

    it('evaluates a destructive operand exactly once', () => {
        const result = compare(`use numbers
use algo
Q = new queue
Q push -5
Q push -7
Total = 0
for I in 1 to 2
  Total += (Q pop) abs
end
Total`);
        expect(result.value).toBe('12');
        expect(result.loops).toBe(1);
    });

    it('retains a user function named abs', () => {
        const result = compare(`use numbers
fun abs X
  return X + 10
end
Total = 0
for I in 1 to 2
  Total += I abs
end
Total`);
        expect(result.value).toBe('23');
        expect(result.loops).toBe(0);
    });

    it('preserves diagnostics for a missing numbers import', () => {
        const result = compare(`Total = 0
for I in 1 to 2
  Total += I abs
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });
});


describe('compiled text loops', () => {
    it('iterates Unicode code points with their ordinal indices', () => {
        const result = compare(`Text = "a😀é😀"
Total = 0
for C i in Text
  if C equal "😀"
    Total += i
  end
end
Total`);
        expect(result.value).toBe('5');
        expect(result.loops).toBe(1);
    });

    it('compiles text equality in nested loops', () => {
        const result = compare(`Left = "a😀"
Right = "😀a😀"
Total = 0
for A i in Left
  for B j in Right
    if A equal B
      Total += i + j + 1
    end
  end
end
Total`);
        expect(result.value).toBe('8');
        expect(result.loops).toBe(1);
    });

    it('keeps the iterator source when the source variable is reassigned', () => {
        const result = compare(`Text = "abc"
Total = 0
for C i in Text
  Text = "x"
  Total += i
end
Total`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it('checks the character type even when text is empty', () => {
        const result = compare(`Text = ""
C = 1
Total = 0
for C in Text
  Total += 1
end`);
        expect(result).toHaveProperty('error');
    });

    it('checks the ordinal type before an empty text loop', () => {
        const result = compare(`Text = ""
Index = "held"
Total = 0
for C Index in Text
  Total += 1
end`);
        expect(result).toHaveProperty('error');
    });

    it('returns text from a compiled loop', () => {
        const result = compare(`fun choose Text
  for C in Text
    if C not equal "x"
      return C
    end
  end
  return ""
end
"xx😀" choose`);
        expect(result.value).toBe('😀');
        expect(result.loops).toBe(1);
    });

    it('keeps separate guarded variants across calls with different input kinds', () => {
        const result = compare(`fun count_values Values
  Total = 0
  for X i in Values
    Total += i + 1
  end
  return Total
end
A = "😀x" count_values
B = (array 10 20 30) count_values
C = "q" count_values
array A B C`);
        expect(result.value).toBe('3 6 1');
        expect(result.loops).toBe(3);
    });
});

describe('compiled iteration over text vectors', () => {
    it('joins rows and Unicode character loops in one region', () => {
        const result = compare(`Rows = array "a😀" "" "😀b😀"
Total = 0
for Row i in Rows
  for C j in Row
    if C equal "😀"
      Total += i * 10 + j
    end
  end
end
Total`);
        expect(result.value).toBe('43');
        expect(result.loops).toBe(1);
    });

    it('retains empty-string element binding validation', () => {
        const result = compare(`Rows = array ""
C = 1
Total = 0
for Row in Rows
  for C in Row
    Total += 1
  end
end`);
        expect(result).toHaveProperty('error');
        expect(result.variables).toContainEqual(['Total', '0']);
    });

    it('falls back before writes for a mixed vector', () => {
        const result = compare(`Rows = array "a" 5
Total = 0
for Row in Rows
  for C in Row
    Total += 1
  end
end`);
        expect(result).toHaveProperty('error');
        expect(result.variables).toContainEqual(['Total', '1']);
    });

    it('keeps local string rebinding separate from vector storage', () => {
        const result = compare(`Rows = array "ab" "c"
Total = 0
for Row in Rows
  for C in Row
    Row = "x"
    Total += 1
  end
end
Rows`);
        expect(result.value).toBe('ab c');
        expect(result.variables).toContainEqual(['Total', '3']);
        expect(result.loops).toBe(1);
    });

    it('preserves numeric writes before a later bounds error', () => {
        const result = compare(`Rows = array "." "..."
Counts = array 0 0
for Row in Rows
  for C i in Row
    Counts i += 1
  end
end`);
        expect(result).toHaveProperty('error');
        expect(result.containers).toContainEqual(['Counts', [2], ['2', '1']]);
        expect(result.loops).toBe(1);
    });
});


describe('direct compiled text iteration', () => {
    it.each(['😀é', '\ud800x\udc00', ''])('preserves code point iteration for %j', text => {
        const results = [false, true].map(directTextIteration => {
            const runtime = new Interpreter(undefined, { directTextIteration });
            runtime.variables.set('Text', text);
            try {
                runtime.execute(`Total = 0
Last = ""
for C i in Text
  Total += i + 1
  Last = C
end`);
                return [runtime.variables.get('Total'), runtime.variables.get('Last')];
            } finally { runtime.dispose(); }
        });
        const chars = [...text];
        expect(results[1]).toEqual(results[0]);
        expect(results[1]).toEqual([BigInt(chars.length * (chars.length + 1) / 2), chars.at(-1) ?? '']);
    });
});


describe('compiled integer text and length', () => {
    it('composes decimal text and length without parentheses', () => {
        const result = compare(`use text
use sequences
Total = 0
for I in -12 to -9
  Total += I text len
end
Total`);
        expect(result.value).toBe('11');
        expect(result.loops).toBe(1);
    });

    it('counts Unicode code points for known text bindings', () => {
        const result = compare(`use sequences
Rows = array "😀a" "é" ""
Total = 0
for Row in Rows
  Total += Row len
end
Total`);
        expect(result.value).toBe('4');
        expect(result.loops).toBe(1);
    });

    it('uses the first array dimension after local allocations', () => {
        const result = compare(`use sequences
Total = 0
for I in 1 to 3
  A = array shape I 2 fill 0
  Total += A len
end
Total`);
        expect(result.value).toBe('6');
        expect(result.loops).toBe(1);
    });

    it('keeps a shadowed text function', () => {
        const result = compare(`use text
use sequences
fun text X
  return "xx"
end
Total = 0
for I in 1 to 3
  Total += I text len
end
Total`);
        expect(result.value).toBe('6');
        expect(result.loops).toBe(0);
    });
});


it('retains shadowed len on a known allocated array', () => {
    const result = compare(`use sequences
fun len A
  return 7
end
Total = 0
for I in 1 to 2
  A = array shape I fill 0
  Total += A len
end
Total`);
    expect(result.value).toBe('14');
    expect(result.loops).toBe(0);
});

describe('proven scalar calls from loop regions', () => {
    it('calls a two-argument scalar function in a compiled loop', () => {
        const result = compare(`fun combine A B
  return A * 10 + B
end
Total = 0
for I in 1 to 3
  Total += I 2 combine
end
Total`);
        expect(result.value).toBe('66');
        expect(result.loops).toBe(1);
    });

    it('uses a boolean function result as a branch condition', () => {
        const result = compare(`fun positive X
  return X greater 0
end
Total = 0
for I in -2 to 2
  if I positive
    Total += I
  end
end
Total`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it('keeps callee diagnostics and earlier caller mutations', () => {
        const result = compare(`fun divide X
  return 10 // X
end
A = array 0
for I in 1 to 0 by -1
  A 0 += 1
  Result = I divide
end`);
        expect(result).toHaveProperty('error');
        expect(result.containers).toContainEqual(['A', [1], ['2']]);
        expect(result.loops).toBe(1);
    });

    it('does not assume a captured value is a parameter', () => {
        const result = compare(`Offset = 7
fun plus X
  return X + Offset
end
Total = 0
for I in 1 to 3
  Total += I plus
end
Total`);
        expect(result.value).toBe('27');
        expect(result.loops).toBe(0);
    });

    it('keeps effectful helpers on the ordinary path', () => {
        const result = compare(`A = array 0
fun update X
  A 0 += X
  return X
end
Total = 0
for I in 1 to 3
  Total += I update
end
Total`);
        expect(result.value).toBe('6');
        expect(result.containers).toContainEqual(['A', [1], ['6']]);
        expect(result.loops).toBe(0);
    });

    it('binds local function instances separately on each invocation', () => {
        const result = compare(`fun perform N
  fun twice X
    return X * 2
  end
  Total = 0
  for I in 1 to N
    Total += I twice
  end
  return Total
end
A = 3 perform
B = 4 perform
array A B`);
        expect(result.value).toBe('12 20');
        expect(result.loops).toBe(2);
    });

    it('rechecks the function definition after replacement', () => {
        let loops = 0;
        const runtime = new Interpreter(undefined, { onIntegerLoopExecuted: () => loops++ });
        try {
            runtime.execute(`fun helper X
  return X + 1
end
fun perform N
  Total = 0
  for I in 1 to N
    Total += I helper
  end
  return Total
end`);
            expect(runtime.execute('3 perform')).toBe(9n);
            expect(loops).toBe(1);
            runtime.execute(`fun helper X
  return X + 10
end`);
            expect(runtime.execute('3 perform')).toBe(36n);
            expect(loops).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('preserves the ordinary call depth limit', () => {
        const errors = [false, true].map(integerLoopCompilation => {
            const runtime = new Interpreter(undefined, { integerLoopCompilation, maxCallDepth: 1 });
            try {
                runtime.execute(`fun helper X
  return X + 1
end
fun perform N
  Total = 0
  for I in 1 to N
    Total += I helper
  end
  return Total
end
3 perform`);
                return 'unexpected success';
            } catch (error) { return error instanceof RankError ? error.format() : String(error); }
            finally { runtime.dispose(); }
        });
        expect(errors[1]).toBe(errors[0]);
        expect(errors[1]).toContain('RecursionLimit');
    });
});

describe('proven scalar function blocks', () => {
    it('tracks local assignments and early return branches', () => {
        const result = compare(`fun bounded X
  Value = X - 2
  if Value less 0
    return 0
  elif Value greater 2
    Value = 2
  end
  return Value
end
Total = 0
for I in 0 to 5
  Total += I bounded
end
Total`);
        expect(result.value).toBe('5');
        expect(result.loops).toBe(1);
    });

    it('merges definitions from both continuing branches', () => {
        const result = compare(`fun magnitude X
  if X less 0
    Value = -X
  else
    Value = X
  end
  return Value
end
Total = 0
for I in -2 to 2
  Total += I magnitude
end
Total`);
        expect(result.value).toBe('6');
        expect(result.loops).toBe(1);
    });

    it('does not mutate a captured assignment through a compiled call', () => {
        const result = compare(`fun perform N
  Shared = 10
  fun helper X
    Shared = X + 1
    return Shared
  end
  Total = 0
  for I in 1 to N
    Total += I helper
  end
  return Shared
end
3 perform`);
        expect(result.value).toBe('4');
        expect(result.loops).toBe(0);
    });

    it('rejects a collision created later by the caller region', () => {
        const result = compare(`fun perform N
  fun helper X
    Shared = X + 1
    return Shared
  end
  Total = 0
  for I in 1 to N
    Value = I helper
    Total += Value
    Shared = 100
  end
  return array Total Shared
end
2 perform`);
        expect(result.value).toBe('5 100');
        expect(result.loops).toBe(0);
    });

    it('allows parameter writes without changing caller bindings', () => {
        const result = compare(`fun increment X
  X += 1
  return X
end
Total = 0
for I in 1 to 3
  Total += I increment
end
array Total I`);
        expect(result.value).toBe('9 3');
        expect(result.loops).toBe(1);
    });

    it('requires local reads to be defined on every continuing path', () => {
        const result = compare(`fun helper X
  if X greater 0
    Value = X
  end
  return Value
end
Total = 0
for I in 0 to 1
  Total += I helper
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(0);
    });

    it('keeps block function errors after prior caller writes', () => {
        const result = compare(`fun helper X
  Value = X - 1
  return 10 // Value
end
A = array 0
for I in 2 to 1 by -1
  A 0 += 1
  Result = I helper
end`);
        expect(result).toHaveProperty('error');
        expect(result.containers).toContainEqual(['A', [1], ['2']]);
        expect(result.loops).toBe(1);
    });

    it('rejects hoisted declarations after a terminal return', () => {
        const result = compare(`fun helper X
  return X
  fun nested Y
    return Y
  end
end
Total = 0
for I in 1 to 2
  Total += I helper
end
Total`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(0);
    });
});


it('allows independent local names in a global helper and its caller', () => {
    const result = compare(`fun helper X
  Value = X + 1
  return Value
end
Total = 0
for I in 1 to 3
  Value = I helper
  Total += Value
end
Total`);
    expect(result.value).toBe('9');
    expect(result.loops).toBe(1);
});

describe('tail calls from compiled loop returns', () => {
    it.each([
        ['conditional', 'for N greater 0\n  return N helper\nend', true],
        ['nested conditional', 'for N greater 0\n  for N greater 0\n    return N helper\n  end\nend', true],
        ['range', 'for I in 1 to N\n  return N helper\nend', false],
        ['range inside condition', 'for N greater 0\n  for I in 1 to N\n    return N helper\n  end\nend', false],
        ['condition inside range', 'for I in 1 to N\n  for N greater 0\n    return N helper\n  end\nend', false],
        ['arithmetic after call', 'for N greater 0\n  return (N helper) + 1\nend', false],
        ['finally', 'try\n  for N greater 0\n    return N helper\n  end\nfinally\n  A 0 += 1\nend', false],
    ])('preserves call depth through %s', (_name, loop, tail) => {
        const results = [false, true].map(integerLoopCompilation => {
            let entries = 0;
            const runtime = new Interpreter(undefined, { integerLoopCompilation, maxCallDepth: 1,
                onIntegerLoopExecuted: () => entries++ });
            const source = `fun helper X
  return X + 1
end
fun perform N
${String(loop).split('\n').map(line => '  ' + line).join('\n')}
  return 0
end
A = array 0
3 perform`;
            try {
                const value = runtime.execute(source);
                return { value, entries, array: formatValue(runtime.variables.get('A')!) };
            } catch (error) {
                return { error: error instanceof RankError ? error.format() : String(error), entries,
                    array: formatValue(runtime.variables.get('A')!) };
            } finally { runtime.dispose(); }
        });
        expect({ ...results[1], entries: 0 }).toEqual({ ...results[0], entries: 0 });
        expect(results[1].entries).toBe(1);
        if (tail) expect(results[1]).toHaveProperty('value', 4n);
        else expect(results[1]).toHaveProperty('error', expect.stringContaining('RecursionLimit'));
        if (_name === 'finally') expect(results[1].array).toBe('1');
    });

    it('retains the source location of an error after tail transfer', () => {
        const result = compare(`fun helper X
  return 10 // (X - 3)
end
fun perform N
  for N greater 0
    return (N helper)
  end
  return 0
end
3 perform`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });
});
