import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { native } from '../src/modules/shared.js';

const cases = [
    {
        name: 'nearest loop, branches and skipped statements',
        source: `Total = 0
for I in 1 to 3
  J = 0
  for J less 5
    J += 1
    if J equal 1
      continue
      Unknown
    elif J equal 4
      break
    else
      Total += I * J
    end
  end
  if I equal 2
    continue
  end
  Total += 100
end
Total`, expected: '230',
    },
    {
        name: 'branches after suspended function calls',
        source: `fun odd N
  return N % 2 equal 1
end
Total = 0
for I in 1 to 5
  if I odd
    continue
  end
  Total += I
end
Total`, expected: '6',
    },
    {
        name: 'protected continue and break run finally without reaching catch',
        source: `Total = 0
for I in 1 to 4
  try
    if I equal 3
      break
    end
    continue
  catch Error
    Total += 1000
  finally
    Total += I
  end
  Unknown
end
Total`, expected: '6',
    },
    {
        name: 'a loop inside try consumes its own jump before finally',
        source: `Total = 0
for I in 1 to 3
  try
    for J in 1 to 3
      if J equal 2
        break
      end
      Total += 1
    end
  finally
    Total += 10
  end
  continue
  Unknown
end
Total`, expected: '33',
    },
    {
        name: 'yield resumes, continue skips and break closes the generator',
        source: `use io
fun values
  try
    for I in 1 to 5
      yield I
      if I equal 2
        continue
      end
      I print
    end
  finally
    "closed" print
  end
end
Total = 0
for N in values
  Total += N
  if N equal 3
    break
  end
end
Total`, expected: '6', output: ['1', 'closed'],
    },
    {
        name: 'a jump does not overwrite the last completed iteration result',
        source: `for I in 1 to 4
  if I equal 3
    continue
  end
  if I equal 4
    break
  end
  I
end`, expected: '2',
    },
];

for (const blockCompilation of [false, true]) {
    for (const loopPreparation of [false, true]) {
        for (const directLoopControl of [false, true]) {
            describe(`loop control: direct=${directLoopControl}, blocks=${blockCompilation}, prepared=${loopPreparation}`, () => {
                const options = { blockCompilation, loopPreparation, directLoopControl,
                    integerLoopCompilation: false, scalarFunctionCompilation: false,
                    functionBodyCompilation: false };

                it.each(cases)('$name', ({ source, expected, output = [] }) => {
                    const lines: string[] = [];
                    const runtime = new Interpreter(line => lines.push(line), options);
                    try {
                        expect(formatValue(runtime.execute(source)!)).toBe(expected);
                        expect(lines).toEqual(output);
                    } finally { runtime.dispose(); }
                });

                it('rejects jumps across a function boundary and inside finally', () => {
                    for (const jump of ['break', 'continue']) {
                        const runtime = new Interpreter(undefined, options);
                        try {
                            expect(() => runtime.execute(`fun escape\n ${jump}\nend\nfor\n escape\nend`))
                                .toThrow(`${jump} is only valid inside a for loop`);
                            expect(() => runtime.execute(`for\n try\n  break\n finally\n  ${jump}\n end\nend`))
                                .toThrow(`${jump} is not valid inside finally`);
                            expect(runtime.execute('7')).toBe(7n);
                        } finally { runtime.dispose(); }
                    }
                });

                it('remains interruptible in a loop that only continues', () => {
                    const flag = new Int32Array(new SharedArrayBuffer(4));
                    const runtime = new Interpreter(undefined, options);
                    let calls = 0;
                    runtime.variables.set('tick', native('tick', 0, () => {
                        if (++calls === 3) Atomics.store(flag, 0, 1);
                        return 0n;
                    }));
                    try {
                        expect(() => withInterrupt(flag, () => runtime.execute('for\n tick\n continue\nend')))
                            .toThrow(InterruptedError);
                        expect(calls).toBe(3);
                        expect(runtime.execute('7')).toBe(7n);
                    } finally { runtime.dispose(); }
                });
            });
        }
    }
}
