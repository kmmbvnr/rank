import { describe, expect, it } from 'vitest';
import { Interpreter, isRankSequence } from '../src/index.js';
import { MemoryIo } from './support.js';

const count = `
fun count N Total
  if N equal 0
    return Total
  end
  return (N - 1) (Total + 1) count
end
`;

describe('tail calls', () => {
    it('runs a million tail calls with a one-frame call budget', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 1 });
        expect(interpreter.execute(`${count}\n1000000 0 count`)).toBe(1000000n);
        expect(interpreter.execute('1 10 count')).toBe(11n);
    }, 30_000);

    it('replaces frames for mutual recursion and parenthesized returns', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 1 });
        expect(interpreter.execute(`
fun even N
  if N equal 0
    return true
  end
  return ((N - 1) odd)
end
fun odd N
  if N equal 0
    return false
  end
  return (N - 1) even
end
100001 odd
`)).toBe(true);
    });

    it('preserves captured caller frames when replacing them', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 1 });
        expect(interpreter.execute(`
fun zero X
  return 0
end
fun loop N Saved
  fun capture X
    return N + X
  end
  if N equal 0
    F = Saved 0
    return 0 F
  end
  if N equal 3
    Keep = array capture
    return (N - 1) Keep loop
  end
  return (N - 1) Saved loop
end
Saved = array zero
3 Saved loop
`)).toBe(3n);
    });

    it('retains postfix effects and the dynamically selected terminal function', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line), { maxCallDepth: 1 });
        expect(interpreter.execute(`
use io
fun identity X
  return X
end
F = identity
fun forward N
  return N print F
end
7 forward
`)).toBe(7n);
        expect(lines).toEqual(['7']);
        interpreter.execute(count);
        // A changed arity is checked when the replacement frame is created.
        interpreter.execute('F = count');
        expect(() => interpreter.execute('7 forward')).toThrowError('count expects 2 arguments, got 1');
        expect(lines).toEqual(['7', '7']);
        expect(interpreter.execute('1 0 count')).toBe(1n);
    });

    it('does not eliminate a call with arithmetic remaining after it', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 3 });
        expect(() => interpreter.execute(`
fun down N
  if N equal 0
    return 0
  end
  return (N - 1) down + 1
end
3 down
`)).toThrowError('function call depth exceeds 3');
    });

    it('keeps catches and finally blocks active until the callee finishes', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line));
        expect(interpreter.execute(`
use io
fun visit N
  try
    for N greater 0
      if N greater 0
        return (N - 1) visit
      end
    end
    .Leaf raise
  catch .Leaf Error
    "caught" print
    return 42
  finally
    N print
  end
end
3 visit
`)).toBe(42n);
        expect(lines).toEqual(['caught', '0', '1', '2', '3']);
    });

    it('allows tail calls again after leaving a try block', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 1 });
        expect(interpreter.execute(`
fun down N
  if N equal 0
    return 0
  end
  try
    X = 1
  finally
    X += 1
  end
  for N greater 0
    return (N - 1) down
  end
  return 0
end
10000 down
`)).toBe(0n);
    });

    it('closes a loop iterator after, not before, a returned call', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line));
        expect(interpreter.execute(`
use io
fun values N
  try
    yield N
  finally
    "closed" print
  end
end
fun leaf N
  "called" print
  return N
end
fun outer N
  for V in N values
    return V leaf
  end
  return 0
end
7 outer
`)).toBe(7n);
        expect(lines).toEqual(['called', 'closed']);
    });

    it('keeps owned files open until the returned call has finished', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const events: [string, boolean][] = [];
        const interpreter = new Interpreter(line => events.push([line, io.handles[0].closed]), { io });
        interpreter.execute(`
use io
fun leaf N
  "called" print
  return N
end
fun outer N
  File = "/input" open
  return N leaf
end
7 outer
"after" print
`);
        expect(events).toEqual([['called', false], ['after', true]]);
    });

    it('does not reuse frames across imported interpreter instances', () => {
        const interpreter = new Interpreter(undefined, {
            maxCallDepth: 1,
            loadModule: () => ({ id: 'count.ra', source: count }),
        });
        expect(interpreter.execute(`
use "count.ra" as D
fun forward N
  return N 10 D.count
end
10000 forward
`)).toBe(10010n);
    });

    it('leaves generator return values lazy and restores the caller frame', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 1 });
        interpreter.execute(`
fun values N
  yield N
end
fun forward N
  return N values
end
Values = 7 forward
`);
        const value = interpreter.variables.get('Values');
        if (!value || !isRankSequence(value)) throw new Error('expected sequence');
        expect([...value.plan.iterate()]).toEqual([7n]);
        expect(interpreter.execute(`${count}\n10 0 count`)).toBe(10n);
        interpreter.dispose();
    });
});
