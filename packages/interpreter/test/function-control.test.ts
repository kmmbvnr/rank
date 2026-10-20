import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function run(source: string, directFunctionControl: boolean, compilation: boolean) {
    const output: string[] = [];
    const runtime = new Interpreter(value => output.push(value), { directFunctionControl, compilation });
    try { return { value: formatValue(runtime.execute(source)!), output }; }
    catch (error) { return { error: error instanceof RankError ? error.format() : String(error), output }; }
    finally { runtime.dispose(); }
}

const programs = [
    `fun N count
  if N equal 0
    return false
  end
  return (N - 1) count
end
100 count`,
    `fun N count
  if N equal 0
    return 0
  end
  Value = (N - 1) count
  return Value + 1
end
100 count`,
    `fun pick
  for I in 1 to 3
    for J in 1 to 3
      if J equal 2
        return I + J
      end
    end
    return 99
  end
  return 0
end
pick`,
    `use io
fun N pick
  try
    if N greater 0
      return false
    end
    Bad = 1 // 0
  catch Error
    return false
  finally
    "closed" print
  end
end
array (1 pick) (0 pick)`,
    `use io
fun values
  try
    yield 1
    yield 2
  finally
    "iterator closed" print
  end
end
fun X leaf
  "called" print
  return X
end
fun pick
  for Value in values
    return Value leaf
  end
  return 0
end
pick`,
    `fun fail
  try
    return 1 // 0
  finally
    Bad = 2 // 0
  end
end
fail`,
    `fun missing
  X = 1
end
missing`,
];

describe.each([false, true])('function control parity (compilation=%s)', compilation => {
    it.each(programs.map((source, index) => ({ source, fails: index >= 5 })))('preserves returns, cleanup and errors for $source', ({ source, fails }) => {
        const reference = run(source, false, compilation);
        if (fails) expect(reference).toHaveProperty('error');
        else expect(reference).not.toHaveProperty('error');
        expect(run(source, true, compilation)).toEqual(reference);
    });
});

it.each([false, true])('retains one logical frame for uncompiled tail calls (direct=%s)', directFunctionControl => {
    const runtime = new Interpreter(undefined, { compilation: false, directFunctionControl, maxCallDepth: 1 });
    try { expect(runtime.execute(programs[0])).toBe(false); }
    finally { runtime.dispose(); }
});
