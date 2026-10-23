import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, isRankArray } from '../src/index.js';

function run(source: string, realLoopCompilation: boolean) {
    const diagnostics = new RuntimeDiagnostics();
    const output: string[] = [];
    const runtime = new Interpreter(text => output.push(text), { scalarEntryCompilation: false, realLoopCompilation });
    try {
        let result: string | undefined, error: string | undefined;
        try {
            const value = diagnostics.run(() => runtime.execute(source));
            result = value === undefined ? undefined : formatValue(value);
        } catch (caught) { error = caught instanceof RankError ? caught.format() : String(caught); }
        // Keep the sign of zero, which formatted values would hide.
        const values = [...runtime.variables].filter(([, value]) => typeof value !== 'object' || isRankArray(value))
            .map(([name, value]) => [name, typeof value === 'number' && Object.is(value, -0) ? '-0' : formatValue(value)]);
        return { result, error, output, values, loops: diagnostics.compiledLoops, fallbacks: { ...diagnostics.fallbacks } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = run(source, false), compiled = run(source, true);
    expect(reference.loops).toBe(0);
    expect({ ...compiled, loops: 0, fallbacks: {} }).toEqual({ ...reference, loops: 0, fallbacks: {} });
    return compiled;
}

describe('real arithmetic in compiled loops', () => {
    it.each([
        ['mixed arithmetic', 'S = 0.0\nfor I in 1 to 10\n S += I / 3\n S = S * 1.5 - I\nend\nS'],
        ['integer division gives a real', 'S = 0.0\nfor I in 1 to 6\n S = I / 4\nend\nS'],
        ['compound update with an integer', 'S = 0.5\nfor I in 1 to 4\n S += 1\n S *= I\n S /= 2\nend\nS'],
        ['unary minus', 'S = 1.5\nfor I in 1 to 3\n S = -S\nend\nS'],
        ['ordered comparison of mixed operands', 'N = 0\nfor I in 1 to 9\n if I / 2 less 3\n  N += 1\n end\nend\nN'],
        ['integral equality of mixed operands', 'N = 0\nfor I in 1 to 9\n if I equal 3.0 or 4.0 equal I or I not equal 5.0\n  N += 1\n end\nend\nN'],
        ['large integers coerce like the interpreter', 'S = 0.0\nfor I in 1 to 2\n S = 9007199254740993 + 0.5 + I\nend\nS'],
        ['negative zero literals', 'S = 1.0\nfor I in 1 to 2\n S = -0.0\nend\nS'],
        ['negative zero products', 'S = 1.0\nfor I in 1 to 2\n S = 0.0 * -1\nend\nS'],
        ['same-type extrema', 'S = 2.5\nfor I in 1 to 3\n S = S min (I / 2) max 0.75\nend\nS'],
        ['negative zero extrema', 'S = 1.0\nfor I in 1 to 2\n S = 0.0 min -0.0\nend\nS'],
    ])('%s', (_, source) => {
        expect(compare(source).loops).toBe(1);
    });

    it.each([
        ['sqrt of reals and integers', 'S = 0.0\nfor I in 0 to 8\n S += (I sqrt) + ((I * 0.5) sqrt)\nend\nS'],
        ['floor and ceil to integers', 'N = 0\nfor I in 1 to 8\n N += ((I / 3) floor) + ((I / 3) ceil) + (I floor)\nend\nN'],
        ['abs of reals, including negative zero', 'S = 0.0\nT = 0.0\nfor I in 1 to 3\n S = (0.0 * -1) abs\n T += (I - 4.5) abs\nend\nS'],
    ])('inlines %s', (_, source) => {
        expect(compare(`use numbers\n${source}`).loops).toBe(1);
    });

    it.each([
        ['division by integer zero', 'S = 0.0\nfor I in 0 to 2\n S = 1.5 / (I - 1)\nend\nS'],
        ['division by real zero', 'S = 0.0\nfor I in 0 to 2\n S = I / (I * 0.0)\nend\nS'],
        ['sqrt of a negative value', 'use numbers\nS = 0.0\nfor I in 0 to 2\n S = (1.5 - I) sqrt\nend\nS'],
        ['floor of a non-finite value', 'use numbers\nN = 0\nfor I in 0 to 2\n N = (1 / (I * 0.0 + 0.0)) floor\nend\nN'],
    ])('reports %s like the interpreter, keeping earlier writes', (_, source) => {
        const result = compare(source);
        expect(result.error).toBeDefined();
        expect(result.loops).toBe(1);
    });

    it.each([
        'use numbers\nfor I in 1 to 8\n R = (I ** 0.5) floor\nend',
        'for I in 1 to 3\n R = -I ** 0.5\nend',
        'for I in 1 to 3\n R = (I * 0.5) ** 2\nend',
        'for I in 1 to 3\n R = (I * 0.5) ** 0.25\nend',
        'for I in 1 to 3\n R = (-I) ** 2.0\nend',
        'for I in 1 to 3\n R = (-0.0) ** 0.5\nend',
        'for I in 1 to 3\n R = 1.0e308 ** 2\nend',
        'R = 2.0\nfor I in 1 to 3\n R **= I\nend',
        'R = -2.0\nfor I in 1 to 3\n Before = I\n R **= 0.5\nend',
        'R = 0.0\nfor I in 1 to 3\n Before = I\n R **= -1\nend',
        'for I in 1 to 3\n Before = I\n R = (2 - I) ** -0.5\nend',
        'for I in 1 to 3\n Before = I\n R = (2 - I) ** 0.5\nend',
        'use numbers\nfor I in 1 to 3\n Before = I\n R = (1.0e308 ** I) floor\nend',
    ])('preserves real power values, signs and partial errors: %s', source => {
        expect(compare(source).loops).toBe(1);
    });

    it('treats nan as unordered', () => {
        const result = compare(`use numbers
N = 0
X = nan
for I in 1 to 3
 if X less I or X at least I or X equal X
  N += 1
 end
 if X not equal X
  N += 10
 end
end
N`);
        expect(result.result).toBe('30');
        expect(result.loops).toBe(1);
    });

    it('reads and writes real array cells', () => {
        const result = compare(`Xs = array shape 8 fill 0.0
Xs 0 = 1.0
for I in 1 to 7
 X = Xs (I - 1)
 Xs I = X / 2 + I
end
Xs`);
        expect(result.loops).toBe(1);
    });

    it('compiles the hyperbola square walk', () => {
        const result = compare(`use numbers
Small = 0.05
Xs = array shape 1000 fill 0.0
Ys = array shape 1000 fill 0.0
Xs 0 = 1.0
Top = 1
Answer = 0
for Step in 1 to 4000
 Top -= 1
 X = Xs Top
 Y = Ys Top
 Sm = X + Y
 S = ((Sm * Sm - 4 * (X * Y - 1)) sqrt - Sm) / 2
 if S at least Small
  Answer += 1
  Xs Top = X + S
  Ys Top = Y
  Xs (Top + 1) = X
  Ys (Top + 1) = Y + S
  Top += 2
 end
 if Top equal 0
  break
 end
end
Answer`);
        expect(result.result).toBe('210');
        expect(result.loops).toBe(1);
    });

    it('rejects a real plan for packed integer cells on a later call', () => {
        const result = compare(`use sequences
fun Xs total
 T = 0.0
 for I in 0 till 3
  T += Xs I
 end
 return T
end
A = (array shape 3 fill 0.5) total
P = (array 3 1 2) sort
B = P total
array A B`);
        expect(result.result).toBe('1.5 6');
    });

    it.each([
        ['real floor division', 'S = 0.0\nfor I in 1 to 3\n S = I // 2.0\nend\nS'],
        ['mixed extrema', 'S = 0\nfor I in 1 to 3\n S = I min 2.5\nend\nS'],
        ['an integer binding that becomes real', 'S = 0\nfor I in 1 to 3\n S += 0.5\nend\nS'],
    ])('falls back with a diagnostic for %s', (_, source) => {
        const result = compare(source);
        expect(result.loops).toBe(0);
        expect(Object.keys(result.fallbacks).some(reason => reason.startsWith('loop:'))).toBe(true);
    });

    it('keeps real loops interpreted when the option is off', () => {
        const result = run('S = 0.0\nfor I in 1 to 3\n S += I / 2\nend\nS', false);
        expect(result.result).toBe('3');
        expect(result.loops).toBe(0);
    });
});
