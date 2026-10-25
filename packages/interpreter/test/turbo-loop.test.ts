import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { InterruptedError, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { RankDeque } from '../src/containers.js';

function execute(source: string, turbo = true, cancel = false, configure?: (runtime: Interpreter) => void) {
    let switched = false, loops = 0;
    const runtime = new Interpreter(undefined, { onIntegerLoopExecuted: () => loops++ });
    configure?.(runtime);
    const words = [0, turbo ? 1 : 0, 0];
    const signal: InterruptSignal = {
        length: 3,
        load(index) {
            if (cancel && loops > 0) words[0] = 1;
            return words[index];
        },
        store(index, value) { words[index] = value; },
        exchange(index, value) { const previous = this.load(index); words[index] = value; return previous; },
        wait() { throw new Error('Unexpected debugger pause'); },
    };
    let error: unknown, value: unknown;
    try {
        value = withInterrupt(signal, () => runtime.execute(source), pause => {
            if (switched) throw new Error('Paused after entering Turbo');
            switched = /\bI = 3\b/.test(pause.state ?? '');
            words[1] = 0;
            words[2] = switched ? 5 : 2;
        });
    } catch (caught) { error = caught; }
    const variables = new Map([...runtime.variables].map(([name, value]) => [name, formatValue(value)]));
    runtime.dispose();
    return { value, error, variables, switched, loops };
}

function compare(source: string) {
    const reference = execute(source, false), turbo = execute(source);
    expect(reference.error).toBeUndefined();
    expect(turbo.error).toBeUndefined();
    expect(turbo.switched).toBe(true);
    expect(turbo.value).toEqual(reference.value);
    expect(turbo.variables).toEqual(reference.variables);
    return turbo;
}

describe('compiling the remainder of a running loop on Turbo', () => {
    it.each(['1 to End', 'End to 1 by -1', '1 till End', 'End till 1 by -1'])(
        'preserves captured bounds, order and indices: %s', range => {
            const result = compare(`End = 8
Values = 0
Indices = 0
for I k in ${range}
  Values = Values * 10 + I
  Indices = Indices * 10 + k
  End = 3
end
Values`);
            expect(result.loops).toBe(1);
        });

    it('does not repeat assignments already executed in the current iteration', () => {
        const result = compare(`Count = 0
Total = 0
for I in 1 to 10
  Count += 1
  Total += I
  I = 100
end
Total`);
        expect(result.variables.get('Count')).toBe('10');
        expect(result.value).toBe(55n);
        expect(result.loops).toBe(1);
    });

    it.each(['break', 'continue'])('retains the previous result when the remainder only exits with %s', control => {
        const result = compare(`Total = 0
for I in 1 to 4
  if I equal 4
    ${control}
  end
  Total += I
end`);
        expect(result.value).toBe(6n);
        expect(result.loops).toBe(1);
    });

    it('retains a condition loop result when its first compiled iteration breaks', () => {
        const result = compare(`I = 0
for I less 8
  if I equal 3
    break
  end
  I += 1
end`);
        expect(result.value).toBe(3n);
        expect(result.loops).toBe(1);
    });

    it('preserves break and continue in the compiled remainder', () => {
        const result = compare(`Total = 0
for I in 1 to 20
  if I equal 5
    continue
  end
  if I equal 8
    break
  end
  Total += I
end
Total`);
        expect(result.value).toBe(23n);
        expect(result.loops).toBe(1);
    });

    it('compiles the rest of a condition loop using its current bindings', () => {
        const result = compare(`I = 0
Total = 0
for I less 10
  I += 1
  Total += I
end
Total`);
        expect(result.value).toBe(55n);
        expect(result.loops).toBe(1);
    });

    it('preserves the last result when Turbo reaches an exhausted condition loop', () => {
        const result = compare(`I = 0
Total = 0
for I less 3
  I += 1
  Total += I
end`);
        expect(result.value).toBe(6n);
        expect(result.loops).toBe(0);
    });

    it('does not repeat an effectful condition at the handoff', () => {
        const result = compare(`use algo
Q = new queue (array 1 2 3 4 0)
I = 0
Total = 0
for Q pop greater 0
  I += 1
  Total += I
end
Total`);
        expect(result.value).toBe(10n);
        expect(result.loops).toBe(1);
    });

    it.each(['break', 'error', 'exhaustion'])('closes a transferred iterator once: %s', ending => {
        let closes = 0;
        const result = execute(`Total = 0
for I in Q
  Total += I
  ${ending === 'break' ? 'if I equal 6\n    break\n  end' : ending === 'error' ? 'Bad = 10 // (6 - I)' : ''}
end
Total`, true, false, runtime => {
            const queue = new RankDeque();
            for (let i = 1n; i <= 8n; i++) queue.push(i);
            const values = queue.values.bind(queue);
            queue.values = () => {
                const iterator = values();
                return {
                    [Symbol.iterator]() { return this; },
                    next: () => iterator.next(),
                    return() { closes++; return iterator.return!(); },
                };
            };
            runtime.variables.set('Q', queue);
        });
        expect(result.switched).toBe(true);
        expect(result.loops).toBe(1);
        expect(closes).toBe(ending === 'exhaustion' ? 0 : 1);
        if (ending === 'error') expect(String(result.error)).toContain('division by zero');
        else expect(result.error).toBeUndefined();
    });

    it('resumes a yielding loop without losing or repeating items', () => {
        const result = compare(`use sequences
fun N values
  for I in 1 to N
    yield I
  end
end
8 values array`);
        expect(formatValue(result.value as Parameters<typeof formatValue>[0])).toBe('1 2 3 4 5 6 7 8');
        expect(result.loops).toBe(1);
    });

    it('returns from the function containing the resumed loop', () => {
        const result = compare(`fun N total
  Sum = 0
  for I in 1 to N
    Sum += I
    if I equal 6
      return Sum
    end
  end
  return 0
end
10 total`);
        expect(result.value).toBe(21n);
        expect(result.loops).toBe(1);
    });

    it('keeps the original array traversal when its binding is replaced', () => {
        const result = compare(`A = array 1 2 3 4 5 6
Total = 0
for I k in A
  Total += I * (k + 1)
  A = array 8 9
end
Total`);
        expect(result.value).toBe(91n);
        // The compiled remainder retains the original traversal snapshot.
        expect(result.loops).toBe(1);
    });

    it('preserves text traversal and the index after switching', () => {
        const result = compare(`Text = "abcdef"
I = 0
Result = ""
for Letter k in Text
  I += 1
  Result = Result + Letter
end
Result`);
        expect(result.value).toBe('abcdef');
        expect(result.loops).toBe(1);
    });

    it('retains the reference path when the body cannot compile', () => {
        const result = compare(`Total = 0
for I in 1 to 6
  try
    Total += I
  finally
    Total += 10
  end
end
Total`);
        expect(result.value).toBe(81n);
        expect(result.loops).toBe(0);
    });

    it('preserves partial writes and source locations on an error', () => {
        const source = `Total = 0
for I in 1 to 8
  Total += I
  Bad = 10 // (6 - I)
end`;
        const reference = execute(source, false), turbo = execute(source);
        expect(turbo.loops).toBe(1);
        expect(turbo.error).toBeInstanceOf(Error);
        expect(String(turbo.error)).toEqual(String(reference.error));
        expect((turbo.error as { location: unknown }).location).toEqual((reference.error as { location: unknown }).location);
        expect(turbo.variables).toEqual(reference.variables);
    });

    it('still cancels after the running loop enters the compiled remainder', () => {
        const result = execute(`Total = 0
for I in 1 to 100000
  Total += I
end`, true, true);
        expect(result.switched).toBe(true);
        expect(result.loops).toBe(1);
        expect(result.error).toBeInstanceOf(InterruptedError);
        expect(BigInt(result.variables.get('Total')!)).toBeLessThan(5000050000n);
        expect(BigInt(result.variables.get('Total')!)).toBeGreaterThan(6n);
    });
});
