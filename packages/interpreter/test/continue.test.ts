import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('continue', () => {
    it('skips the rest of an iterable loop body', () => {
        expect(run(`
Sum = 0
for I in 1 to 5
  if I % 2 equal 0
    continue
  end
  Sum += I
end
Sum
`)).toBe('9');
    });

    it('rechecks conditional loops on both evaluation paths', () => {
        for (const condition of ['I less 5', 'I below']) {
            expect(run(`
fun below N
  return N less 5
end
I = 0
Sum = 0
for ${condition}
  I += 1
  if I less 3
    continue
  end
  Sum += I
end
Sum
`)).toBe('12');
        }
    });

    it('continues bare loops and targets only the nearest nested loop', () => {
        expect(run(`
Total = 0
for I in 1 to 3
  J = 0
  for
    J += 1
    if J less 3
      continue
    end
    Total += 1
    break
  end
  Total += 10
end
Total
`)).toBe('33');
    });

    it('runs finally on every continue without entering catch', () => {
        expect(run(`
Cleanups = 0
Catches = 0
for I in 1 to 4
  try
    continue
  catch E
    Catches += 1
  finally
    Cleanups += 1
  end
  Catches += 100
end
array Cleanups Catches
`)).toBe('4 0');
    });

    it('allows continue in catch and runs its finally', () => {
        expect(run(`
N = 0
for I in 1 to 3
  try
    X = 1 / 0
  catch E
    continue
  finally
    N += 1
  end
  N += 100
end
N
`)).toBe('3');
    });

    it('does not swallow errors raised by finally during continue', () => {
        expect(() => run(`
for
  try
    continue
  finally
    X = 1 / 0
  end
end
`)).toThrow('division by zero');
    });

    it('works after yields and inside a suspended generator loop', () => {
        expect(run(`
fun values N
  for I in 1 to N
    if I % 2 equal 0
      continue
    end
    yield I
    continue
    yield -1
  end
end
Result = 0
for V in 5 values
  Result = Result * 10 + V
end
Result
`)).toBe('135');
    });

    it('does not close the iterated generator until the loop ends', () => {
        expect(run(`
use algo
fun values Log
  try
    yield 1
    yield 2
  finally
    Log push 9
  end
end
Log = new queue
for V in Log values
  Log push V
  continue
end
Log
`)).toBe('1 2 9');
    });

    it('rejects continue outside loops and across function boundaries', () => {
        expect(() => run('continue')).toThrow('continue is only valid inside a for loop');
        expect(() => run(`
fun skip N
  continue
end
for
  X = 0 skip
  break
end
`)).toThrow('continue is only valid inside a for loop');
    });

    it('rejects continue inside finally consistently with break', () => {
        expect(() => run(`
for
  try
    break
  finally
    continue
  end
end
`)).toThrow('continue is not valid inside finally');
    });
});
