import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, type InterpreterOptions } from '../src/index.js';

function outcome(source: string, options: InterpreterOptions = {}) {
    let calls = 0, loops = 0;
    const runtime = new Interpreter(() => {}, { ...options,
        onScalarFunctionExecuted: () => calls++, onIntegerLoopExecuted: () => loops++ });
    try {
        try { return { value: formatValue(runtime.execute(source)!), calls, loops }; }
        catch (error) { return { error: error instanceof RankError ? error.format() : String(error), calls, loops }; }
    } finally { runtime.dispose(); }
}
function compare(source: string, options: InterpreterOptions = {}) {
    const reference = outcome(source, { ...options, compilation: false });
    const compiled = outcome(source, options);
    expect({ ...compiled, calls: 0, loops: 0 }).toEqual({ ...reference, calls: 0, loops: 0 });
    return compiled;
}

const segments = `use bits
use sequences
Masks = array 125 80 55 115 90
Tail = array 107 111 89 127 123
Masks = concat Masks Tail
fun N segments
  Count = 0
  for N greater 0
    Count += (Masks (N mod 10)) popcount
    N //= 10
  end
  return Count
end`;

describe('captured integer arrays in scalar functions', () => {
    it('compiles a helper reading a captured concat array', () => {
        const result = compare(segments + '\n137 segments');
        expect(result.value).toBe('11');
        expect(result.calls).toBe(1);
    });

    it('compiles the helper over a prime range', () => {
        const result = compare(segments + `
Total = 0
for P in primes from 100 till 200
  Total += P segments
end
Total`);
        expect(result.value).toBe('242');
        expect(result.calls).toBe(21);
    });

    it('integer loops accept a concat input', () => {
        const source = `use sequences
A = array 1 2 3
B = array 4 5
C = concat A B
fun N total
  Total = 0
  for I in 0 till N
    Total += C I
  end
  return Total
end
5 total`;
        expect(compare(source).calls).toBe(1);
        const loop = compare(source, { scalarFunctionCompilation: false });
        expect(loop.value).toBe('15');
        expect(loop.loops).toBe(1);
    });

    it('reads a captured matrix by its full address', () => {
        const result = compare(`Grid = array shape 2 3 fill 0
Grid 1 2 = 7
fun R cell C
  return Grid R C
end
X = 1 cell 2
Y = 0 cell 1
X + Y`);
        expect(result.value).toBe('7');
        expect(result.calls).toBe(2);
    });

    it.each(['10', '-1'])('keeps the ordinary error for index %s', index => {
        compare(`Masks = array 1 2 3
fun I pick
  return Masks I
end
${index} pick`);
    });

    it('proves a rebound or rewritten capture again', () => {
        const source = `Masks = array 1 2 3
fun I pick
  return Masks I
end
X = 1 pick
Masks = array 4 5 6
Y = 1 pick
Masks 1 = 9
Z = 1 pick
array X Y Z`;
        const result = compare(source);
        expect(result.value).toBe('2 5 9');
        expect(result.calls).toBe(3);
    });
});

describe('loop jumps in scalar functions', () => {
    it('compiles break and continue', () => {
        const result = compare(`fun N root
  for true
    if N less 10
      break
    end
    S = 0
    for N greater 0
      S += N mod 10
      N //= 10
    end
    N = S
  end
  return N
end
fun N odds
  Total = 0
  for I in 1 to N
    if I mod 2 equal 0
      continue
    end
    Total += I
  end
  return Total
end
X = 987654321 root
Y = 10 odds
X + Y`);
        expect(result.value).toBe('34');
        expect(result.calls).toBe(2);
    });
});
