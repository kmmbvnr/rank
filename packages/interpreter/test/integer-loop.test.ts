import { describe, expect, it, vi } from 'vitest';
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

describe('integer array reads in compiled loops', () => {
    it('reads full matrix coordinates inside one nested region', () => {
        const result = compare(`use ranges
A = array shape 2 3
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
        const result = compare(`use ranges
A = array 2 4 6
Total = 0
for I in 0 to 1
  Total += A I
  Bad = A (${index})
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('uses array values in conditions and dependent bounds', () => {
        const result = compare(`use ranges
A = array 2 4 6
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
        const result = compare(`use ranges
A = array 1.5 2.5
Total = 0.0
for I in 0 until 2
  Total += A I
end
Total`);
        expect(result.value).toBe('4');
        expect(result.loops).toBe(0);
    });

    it('retains partial indexing semantics', () => {
        const result = compare(`use ranges
A = array shape 2 2
  1 2
  3 4
end
for I in 0 until 2
  Row = A I
end`);
        expect(result.loops).toBe(0);
    });

    it('declines receiver rebinding', () => {
        const result = compare(`use ranges
A = array 1 2
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
        runtime.execute(`use ranges
for I in 0 until 0
  Value = A I
end`);
        expect(read).not.toHaveBeenCalled();
    } finally { runtime.dispose(); }
});

describe('array writes in compiled integer loops', () => {
    it('reads earlier writes through an alias', () => {
        const result = compare(`use ranges
A = array shape 6 pad 0
B = A
A 0 = 1
for I in 1 until 6
  A I = (B (I - 1)) * 2
end
A`);
        expect(result.value).toBe('1 2 4 8 16 32');
        expect(result.loops).toBe(1);
    });

    it('returns the right operand of the last completed array write', () => {
        const result = compare(`use ranges
A = array shape 2 2 pad 0
for I in 0 until 2
  for J in 0 until 2
    A I J = I * 2 + J
  end
end`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it.each(['-1', '3'])('checks address %s before evaluating a failing right operand', index => {
        const result = compare(`use ranges
A = array 1 2 3
for I in 0 until 2
  A I = 9
  A (${index}) = 1 // 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('preserves earlier writes when the right operand fails', () => {
        const result = compare(`use ranges
A = array 1 2 3
for I in 0 until 3
  A I = 9 // (1 - I)
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('preserves array mutations and results across break', () => {
        const result = compare(`use ranges
A = array 1 2 3
for I in 0 until 3
  A I = I + 10
  if I equal 1
    break
  end
end`);
        expect(result.loops).toBe(1);
    });

    it('retains partial row assignment', () => {
        const result = compare(`use ranges
A = array shape 2 2 pad 0
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

    it('observes writes to future elements through an alias', () => {
        const result = compare(`A = array 1 2 3
B = A
Total = 0
for Value i in A
  B 2 = 10
  Total += Value
end
Total`);
        expect(result.value).toBe('13');
        expect(result.loops).toBe(1);
    });

    it('composes named array and numeric-range loops', () => {
        const result = compare(`use ranges
A = array 1 2 3
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
        const result = compare(`A = array shape 0 pad 0
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
        const result = compare(`use ranges
A = array -7 7 -7 7
B = array -3 -3 3 3
for I in 0 until 4
  A I ${operator} B I
end`);
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it('composes nested vector iteration with aliased matrix writes', () => {
        const result = compare(`use ranges
A = array shape 2 2 pad 1
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
        const result = compare(`use ranges
A = array 7 7 7
for I in 0 until 3
  A I ${operator} (1 - I)
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('checks a bad address before the RHS error', () => {
        const result = compare(`use ranges
A = array 7
for I in 0 until 1
  A 1 += 1 // 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('retains reference behavior for compound index updates', () => {
        const result = compare(`use algo
use ranges
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
        const result = compare(`use ranges
use numbers
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
        const result = compare(`use ranges
use numbers
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

    it.each(['min', 'max'])('respects a shadowed %s and missing imports', name => {
        const result = compare(`use ranges
use numbers
fun ${name} A B
  return A + B
end
for I in 1 to 2
  X = I ${name} 10
end
X`);
        expect(result.value).toBe('12');
        expect(result.loops).toBe(0);
        expect(compare(`use ranges
for I in 0 until 1
  X = 2 ${name} 3
end`).loops).toBe(0);
    });

    it('retains right operand error timing and partial writes', () => {
        const result = compare(`use ranges
use numbers
for I in 0 until 2
  Done = I
  X = I max (1 // (1 - I))
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('preserves scalar unary extrema', () => {
        const result = compare(`use ranges
use numbers
for I in 0 until 1
  X = I max
end`);
        expect(result.value).toBe('0');
        expect(result.loops).toBe(1);
    });

    it('retains skipped malformed chains', () => {
        const result = compare(`use ranges
use numbers
for I in 0 until 0
  X = 1 max 2 3
end`);
        expect(result).not.toHaveProperty('error');
    });
});

describe('compiled full scalar write addresses', () => {
    it('writes rectangular rank-three cells in row-major order', () => {
        const result = compare(`use ranges
A = array shape 2 3 4 pad 0
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
        const result = compare(`use ranges
A = array shape 2 3 4 pad 0
for I in 0 until 1
  A 1 2 3 = 99
  A ${address} = 1 // 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('rejects a coordinate on an empty axis', () => {
        const result = compare(`use ranges
A = array shape 2 0 4 pad 0
for I in 0 until 1
  A 0 0 0 = 1
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });
});

describe('invocation-bound integer writers', () => {
    it('binds fresh local frames on repeated function calls', () => {
        const result = compare(`use ranges
fun tally Start
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
        const result = compare(`use ranges
fun outer Seed
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
        const result = compare(`use ranges
fun replace Value
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
        const result = compare(`use ranges
Value = "kept"
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
        const result = compare(`use ranges
Wrong = "text"
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
        const result = compare(`use ranges
for I in 0 until 3
  Value = I
end
Value = "text"`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });
});

describe('boolean locals in compiled loops', () => {
    it('stores comparisons and combines boolean assignment operators', () => {
        const result = compare(`use ranges
Count = 0
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
        const result = compare(`use ranges
Count = 0
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
        const result = compare(`use ranges
Flag = 1
Done = 0
for I in 0 until 3
  Done += 1
  Flag = I less 2
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('does not make boolean compound operands short-circuit', () => {
        const result = compare(`use ranges
Flag = true
for I in 0 until 1
  Flag or= (1 // 0) equal 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('keeps the boolean type after leaving the region', () => {
        const result = compare(`use ranges
for I in 0 until 2
  Flag = I equal 0
end
Flag = 1`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('declines incompatible local types across branches', () => {
        const result = compare(`use ranges
for I in 0 until 2
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
    it('reads and writes boolean cells through aliases', () => {
        const result = compare(`use ranges
A = array true false false false
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
        expect(result.value).toBe('3');
        expect(result.loops).toBe(1);
    });

    it.each(['and=', 'or=', 'xor='])('supports matrix boolean updates with %s', operator => {
        const result = compare(`use ranges
A = array shape 2 2
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
        const result = compare(`use ranges
A = array true false
for I in 0 until 1
  A 0 = false
  A 2 or= (1 // 0) equal 0
end`);
        expect(result).toHaveProperty('error');
        expect(result.loops).toBe(1);
    });

    it('retains ordinary behavior for mixed cells', () => {
        const result = compare(`use ranges
A = array true 1
Count = 0
for I in 0 until 2
  if A I
    Count += 1
  end
end`);
        expect(result.loops).toBe(0);
    });

    it('declines mixed read/write types through different aliases', () => {
        const result = compare(`use ranges
A = array 1 2
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
