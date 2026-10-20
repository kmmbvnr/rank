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

const backends = [
    ['reference', { generatorLoopCompilation: false, loopYieldCompilation: false }],
    ['generator', { loopYieldCompilation: false }],
    ['integer', {}],
] as const;

describe.each(backends)('generator loops (%s)', (backend, options) => {
    it('sieves with lazy yields and uses the selected execution path', () => {
        const r = new Interpreter(undefined, options);
        const d = new RuntimeDiagnostics();
        try {
            expect(formatValue(d.run(() => r.execute(`${sieve}\n30 sieve array`))!))
                .toBe('2 3 5 7 11 13 17 19 23 29');
            expect(d.compiledGeneratorLoops).toBe(backend === 'generator' ? 1 : 0);
            expect(d.compiledLoops).toBe(backend === 'integer' ? 1 : 0);
            expect(r.execute('200000 sieve 10000')).toBe(104743n);
        } finally { r.dispose(); }
    });

    it('preserves branches, indices, continue, break and nested-loop ownership', () => {
        const r = new Interpreter(undefined, options);
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
        const r = new Interpreter(value => output.push(value), options);
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
        const r = new Interpreter(value => output.push(value), options);
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
        const r = new Interpreter(value => output.push(value), options);
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
        const r = new Interpreter(undefined, options);
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
        const r = new Interpreter(undefined, options);
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
        const r = new Interpreter(undefined, options);
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

it.each([
    ['generator', (enter: () => void) => ({ loopYieldCompilation: false, onGeneratorLoopExecuted: enter })],
    ['integer', (enter: () => void) => ({ onIntegerLoopExecuted: enter })],
] as const)('cancels a compiled %s loop while searching for its next yield', (_, options) => {
    let entered = false;
    const r = new Interpreter(undefined, options(() => { entered = true; }));
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
    const r = new Interpreter(undefined, { onGeneratorLoopExecuted: () => entries++, onIntegerLoopExecuted: () => entries++ });
    try {
        const signal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => 0 };
        expect(withInterrupt(signal, () => r.execute(`${sieve}\n30 sieve 9`), () => {})).toBe(29n);
        expect(entries).toBe(0);
    } finally { r.dispose(); }
});

describe('scalar yields from integer loops', () => {
    function run(source: string, expression: string) {
        const results = backends.map(([, options]) => {
            const r = new Interpreter(undefined, options);
            const d = new RuntimeDiagnostics();
            try {
                d.run(() => r.execute(source));
                let value: string;
                try { value = formatValue(d.run(() => r.execute(expression))!); }
                catch (error) { value = `error: ${(error as Error).message}`; }
                return { value, loops: d.compiledLoops };
            } finally { r.dispose(); }
        });
        expect(results.map(result => result.value)).toEqual(Array(3).fill(results[0].value));
        return results[2];
    }

    it('suspends inside nested loops with break and continue', () => {
        const result = run(`fun values
  for N I in 1 to 6
    if N equal 2
      continue
    elif N equal 5
      break
    end
    yield I
    for J in 1 to 3
      yield N * 10 + J
      if J equal 2
        break
      end
    end
  end
end`, 'values array');
        expect(result.value).toBe('0 11 12 2 31 32 3 41 42');
        expect(result.loops).toBe(1);
    });

    it.each([
        ['Total / 2', '0.5 1.5 3 5'],
        ['Total greater 4', 'false false true true'],
    ])('yields %s with locals updated between yields', (value, expected) => {
        const result = run(`fun values
  Total = 0
  for N in 1 to 4
    Total += N
    yield ${value}
  end
end`, 'values array');
        expect(result.value).toBe(expected);
        expect(result.loops).toBe(1);
    });

    it('stops an abandoned producer and resumes interleaved frames independently', () => {
        const result = run(`fun Limit evens
  for N in 0 to Limit by 2
    yield N
  end
end`, '(1000000000 evens 3) + (10 evens array sum)');
        expect(result.value).toBe('36');
        expect(result.loops).toBe(2);
    });

    it('defers an error until the consumer reaches it', () => {
        expect(run(`fun broken
  for N in 1 to 3
    yield N
    yield N // (2 - N)
  end
end`, 'broken 2').value).toBe('2');
        expect(run(`fun broken
  for N in 1 to 3
    yield N
    yield N // (2 - N)
  end
end`, 'broken array').value).toBe('error: division by zero');
    });

    it('rejects yield outside a generator body the same way', () => {
        expect(run('', `T = 0
for N in 1 to 3
  yield N
end`).value).toMatch(/^error: /);
    });
});
