import { describe, expect, it } from 'vitest';
import { Interpreter, isRankSequence } from '../src/index.js';
import { MemoryIo } from './support.js';

const count = `
fun N count Total
  if N equal 0
    return Total
  end
  return (N - 1) count (Total + 1)
end
`;

describe('tail calls', () => {
    it('runs a million tail calls with a one-frame call budget', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 1 });
        expect(interpreter.execute(`${count}\n1000000 count 0`)).toBe(1000000n);
        expect(interpreter.execute('1 count 10')).toBe(11n);
    }, 30_000);

    it('replaces frames for mutual recursion and parenthesized returns', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 1 });
        expect(interpreter.execute(`
fun N even
  if N equal 0
    return true
  end
  return ((N - 1) odd)
end
fun N odd
  if N equal 0
    return false
  end
  return (N - 1) even
end
100001 odd
`)).toBe(true);
    });

    it('preserves a read-only capture during a nested tail call', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 1 });
        try {
            expect(interpreter.execute(`fun N outer
  fun X capture
    return N + X
  end
  return 3 capture
end
7 outer`)).toBe(10n);
        } finally { interpreter.dispose(); }
    });

    it('retains postfix effects and the dynamically selected terminal function', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line), { maxCallDepth: 1 });
        expect(interpreter.execute(`
use io
fun X identity
  return X
end
f = identity
fun N forward
  return N print f
end
7 forward
`)).toBe(7n);
        expect(lines).toEqual(['7']);
        interpreter.execute(count);
        // A changed arity is checked when the replacement frame is created.
        interpreter.execute('f = count');
        expect(() => interpreter.execute('7 forward')).toThrowError('count expects 2 arguments, got 1');
        expect(lines).toEqual(['7', '7']);
        expect(interpreter.execute('1 count 0')).toBe(1n);
    });

    it('does not eliminate a call with arithmetic remaining after it', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 3 });
        expect(() => interpreter.execute(`
fun N down
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
fun N visit
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
fun N down
  if N equal 0
    return 0
  end
  X = 0
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
fun N values
  try
    yield N
  finally
    "closed" print
  end
end
fun N leaf
  "called" print
  return N
end
fun N outer
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
fun N leaf
  "called" print
  return N
end
fun N outer
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
fun N forward
  return N D.count 10
end
10000 forward
`)).toBe(10010n);
    });

    it('leaves generator return values lazy and restores the caller frame', () => {
        const interpreter = new Interpreter(undefined, { maxCallDepth: 1 });
        interpreter.execute(`
fun N values
  yield N
end
fun N forward
  return N values
end
Values' = 7 forward
`);
        const value = interpreter.variables.get('Values');
        if (!value || !isRankSequence(value)) throw new Error('expected sequence');
        expect([...value.plan.iterate()]).toEqual([7n]);
        expect(interpreter.execute(`${count}\n10 count 0`)).toBe(10n);
        interpreter.dispose();
    });
});
