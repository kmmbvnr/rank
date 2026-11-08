import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue, isRankArray, type InterpreterOptions } from '../src/index.js';
import { withInterrupt, withDemandBudget } from '../src/interrupt.js';
import { native } from '../src/modules/shared.js';

const header = `use numbers
use sequences
fun A curved B
  X = A * 1.5 + B
  Y = X ** 0.5
  Z = X max Y
  return Z + Y
end
`;
function run(source: string, options: InterpreterOptions = {}, replaceMax = false) {
    const d = new RuntimeDiagnostics(), r = new Interpreter(() => {}, options);
    try {
        if (replaceMax) r.variables.set('max', native('replacement', 2, () => 7.0));
        let value: string | undefined, error: string | undefined, zeroSigns: boolean[] | undefined;
        try {
            value = formatValue(d.run(() => r.execute(source))!);
            const cells = r.variables.get('C');
            if (cells && isRankArray(cells)) zeroSigns = cells.items.map(cell => typeof cell === 'number' && Object.is(cell, -0));
        }
        catch (e) { error = e instanceof RankError ? e.format() : String(e); }
        return { value, error, zeroSigns, d };
    } finally { r.dispose(); }
}
function compare(source: string, replaceMax = false) {
    const result = run(source, {}, replaceMax);
    for (const options of [{ compilation: false }, { numberLoopCompilation: false }]) {
        const prior = run(source, options, replaceMax);
        expect({ value: result.value, error: result.error, zeroSigns: result.zeroSigns }).toEqual({ value: prior.value, error: prior.error, zeroSigns: prior.zeroSigns });
    }
    return result;
}
it.each(['array shape 128 fill 2.0', 'array shape 1 fill 2.0', '2.0'])('fuses real arithmetic with broadcast operand %s', operand => {
    const result = compare(header + `A = (1 to 128) * 1.0\nB = ${operand}\nC = A\nfor I in 1 to 3\n C = A curved B\nend\nC`);
    expect(result.error).toBeUndefined(); expect(result.d.numberLoops).toBe(1);
});
it('preserves retained results and both sides of a private reshape alias', () => {
    const result = compare(header + `A = (1 to 128) * 1.0
B = A reshape 16 8
Saved = A
C = A
for I in 1 to 3
 C = A curved 2.0
 if I equal 1
  Saved = C
 end
 A 0 += 1.0
end
tuple Saved C A B`);
    expect(result.error).toBeUndefined(); expect(result.d.numberLoops).toBe(1);
});
it.each([
    'X = A / B\n Y = 1.0 / 0.0\n return X + Y',
    'X = A ** B\n return X + 1.0',
    'X = A * 1.0e308\n return X / 1.0e308',
    'X = A + B\n Unused = A / 0.0\n return X',
])('retains eager errors and finite-domain fallback for %s', body => {
    compare(`use numbers\nuse sequences\nfun A calculation B\n ${body}\nend
A = (1 to 128) * -1.0
B = A * 0.0
C = A
for I in 1 to 3
 C = A calculation B
end
C`);
});
it('does not bypass a replaced native extrema binding', () => {
    const result = compare(header + `A = (1 to 128) * 1.0\nC = A\nfor I in 1 to 3\n C = A curved 2.0\nend\nC`, true);
    expect(result.error).toBeUndefined();
});
it('replays integer intermediates outside the safe Number range', () => {
    const result = compare(`use sequences
fun A scaled Scale
 Square = Scale * Scale
 return A * Square
end
A = (1 to 128) * 1.0
C = A
for I in 1 to 3
 C = A scaled 100000000
end
C`);
    expect(result.error).toBeUndefined();
});

it('normalizes integer zero intermediates before real arithmetic', () => {
    const result = compare(`fun A zeros Scale
 Quotient = Scale // -3
 return A * Quotient
end
A = array (1.0) (-1.0) (0.0) (-0.0)
C = A
for I in 1 to 3
 C = A zeros 0
end
C`);
    expect(result.error).toBeUndefined(); expect(result.d.numberLoops).toBe(1);
});
it.each(['min', 'max'])('retains real signed-zero tie selection with %s', operation => {
    const result = compare(`use numbers
fun A extremes B
 Z = A ${operation} B
 return Z * 1.0
end
A = array (0.0) (-0.0) (1.0) (-1.0)
B = array (-0.0) (0.0) (1.0) (-1.0)
C = A
for I in 1 to 3
 C = A extremes B
end
C`);
    expect(result.error).toBeUndefined(); expect(result.d.numberLoops).toBe(1);
});

it.each(['1', '1.0', 'true'])('publishes each private reshape with its own dimensions (%s)', fill => {
    for (const options of [{}, { compilation: false }]) {
        const r = new Interpreter(() => {}, options);
        try {
            r.execute(`use sequences
A = array shape 6 fill ${fill}
B = array shape 2 3 fill ${fill}
C = array shape 3 2 fill ${fill}
for I in 1 to 3
 B = A reshape 2 3
 C = B reshape 3 2
end`);
            for (const [name, shape] of [['A', [6]], ['B', [2, 3]], ['C', [3, 2]]] as const) {
                const value = r.variables.get(name);
                expect(value && isRankArray(value) && value.shape).toEqual(shape);
            }
            r.execute(`B 0 0 = ${fill === 'true' ? 'false' : fill === '1' ? '9' : '9.0'}`);
            expect(r.execute('A 0')).toBe(fill === 'true' ? true : fill === '1' ? 1n : 1);
            expect(r.execute('C 0 0')).toBe(fill === 'true' ? true : fill === '1' ? 1n : 1);
        } finally { r.dispose(); }
    }
});

it('retains a non-real power error and its ordinary call location', () => {
    compare(`fun A roots B
 X = A ** 0.5
 return X + B
end
A = (1 to 128) * -1.0
C = A
for I in 1 to 3
 C = A roots 0.0
end
C`);
});
it.each([0, 1, 128])('retains empty and singleton real broadcasts at size %s', size => {
    const result = compare(header + `A = array shape ${size} fill 4.0\nB = array shape 1 fill 2.0\nC = A\nfor I in 1 to 3\n C = A curved B\nend\nC`);
    expect(result.error).toBeUndefined();
});

it.each(['cancellation', 'budget'])('can accelerate the same helper after an observed %s run', mode => {
    const r = new Interpreter(() => {});
    const body = `A = (1 to 128) * 1.0
C = A
for I in 1 to 3
 C = A curved 2.0
end
C`;
    try {
        r.execute(header);
        const d = new RuntimeDiagnostics();
        const observed = () => d.run(() => r.execute(body));
        const value = mode === 'cancellation'
            ? withInterrupt(new Int32Array(new SharedArrayBuffer(4)), observed)
            : withDemandBudget(1000000, observed);
        const expected = formatValue(value!);
        expect(d.numberLoops).toBe(0);
        const fast = new RuntimeDiagnostics();
        expect(formatValue(fast.run(() => r.execute(body))!)).toBe(expected);
        expect(fast.numberLoops).toBe(1);
    } finally { r.dispose(); }
});

it.each([
    ['4 1', '1 7'], ['4 7', '7'], ['1 7', '4 1'],
    ['4 7', '4 7'], ['0 1', '1 7'], ['4 0', '0'],
    ['4 1', '1'], ['1 1', '4 7'],
])('broadcasts real helper dimensions %s with %s', (left, right) => {
    const result = compare(header + `A = array shape ${left} fill 2.0
B = array shape ${right} fill 3.0
C = A curved B
Saved = C
for I in 1 to 3
 C = A curved B
end
tuple Saved C A B`);
    expect(result.error).toBeUndefined(); expect(result.d.numberLoops).toBe(1);
});
it.each([['4 3', '2'], ['0 3', '2'], ['2 3', '4 1']])('preserves shape errors for %s and %s', (left, right) => {
    const result = compare(header + `A = array shape ${left} fill 2.0
B = array shape ${right} fill 3.0
C = A
for I in 1 to 3
 C = A curved B
end
C`);
    expect(result.error).toMatch(/shape mismatch/);
});
it('keeps broadcast results independent after reuse and mutation', () => {
    const result = compare(header + `A = array shape 4 1 fill 2.0
B = array shape 7 fill 3.0
C = array shape 4 7 fill 0.0
Saved = C
for I in 1 to 3
 C = A curved B
 if I equal 1
  Saved = C
 end
 A 0 0 += 1.0
 B 0 += 1.0
end
C 0 0 = -1.0
tuple Saved C A B`);
    expect(result.error).toBeUndefined(); expect(result.d.numberLoops).toBe(1);
});
it('broadcasts a shared intermediate before a differently shaped consumer', () => {
    const result = compare(`use sequences
fun A combine B
 X = A + 1.0
 Y = -X
 return X + Y * B
end
A = array shape 4 1 fill 2.0
B = (1 to 7) * 1.0
C = array shape 4 7 fill 0.0
for I in 1 to 3
 C = A combine B
end
C`);
    expect(result.error).toBeUndefined(); expect(result.d.numberLoops).toBe(1);
});
