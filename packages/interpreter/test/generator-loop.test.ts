import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankSequence } from '../src/index.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

const sieve = `fun Limit sieve
  Marked = array shape (Limit + 1) fill false
  for P in 2 to Limit
    if not Marked P
      yield P
      Marked (P * P to Limit by P) = true
    end
  end
end`;

describe.each([false, true])('generator loops (compiled=%s)', generatorLoopCompilation => {
    it('sieves with lazy yields and uses the selected execution path', () => {
        const r = new Interpreter(undefined, { generatorLoopCompilation });
        const d = new RuntimeDiagnostics();
        try {
            expect(formatValue(d.run(() => r.execute(`${sieve}\n30 sieve array`))!))
                .toBe('2 3 5 7 11 13 17 19 23 29');
            expect(d.compiledGeneratorLoops).toBe(generatorLoopCompilation ? 1 : 0);
            expect(r.execute('200000 sieve 10000')).toBe(104743n);
        } finally { r.dispose(); }
    });

    it('preserves branches, indices, continue, break and nested-loop ownership', () => {
        const r = new Interpreter(undefined, { generatorLoopCompilation });
        try {
            expect(formatValue(r.execute(`fun values
  for N I in 1 to 6
    if N equal 2
      continue
    elif N equal 5
      break
    else
      yield I
    end
    for J in 1 to 2
      yield N * 10 + J
      break
    end
  end
end
values array`)!)).toBe('0 11 2 31 3 41');
        } finally { r.dispose(); }
    });

    it('does not execute after an abandoned yield, and closes protected blocks', () => {
        const output: string[] = [];
        const r = new Interpreter(value => output.push(value), { generatorLoopCompilation });
        try {
            expect(r.execute(`use io
fun values
  try
    for N in 1 to 3
      yield N
      "resumed" print
    end
  finally
    "closed" print
  end
end
values 0`)).toBe(1n);
            expect(output).toEqual(['closed']);
        } finally { r.dispose(); }
    });

    it('unwinds continue and break through finally before the next iteration', () => {
        const output: string[] = [];
        const r = new Interpreter(value => output.push(value), { generatorLoopCompilation });
        try {
            expect(formatValue(r.execute(`use io
fun values
  for N in 1 to 4
    yield N
    try
      if N equal 2
        break
      end
      continue
    finally
      N print
    end
    yield 99
  end
end
values array`)!)).toBe('1 2');
            expect(output).toEqual(['1', '2']);
        } finally { r.dispose(); }
    });

    it('closes a generator used as the loop source when the consumer stops', () => {
        const output: string[] = [];
        const r = new Interpreter(value => output.push(value), { generatorLoopCompilation });
        try {
            expect(r.execute(`use io
fun source
  try
    for N in 1 to 3
      yield N
    end
  finally
    "source closed" print
  end
end
fun values
  for N in source
    yield N * 2
  end
end
values 0`)).toBe(2n);
            expect(output).toEqual(['source closed']);
        } finally { r.dispose(); }
    });

    it('preserves yielded array values and observes writes after resuming', () => {
        const r = new Interpreter(undefined, { generatorLoopCompilation });
        try {
            expect(formatValue(r.execute(`fun values
  A = array shape 2 fill false
  for I in 0 to 1
    yield A
    A (0 to I) = true
  end
end
values array`)!)).toBe('false false true false');
        } finally { r.dispose(); }
    });

    it('retains deferred errors and generator return validation', () => {
        const r = new Interpreter(undefined, { generatorLoopCompilation });
        try {
            r.execute(`fun values
  for N in 1 to 3
    yield N
    return 99
  end
end`);
            expect(r.execute('values 0')).toBe(1n);
            expect(() => r.execute('values array')).toThrow('a generator cannot return a value');
            r.execute(`fun broken
  for N in 1 to 3
    yield N
    yield 1 // 0
  end
end`);
            expect(r.execute('broken 0')).toBe(1n);
            expect(() => r.execute('broken array')).toThrow('division by zero');
        } finally { r.dispose(); }
    });

    it('keeps separate invocation frames when iterators are interleaved', () => {
        const r = new Interpreter(undefined, { generatorLoopCompilation });
        try {
            r.execute(sieve);
            const left = r.execute('10 sieve'), right = r.execute('20 sieve');
            if (!left || !isRankSequence(left) || !right || !isRankSequence(right)) throw Error('expected sequences');
            const a = left.plan.iterate(), b = right.plan.iterate();
            expect(a.next().value).toBe(2n);
            expect(b.next().value).toBe(2n);
            expect(a.next().value).toBe(3n);
            expect(b.next().value).toBe(3n);
            expect([...a]).toEqual([5n, 7n]);
            expect([...b]).toEqual([5n, 7n, 11n, 13n, 17n, 19n]);
        } finally { r.dispose(); }
    });
});

it('cancels a compiled generator while searching for its next yield', () => {
    let entered = false;
    const r = new Interpreter(undefined, { onGeneratorLoopExecuted: () => { entered = true; } });
    try {
        r.execute(`fun values
  for N in 1 to 1000000
    if N greater 999999
      yield N
    end
  end
end`);
        const signal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => entered ? 1 : 0 };
        expect(() => withInterrupt(signal, () => r.execute('values 0'))).toThrow(InterruptedError);
        expect(entered).toBe(true);
        expect(r.execute('2 + 3')).toBe(5n);
    } finally { r.dispose(); }
});

it('keeps inspected generator loops on the reference path', () => {
    let entries = 0;
    const r = new Interpreter(undefined, { onGeneratorLoopExecuted: () => entries++ });
    try {
        const signal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => 0 };
        expect(withInterrupt(signal, () => r.execute(`${sieve}\n30 sieve 9`), () => {})).toBe(29n);
        expect(entries).toBe(0);
    } finally { r.dispose(); }
});
