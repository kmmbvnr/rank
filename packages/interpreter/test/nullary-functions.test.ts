import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction, isRankSequence } from '../src/index.js';
import { MemoryIo } from './support.js';

const generator = `fun tst
  yield 1
  yield 2
  yield 3
end`;

for (const compiled of [true, false]) describe(`nullary calls (compiled: ${compiled})`, () => {
    function runtime(options = {}) {
        return new Interpreter(() => {}, {
            scalarCompilation: compiled, scalarEntryCompilation: compiled,
            scalarFunctionCompilation: compiled, blockCompilation: compiled,
            integerLoopCompilation: compiled, tensorFusion: compiled, ...options,
        });
    }
    function run(source: string) {
        const interpreter = runtime();
        try { return formatValue(interpreter.execute(source)!); }
        finally { interpreter.dispose(); }
    }

    it('evaluates names in assignments, arithmetic, comparisons and postfix calls', () => {
        const definition = 'use numbers\nfun nine\n return 9\nend\n';
        expect(run(definition + 'nine')).toBe('9');
        expect(run(definition + 'A = nine\nA + nine * 2')).toBe('27');
        expect(run(definition + '2 + nine sqrt')).toBe(String(Math.sqrt(11)));
        expect(run(definition + 'nine sqrt + nine')).toBe('12');
        expect(run(definition + 'nine equal nine')).toBe('true');
        expect(run(definition + 'array nine (nine + 1)')).toBe('9 10');
        expect(run(definition + 'fun relay\n return nine\nend\nrelay')).toBe('9');
        expect(run('A = nine\nfun nine\n return 9\nend\nA')).toBe('9');
    });

    it('creates fresh generators and keeps assigned instances single-pass', () => {
        const interpreter = runtime();
        try {
            interpreter.execute(`use sequences\nuse numbers\n${generator}`);
            const first = interpreter.execute('tst');
            const second = interpreter.execute('tst');
            expect(isRankSequence(first!)).toBe(true);
            expect(second).not.toBe(first);
            expect(formatValue(first!)).toBe('1 2 3');
            expect(formatValue(second!)).toBe('1 2 3');
            expect(interpreter.execute('tst sum')).toBe(6n);
            expect(interpreter.execute('tst 1')).toBe(2n);
            interpreter.execute('G = tst');
            expect(formatValue(interpreter.execute('G array')!)).toBe('1 2 3');
            expect(() => interpreter.execute('G array')).toThrow('already been consumed');
            expect(interpreter.execute(`G = tst
Mask = G multiple by 2 or G multiple by 3
G Mask sum`)).toBe(5n);
            expect(() => interpreter.execute('tst multiple by 2 or tst multiple by 3'))
                .toThrow('cannot combine masks from different sequences');
        } finally { interpreter.dispose(); }
    });

    it('uses nullary results as selectors and independent operands', () => {
        expect(run(`use numbers
fun pos
 return 1
end
A = array 4 9
2 + A pos sqrt`)).toBe(String(Math.sqrt(11)));
        expect(run(`use numbers
fun values
 return array 1 2 3
end
values * values sum`)).toBe('14');
        expect(run(`use numbers
${generator}
G = tst
A = G multiple by 2
G A sum`)).toBe('2');
    });

    it('preserves lexical captures, order and one evaluation per occurrence', () => {
        expect(run(`fun exercise N
  Count = 0
  fun next
    Count += 1
    return Count
  end
  A = next + next * next
  return array A Count
end
0 exercise`)).toBe('7 3');
        expect(run(`fun exercise N
  Count = 0
  memo once
    Count += 1
    return Count
  end
  A = once + once
  return array A Count
end
0 exercise`)).toBe('2 1');
    });

    it('keeps calls stack-safe and honors the depth limit', () => {
        const source = `fun exercise N
  fun down
    if N equal 0
      return 0
    end
    N -= 1
    return down + 1
  end
  return down
end`;
        expect(run(source + '\n10000 exercise')).toBe('10000');
        const interpreter = runtime({ maxCallDepth: 20 });
        try {
            expect(() => interpreter.execute(source + '\n100 exercise')).toThrow('function call depth exceeds 20');
            expect(interpreter.execute('3 exercise')).toBe(3n);
        } finally { interpreter.dispose(); }
    });

    it('supports imports and functions supplied dynamically by the host', () => {
        const interpreter = runtime({ loadModule: () => ({ id: 'source.ra', source: generator }) });
        try {
            expect(formatValue(interpreter.execute('use "source.ra" as M\nM.tst')!)).toBe('1 2 3');
            interpreter.execute('fun read F\n return F + 1\nend\nfun answer\n return 41\nend');
            const read = interpreter.variables.get('read')!;
            const answer = interpreter.variables.get('answer')!;
            if (!isNativeFunction(read)) throw new Error('expected function');
            expect(read.call([answer])).toBe(42n);
        } finally { interpreter.dispose(); }
    });

    it('runs finally on errors and transfers returned resources to the caller', () => {
        const output: string[] = [];
        const io = new MemoryIo({ 'data.txt': 'abc' });
        const interpreter = new Interpreter(line => output.push(line), { io, persistentResources: true });
        try {
            interpreter.execute(`use io
fun source
  return "data.txt" open
end
F = source`);
            expect(io.handles[0].closed).toBe(false);
            expect(formatValue(interpreter.execute('F 3 readbytes')!)).toBe('0x616263');
            expect(() => interpreter.execute(`fun fail
  try
    return 1 // 0
  finally
    "closed" print
  end
end
fail`)).toThrow('division by zero');
            expect(output).toEqual(['closed']);
            expect(interpreter.execute('1 + 2')).toBe(3n);
        } finally { interpreter.dispose(); }
        expect(io.handles[0].closed).toBe(true);
    });

    it('leaves functions with operands and built-in sequence identity intact', () => {
        const interpreter = runtime();
        try {
            expect(isNativeFunction(interpreter.execute('use numbers\nuse sequences\nsqrt')!)).toBe(true);
            expect(interpreter.execute('fibonacci')).toBe(interpreter.execute('fibonacci'));
            expect(run(`use numbers
use sequences
Fibs = fibonacci multiple by 5 or fibonacci multiple by 3
(fibonacci Fibs) until 1000 sum`)).toBe('1825');
        } finally { interpreter.dispose(); }
    });
});
