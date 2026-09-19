import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Interpreter, formatValue } from '../src/index.js';
import { RankError } from '../src/errors.js';
import { TokenInput } from './support.js';

function run(source: string, fused: boolean, input = '') {
    const output: string[] = [];
    let kernels = 0;
    const runtime = new Interpreter(line => output.push(line), {
        tensorFusion: fused,
        onTensorKernelExecuted: () => kernels++,
        input: new TokenInput(input.trim().split(/\s+/)),
    });
    try {
        const result = runtime.execute(source);
        return { value: result === undefined ? undefined : formatValue(result), output, kernels };
    } catch (error) {
        return { error: error instanceof RankError ? error.format() : String(error), output, kernels };
    } finally { runtime.dispose(); }
}
function compare(source: string, input = '') {
    const reference = run(source, false, input);
    const fused = run(source, true, input);
    expect({ ...fused, kernels: 0 }).toEqual({ ...reference, kernels: 0 });
    return fused;
}

// Different names, multiple arithmetic maps, a separate unary statement, and
// all rather than any: this is a pipeline compiler, not a Stick Game rewrite.
const probe = `use sequences
use io
fun probe A B Limit
  Result = false
  for Tick in 1 to 2
    Mask = A less Limit
    Chosen = A Mask
    Scaled = Chosen * 2
    Indices = Scaled - 1
    Gathered = B Indices
    Inverted = not Gathered
    Result = Inverted all
  end
  return Result
end
A = array 1 2 3
B = array true false true false true
A B 3 probe print`;

describe('tensor pipeline fusion', () => {
    it('fuses an independently named pipeline and preserves all', () => {
        expect(compare(probe)).not.toHaveProperty('error');
        expect(compare(probe)).toMatchObject({ output: ['true'], kernels: 2 });
    });
    it('keeps integer arithmetic exact above 2^53', () => {
        const source = probe.replace('A less Limit', 'A greater Limit')
            .replace('Chosen * 2', 'Chosen - 9007199254740993')
            .replace('Scaled - 1', 'Scaled * 1')
            .replace('array 1 2 3', 'array 9007199254740993 9007199254740994')
            .replace('A B 3 probe', 'A B 0 probe');
        expect(compare(source).kernels).toBe(2);
    });
    it('handles an empty selection', () => {
        expect(compare(probe.replace('A B 3 probe', 'A B 0 probe')).kernels).toBe(2);
    });
    it('does not eliminate an intermediate that escapes', () => {
        const source = probe.replace('return Result', 'Gathered print\n  return Result');
        expect(compare(source).kernels).toBe(0);
    });
    it('retains mutation rejection for lazy intermediates', () => {
        const source = probe.replace('Result = Inverted all', 'Result = Inverted all\n    Gathered 0 = false');
        const result = compare(source);
        expect(result.kernels).toBe(0);
        expect('error' in result).toBe(true);
    });
    it('retains preexisting variable types', () => {
        const source = probe.replace('Result = false', 'Mask = 1\n  Result = false');
        const result = compare(source);
        expect(result.kernels).toBe(0);
        expect('error' in result).toBe(true);
    });
    it('retains a global binding with the same name', () => {
        const source = probe.replace('A = array', 'Mask = 1\nA = array');
        expect(compare(source).kernels).toBe(0);
    });
    it('retains custom reduction dispatch', () => {
        const source = probe.replace('fun probe', 'fun all V\n  return false\nend\nfun probe');
        expect(compare(source).kernels).toBe(0);
    });
    it('does not force a lazy input while guarding', () => {
        const source = probe.replace('A B 3 probe', 'A = A + 0\nA B 3 probe');
        expect(compare(source).kernels).toBe(0);
    });
    it('retains missing-module errors at the original statement', () => {
        expect(compare(probe.replace('use sequences\n', '')).kernels).toBe(0);
    });
    it.each([
        ['negative index', 'Scaled - 1', 'Scaled - 5'],
        ['out of range', 'Scaled - 1', 'Scaled + 5'],
        ['nonboolean gathered value', 'true false true false true', 'true false true 7 true'],
        ['noninteger input', 'array 1 2 3', 'array 1 2.5 3'],
    ])('falls back without losing errors: %s', (_, before, after) => {
        const result = compare(probe.replace(before, after));
        expect(result.kernels).toBe(0);
        expect('error' in result).toBe(true);
    });
    it('checks all gathered values even when any already has its answer', () => {
        const source = probe.replace('Inverted all', 'Inverted any')
            .replace('true false true false true', 'true false true 7 true');
        const result = compare(source);
        expect('error' in result).toBe(true);
    });
    it('preserves terminal assignment type errors and their location', () => {
        const result = compare(probe.replace('Result = false', 'Result = 0'));
        expect('error' in result).toBe(true);
        expect(result.kernels).toBe(0);
    });
    it('observes mutations between iterations', () => {
        const source = probe.replace('Result = Inverted all', 'Result = Inverted all\n    B 1 = true');
        expect(compare(source).kernels).toBe(2);
    });
    it('can decline after a successful iteration without replaying effects', () => {
        const source = probe.replace('Result = Inverted all',
            'Result = Inverted all\n    Tick print\n    B 3 = 7');
        const result = compare(source);
        expect(result.kernels).toBe(1);
        expect(result.output).toEqual(['1']);
        expect('error' in result).toBe(true);
    });
    it('declines functions containing nested closures', () => {
        const source = probe.replace('Result = false', 'fun nested\n    return Mask\n  end\n  Result = false');
        expect(compare(source).kernels).toBe(0);
    });
    it.each(['sum', 'mean', 'min', 'max'])('combines named numeric maps with %s', reducer => {
        const source = `use numbers
use stats
use io
fun calculate A B
  Difference = A - B
  Squared = Difference * Difference
  Result = Squared ${reducer}
  return Result
end
A = array 1.0 2.0 3.0
B = array 3.0 2.0 1.0
A B calculate print`;
        const result = compare(source);
        expect(result).not.toHaveProperty('error');
        expect(result.kernels).toBe(1);
    });
    it('combines inline row addressing and a dot product', () => {
        const source = `use numbers
use io
fun rows A X
  Result = 0.0
  for I in 0 until 2
    S = (A I * X) sum
    Result += S
  end
  return Result
end
A = array shape 2 3
  1.0 2.0 3.0
  4.0 5.0 6.0
end
X = array 1.0 1.0 1.0
A X rows print`;
        const result = compare(source);
        expect(result.output).toEqual(['21']);
        expect(result.kernels).toBe(2);
    });
    it('combines top-level inline arithmetic without discarding named values', () => {
        const result = compare('use numbers\nuse io\nA = array 1 2 3\nS = (A * A) sum\nA print\nS print');
        expect(result).not.toHaveProperty('error');
        expect(result.kernels).toBe(1);
    });
    it('preserves floating point order and mixed integer-real promotion', () => {
        const result = compare(`use numbers
use io
A = array 10000000000000000.0 1.0 (-10000000000000000.0)
S = (A + 0) sum
S print`);
        expect(result.output).toEqual(['0']);
        expect(result.kernels).toBe(1);
    });
    it('does not fuse mismatched shapes or broadcasting domains', () => {
        const result = compare('use numbers\nA = array 1 2 3\nB = array 2 3\nS = (A * B) sum');
        expect('error' in result).toBe(true);
        expect(result.kernels).toBe(0);
    });
    it('supports an empty inline sum', () => {
        const result = compare('use numbers\nA = array shape 0 fill 0\nS = (A * 2) sum\nS');
        expect(result.value).toBe('0');
        expect(result.kernels).toBe(1);
    });
    it('keeps empty mean errors', () => {
        const result = compare('use stats\nA = array shape 0 fill 0\nS = (A * 2) mean');
        expect('error' in result).toBe(true);
        expect(result.kernels).toBe(0);
    });
    it('combines a comparison and count', () => {
        const result = compare('use sequences\nA = array 1 2 3\nS = (A greater 1) count\nS');
        expect(result.value).toBe('2');
        expect(result.kernels).toBe(1);
    });
    it('falls back when browser policy prohibits generated functions', () => {
        const source = 'use numbers\nA = array 1 2 3\nS = (A * A) sum\nS';
        const reference = run(source, false);
        const blocked = vi.spyOn(globalThis, 'Function').mockImplementationOnce(() => {
            throw new EvalError('blocked by CSP');
        });
        try {
            const result = run(source, true);
            expect(result).toEqual(reference);
        } finally { blocked.mockRestore(); }
    });
    it('does not accept multidimensional gather selectors', () => {
        const source = `use numbers
fun f A I
  V = A I
  S = (V * 2) sum
  return S
end
A = array 1 2 3
I = array shape 1 2
  0 1
end
A I f`;
        const result = compare(source);
        expect('error' in result).toBe(true);
        expect(result.kernels).toBe(0);
    });
    it('keeps rank and axis dispatch on the reference path', () => {
        const result = compare(`use numbers
A = array shape 2 2
  1 2
  3 4
end
S = (A * 2) sum axis 0
S`);
        expect(result).not.toHaveProperty('error');
        expect(result.kernels).toBe(0);
    });
    it('matches deterministic generated integer and real expression cases', () => {
        let seed = 12345;
        const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
        for (let sample = 0; sample < 30; sample++) {
            const values = Array.from({ length: 9 }, () => (next() % 100 - 50) / (sample % 2 ? 8 : 1));
            const cells = values.map(value => `(${value})`).join(' ');
            const source = `use numbers
use stats
fun f A
  Shifted = A + 3
  Product = Shifted * A
  Result = Product ${sample % 2 ? 'mean' : 'sum'}
  return Result
end
A = array ${cells}
A f`;
            const result = compare(source);
            expect(result).not.toHaveProperty('error');
            expect(result.kernels).toBe(1);
        }
    });
    it.each([['-A ** 2', '-14'], ['(-A) ** 2', '14']])(
        'preserves power/sign precedence: %s', (expression, expected) => {
            const result = compare(`use numbers\nA = array 1 2 3\nS = (${expression}) sum\nS`);
            expect(result).not.toHaveProperty('error');
            expect(result.value).toBe(expected);
            expect(result.kernels).toBe(1);
        });
    it('does not hide scalar errors behind an empty tensor', () => {
        const result = compare('use numbers\nA = array shape 0 fill 0\nS = (A * (1 / 0)) sum');
        expect('error' in result).toBe(true);
        expect(result.kernels).toBe(0);
    });
    it('does not hide scalar errors behind an empty filter', () => {
        const result = compare(`use numbers
fun f A
  Mask = A greater 10
  Selected = A Mask
  Values = (1 / 0) * Selected
  S = Values sum
  return S
end
A = array 1 2 3
A f`);
        expect('error' in result).toBe(true);
        expect(result.kernels).toBe(0);
    });
    it('matches independent DP for unchanged Stick Game, including unsorted moves', () => {
        const source = readFileSync(new URL('../../../demos/cses/math/032_stickgame.ra', import.meta.url), 'utf8');
        for (const moves of [[1], [2, 5], [9, 2, 4], [200], [3, 3, 1], [0, 2]]) {
            const n = 100;
            const wins = Array<boolean>(n + 1).fill(false);
            for (let i = 1; i <= n; i++) wins[i] = moves.some(move => move <= i && !wins[i - move]);
            const result = compare(source, `${n} ${moves.length} ${moves.join(' ')}`);
            expect(result.output).toEqual([wins.slice(1).map(win => win ? 'W' : 'L').join('')]);
            expect(result.kernels).toBe(n);
        }
    });
});


describe('compiled access to completed lazy caches', () => {
    it('keeps a completed round cache valid when a name writes its source', () => {
        const result = compare(`use numbers
A = array 1.2 2.8
R = A round 0
Warm = R sum
A 0 = 100.0
Answer = (R * 2) sum
Answer
`);
        // The write goes to storage of its own, so the completed cache stays
        // valid and the kernel may run over it.
        expect(result.value).toBe('8');
        expect(result.kernels).toBe(1);
    });

    it('does not force a partially cached input to enable compilation', () => {
        const result = compare(`use numbers
A = array 1.2 2.8
R = A round 0
First = R 0
A 1 = 4.1
Answer = (R * 2) sum
Answer
`);
        expect(result.value).toBe('8');
        expect(result.kernels).toBe(0);
    });
});


describe('tensor return terminals', () => {
    it('fuses a named pipeline ending in return', () => {
        const result = compare(`use numbers
fun squares A
  Squared = A * A
  return Squared sum
end
A = array 2 3 4
A squares
`);
        expect(result.value).toBe('29');
        expect(result.kernels).toBe(1);
    });

    it('fuses inline returns and still executes finally', () => {
        const result = compare(`use numbers
use io
fun squares A
  try
    return (A * A) sum
  finally
    "finished" print
  end
end
A = array 2 3 4
A squares
`);
        expect(result.value).toBe('29');
        expect(result.output).toEqual(['finished']);
        expect(result.kernels).toBe(1);
    });

    it.each([
        'use numbers\nA = array 1 2\nreturn (A * A) sum',
        'use numbers\nfun bad A\n  try\n    return 1\n  finally\n    return (A * A) sum\n  end\nend\nA = array 1 2\nA bad',
        'use numbers\nfun bad A\n  yield 1\n  return (A * A) sum\nend\nA = array 1 2\nB = A bad\nB array',
    ])('preserves invalid return diagnostics', source => {
        expect(compare(source)).toHaveProperty('error');
    });

    it('preserves reducer failures at the return statement', () => {
        const result = compare(`use numbers
fun bad A
  return (A / 0) sum
end
A = array 1 2
A bad
`);
        expect(result).toHaveProperty('error');
    });
});

describe('text digits inside tensor kernels', () => {
    const program = `use text
use numbers
use io
fun digits N Power
  Text = N text
  Digits = Text integer rank 0
  Powers = Digits ** Power
  return Powers sum
end
1634 4 digits`;

    it('fuses integer rendering, rank conversion, powers and reduction', () => {
        expect(compare(program)).toMatchObject({ value: '1634', kernels: 1 });
    });

    it('preserves large integer rendering exactly', () => {
        const input = '9007199254740993';
        const expected = [...input].reduce((sum, digit) => sum + BigInt(digit), 0n);
        expect(compare(program.replace('1634 4 digits', `${input} 1 digits`)))
            .toMatchObject({ value: String(expected), kernels: 1 });
    });

    it.each(['""', '"00012"'])('reduces digit text %s', input => {
        const source = `use text
use numbers
fun digits Text
  Digits = Text integer rank 0
  Shifted = Digits + 1
  return Shifted sum
end
${input} digits`;
        expect(compare(source)).toMatchObject({ value: input === '""' ? '0' : '8', kernels: 1 });
    });

    it.each(['-12', '"1😀2"', '"1 2"', '"12\\n"'])('retains conversion errors for %s', input => {
        const source = typeof input === 'string' && input.startsWith('"')
            ? program.replace('Text = N text', 'Text = N').replace('1634 4 digits', `${input} 2 digits`)
            : program.replace('1634 4 digits', `${input} 2 digits`);
        expect(compare(source)).toHaveProperty('error');
    });

    it('retains a user integer function under rank 0', () => {
        const source = program.replace('fun digits N Power', `fun integer X
  return 2
end
fun digits N Power`);
        expect(compare(source)).toMatchObject({ value: '64' });
    });

    it('retains a user text function before the digit pipeline', () => {
        const source = program.replace('fun digits N Power', `fun text X
  return "99"
end
fun digits N Power`);
        expect(compare(source)).toMatchObject({ value: '13122' });
    });

    it('does not remove observable intermediate bindings', () => {
        const source = program.replace('return Powers sum', 'Digits print\n  return Powers sum');
        expect(compare(source)).toMatchObject({ value: '1634', output: ['1 6 3 4'] });
    });
});


it('fuses an inline literal digit conversion and reduction', () => {
    expect(compare(`use text
use numbers
fun answer Unused
  return "1203" integer rank 0 sum
end
0 answer`)).toMatchObject({ value: '6', kernels: 1 });
});
