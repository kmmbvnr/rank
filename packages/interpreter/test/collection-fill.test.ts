import { describe, expect, it } from 'vitest';
import { native } from '../src/modules/shared.js';
import { Interpreter, MISSING, RankError, formatValue, RuntimeDiagnostics } from '../src/index.js';
import { derivedArray, ownedArray } from '../src/array-storage.js';

function run(source: string, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation });
    try { return formatValue(runtime.execute('use sequences\nuse numbers\n' + source)!); }
    finally { runtime.dispose(); }
}

describe.each([false, true])('collection fill (compiled=%s)', compilation => {
    it.each([
        ['A = array -2 7 -1 4 9\nM = A greater 0\nA M fill 0', '0 7 0 4 9'],
        ['A = array -2 7 -1 4 9\nM = A greater 0\nA M fill -1', '-1 7 -1 4 9'],
        ['A = array -2 7 -1 4 9\nM = A greater 0\nA M shape 4 fill 0', '7 4 9 0'],
        ['A = array -2 7 -1 4 9\nM = A greater 0\nA M shape 2 fill 0', '7 4'],
        ['A = array 1 2 1 3 2\nA unique shape 5 fill 0', '1 2 3 0 0'],
        ['A = array 3 1 2 1\nA unique shape 2 fill 0', '3 1'],
        ['A = array 3 1 2 1\nA findall 1 shape 4 fill -1', '1 3 -1 -1'],
        ['"ababa" findall "aba" shape 3 fill -1', '0 2 -1'],
        ['M = array true false true\nM indices shape 4 fill -1', '0 2 -1 -1'],
        ['A = array 1 2 3\nM = array false false false\nA M fill 1 reduce *', '1'],
        ['A = array 1 2 3\nM = array true true true\nA M fill 0 sum', '6'],
        ['A = array 1 2 3\nM = array false false false\nA M shape 2 fill 9', '9 9'],
        ['A = array 1 2 3\nA unique shape 0 fill 0 len', '0'],
        ['M = array true false true\nM indices shape 0 fill -1 len', '0'],
    ])('evaluates %s', (source, expected) => { expect(run(source, compilation)).toBe(expected); });

    it('preserves all dimensions of a mask-filled tensor', () => {
        const body = `A = (1 to 6) reshape 2 3
M = A mod 2 equal 0
Filled = A M fill -1
Expected = M choose A (-1)
(Filled equal Expected) all`;
        expect(run(body, compilation)).toBe('true');
    });

    it.each([
        'A = array 1 2 3\nM = array true\nA M fill 0',
        'A = array 1 2 3\nM = array 1 0 1\nA M fill 0',
        'A = array 1 2 3\nA unique shape -1 fill 0',
        'A = array 1 2 3\nA unique shape 1.5 fill 0',
        'A = array 1 2 3\nA unique shape 2 fill (array 0)',
        'A = (1 to 6) reshape 2 3\nA unique shape 2 fill 0',
    ])('rejects incompatible arguments: %s', source => { expect(() => run(source, compilation)).toThrow(); });

    it('does not read unselected invalid cells or discarded NaN/infinity', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const reads: number[] = [];
        runtime.variables.set('Input', derivedArray([3], [], index => {
            reads.push(index);
            if (index === 1) throw Error('unselected');
            return index === 0 ? NaN : Infinity;
        }));
        runtime.variables.set('Mask', ownedArray([false, false, true]));
        try {
            expect(formatValue(runtime.execute('Input Mask fill 7')!)).toBe('7 7 inf');
            expect(reads).toEqual([2]);
        } finally { runtime.dispose(); }
    });

    it('bounds input demand and does not visit a truncated unique tail', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const reads: number[] = [];
        runtime.variables.set('Input', derivedArray([1000000], [], index => {
            reads.push(index);
            if (index > 2) throw Error('truncated tail');
            return BigInt(index % 2);
        }));
        try {
            runtime.execute('use sequences');
            expect(formatValue(runtime.execute('Input unique shape 2 fill 0')!)).toBe('0 1');
            expect(reads).toEqual([0, 1]);
        } finally { runtime.dispose(); }
    });
});

it('fuses a deferred mask fill with its reduction', () => {
    const runtime = new Interpreter();
    const diagnostics = new RuntimeDiagnostics();
    try {
        const result = diagnostics.run(() => runtime.execute(`use sequences
Input = 1 to 1000
Mask' = Input mod 2 equal 0
Filled' = Input Mask fill 0
Answer = (Filled + 1) sum`));
        expect(result).toBe(251500n);
        expect(diagnostics.compiledTensors).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
});

it.each([false, true])('covers empty shapes, coordinates and streaming demand (%s)', compilation => {
    expect(run('A = array shape 2 0 3 fill 4\nM = array shape 2 0 3 fill true\n(A M fill 0) shape', compilation)).toBe('2 0 3');
    expect(run('M = (array true false false true) reshape 2 2\n(M indices shape 3 fill -1) shape', compilation)).toBe('3 2');
    expect(run('M = (array true false false true) reshape 2 2\n(M indices shape 3 fill -1) reshape 6', compilation)).toBe('0 0 1 1 -1 -1');
    expect(run("N' = 0 to #\nN unique shape 3 fill -1", compilation)).toBe('0 1 2');
    expect(run("N' = 0 to #\nM' = N mod 2 equal 0\nN M shape 3 fill -1", compilation)).toBe('0 2 4');
    expect(run('fun values\n yield 1\n yield 1.0\n yield 2\nend\nvalues unique shape 3 fill 0', compilation)).toBe('1 2 0');
    expect(run('A = array 1 2\nN = 4\nA unique shape N fill 9', compilation)).toBe('1 2 9 9');
});

it.each([false, true])('evaluates a fill expression once even for all-true masks (%s)', compilation => {
    let calls = 0;
    const runtime = new Interpreter(() => {}, { compilation });
    runtime.variables.set('replacement', native('replacement', 0, () => { calls++; return -1n; }));
    try {
        expect(formatValue(runtime.execute(`A = array 1 2 3
Mask = array true true true
Filled = A Mask fill (replacement)
Filled`)!)).toBe('1 2 3');
        expect(calls).toBe(1);
    } finally { runtime.dispose(); }
});

it.each([false, true])('does not demand inputs at zero capacity (%s)', compilation => {
    const runtime = new Interpreter(() => {}, { compilation });
    runtime.variables.set('Input', derivedArray([10], [], () => { throw Error('zero demand'); }));
    try {
        runtime.execute('use sequences');
        expect(formatValue(runtime.execute('Input unique shape 0 fill 7 len')!)).toBe('0');
        expect(formatValue(runtime.execute('Input findall 1 shape 0 fill -1 len')!)).toBe('0');
        expect(formatValue(runtime.execute('Input indices shape 0 fill -1 len')!)).toBe('0');
    } finally { runtime.dispose(); }
});

it.each([false, true])('keeps errors out of an unselected native branch (%s)', compilation => {
    expect(run(`Input = array 1 0 2
Mask' = Input greater 0
Values' = 10 // Input
Filled' = Values Mask fill 0
Answer = Filled sum`, compilation)).toBe('15');
});

it.each([false, true])('preserves source storage and ordinary array element types (%s)', compilation => {
    expect(run(`A = array 1 2 3
M = array true false true
Filled = A M fill 0
Filled 0 = 99
A`, compilation)).toBe('1 2 3');
    expect(run('A = array 1 2\nM = array false false\nA M fill 0.5', compilation)).toBe('0.5 0.5');
    expect(() => run('A = array 1 2\nA unique shape 3 fill 0.5', compilation)).toThrow();
    expect(() => run('M = array true false\nM indices shape 2 fill "missing"', compilation)).toThrow();
});

it('uses conditional branches in generated tensor code', () => {
    const code: string[] = [];
    const runtime = new Interpreter(() => {}, { onTensorKernelCompiled: source => code.push(source) });
    try {
        expect(runtime.execute(`use sequences
Input = 1 to 10000
Mask' = Input mod 2 equal 0
Filled' = Input Mask fill 0
Answer = Filled sum`)).toBe(25005000n);
        const generated = code.find(source => source.includes('tensor:condition-type'));
        expect(generated).toContain('else {');
        expect(generated).not.toContain('answer.append');
        expect(generated).not.toContain('answer.push');
    } finally { runtime.dispose(); }
});

it.each([false, true])('keeps choose semantics for missing source and mask cells (%s)', compilation => {
    for (const mask of [[false, true], [true, true], [true, MISSING]]) {
        const runtime = new Interpreter(() => {}, { compilation });
        runtime.variables.set('Input', ownedArray([MISSING, 5n]));
        runtime.variables.set('Mask', ownedArray(mask));
        try {
            const evaluate = (source: string) => {
                try { return { value: formatValue(runtime.execute(source)!) }; }
                catch (error) { if (!(error instanceof RankError)) throw error; return { error: error.message }; }
            };
            expect(evaluate('Actual = Input Mask fill 0')).toEqual(evaluate('Expected = Mask choose Input 0'));
        } finally { runtime.dispose(); }
    }
});

it.each([false, true])('keeps ordinary shape queries distinct from shape/fill (%s)', compilation => {
    expect(run('A = array 1 2 1\nA shape', compilation)).toBe('3');
    expect(run('A = array 1 2 1\n(A unique shape 4 fill 0) shape', compilation)).toBe('4');
    expect(run('A = array 1 2 1\n(A unique shape 2 3 fill 0) reshape 6', compilation)).toBe('1 2 0 0 0 0');
});

it.each([false, true])('collects a full tensor mask in row-major order into any requested frame (%s)', compilation => {
    const prefix = 'A = (1 to 12) reshape 3 4\nM = A mod 2 equal 0\n';
    expect(run(prefix + '(A M shape 2 3 fill 0) shape', compilation)).toBe('2 3');
    expect(run(prefix + '(A M shape 2 3 fill 0) reshape 6', compilation)).toBe('2 4 6 8 10 12');
    expect(run(prefix + '(A M shape 1 2 fill 0) reshape 2', compilation)).toBe('2 4');
    expect(run(prefix + '(A M shape 2 4 fill 0) reshape 8', compilation)).toBe('2 4 6 8 10 12 0 0');
    expect(run('A = (1 to 8) reshape 2 2 2\nM = A mod 2 equal 0\n(A M shape 2 1 3 fill -1) reshape 6', compilation))
        .toBe('2 4 6 8 -1 -1');
    expect(run('A = array shape 0 3 fill 1\nM = array shape 0 3 fill true\n(A M shape 2 2 fill 7) reshape 4', compilation))
        .toBe('7 7 7 7');
});

it.each([false, true])('shares multidimensional output frames across bounded operations (%s)', compilation => {
    expect(run('A = array 4 2 4 1\n(A unique shape 2 2 fill 0) reshape 4', compilation)).toBe('4 2 1 0');
    expect(run('A = array 4 2 4 1\n(A findall 4 shape 2 2 fill -1) reshape 4', compilation)).toBe('0 2 -1 -1');
    expect(run('M = array false true false true\n(M indices shape 2 2 fill -1) reshape 4', compilation)).toBe('1 3 -1 -1');
    const prefix = 'M = (array true false false true) reshape 2 2\n';
    expect(run(prefix + '(M indices shape 2 2 fill -1) shape', compilation)).toBe('2 2 2');
    expect(run(prefix + '(M indices shape 2 2 fill -1) reshape 8', compilation)).toBe('0 0 1 1 -1 -1 -1 -1');
    expect(run("N' = 0 to #\n(N unique shape 2 3 fill -1) reshape 6", compilation)).toBe('0 1 2 3 4 5');
    expect(run("N' = 0 to #\nM' = N mod 2 equal 0\n(N M shape 2 3 fill -1) reshape 6", compilation)).toBe('0 2 4 6 8 10');
});

it.each([false, true])('accepts a shape vector like array construction (%s)', compilation => {
    expect(run('A = array 1 2\nDims = array 2 3\n(A unique shape Dims fill 0) shape', compilation)).toBe('2 3');
    expect(run('A = array 1 2\n(A unique shape (array 2 3) fill 0) reshape 6', compilation)).toBe('1 2 0 0 0 0');
    expect(run('A = array 1 2\nDims = array shape 0 fill 0\n(A unique shape Dims fill 0) shape len', compilation)).toBe('0');
});

it.each([false, true])('preserves zero axes and skips all element demand at zero capacity (%s)', compilation => {
    const runtime = new Interpreter(() => {}, { compilation });
    runtime.variables.set('Input', derivedArray([2, 3], [], () => { throw Error('zero demand'); }));
    runtime.variables.set('Mask', derivedArray([2, 3], [], () => { throw Error('zero demand'); }));
    try {
        runtime.execute('use sequences');
        expect(formatValue(runtime.execute('(Input Mask shape 2 0 3 fill 7) shape')!)).toBe('2 0 3');
        expect(formatValue(runtime.execute('(Mask indices shape 0 3 fill -1) shape')!)).toBe('0 3 2');
    } finally { runtime.dispose(); }
});

it.each([false, true])('validates every extent and the full mask shape (%s)', compilation => {
    for (const shape of ['2 -1', '2 0.5', '4294967295 2', '9007199254740992 0', '#', '(array 2 -1)']) {
        expect(() => run(`A = array 1 2\nA unique shape ${shape} fill 0`, compilation)).toThrow();
    }
    expect(() => run('A = (1 to 6) reshape 2 3\nM = array shape 3 2 fill true\nA M shape 2 2 fill 0', compilation)).toThrow('matching array shapes');
    expect(() => run('A = (1 to 6) reshape 2 3\nM = array true true\nA M shape 2 2 fill 0', compilation)).toThrow('matching array shapes');
});

it.each([false, true])('evaluates each requested extent once (%s)', compilation => {
    let calls = 0;
    const runtime = new Interpreter(() => {}, { compilation });
    runtime.variables.set('extent', native('extent', 0, () => { calls++; return 2n; }));
    try {
        runtime.execute('use sequences\nA = array 1 2');
        expect(formatValue(runtime.execute('(A unique shape (extent) (extent) fill 0) shape')!)).toBe('2 2');
        expect(calls).toBe(2);
    } finally { runtime.dispose(); }
});
