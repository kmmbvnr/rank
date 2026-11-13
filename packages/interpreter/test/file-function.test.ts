import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

const files: Record<string, string> = {
    'multiples.ra': `use numbers
use cli
arg Limit integer = 1000
N = 1 till Limit
Mask' = N mod 3 equal 0
Mask' or= N mod 5 equal 0
return N Mask sum`,
    'affine.ra': `use numbers
use cli
arg X real
arg Scale real = 2.0
arg Bias real = 0.5
return X * Scale + Bias`,
    'pair.ra': `use cli
arg Left integer
arg Right integer = 2
Hidden = Left * 10
return Hidden + Right`,
    'helpers.ra': `fun X twice
  return X * 2
end
return 7`,
    'failing.ra': `use numbers
use cli
arg X integer
return X // 0`,
    '001_multiples.ra': 'return 1',
    'plain.ra': `fun X twice
  return X * 2
end`,
};

function run(source: string, compilation = true): string {
    const runtime = new Interpreter(() => {}, { compilation,
        loadModule: path => ({ id: path, source: files[path] ?? '' }) });
    try {
        const value = runtime.execute(source);
        return value === undefined ? 'undefined' : formatValue(value);
    } catch (error) {
        return error instanceof RankError ? error.format().split('\n')[0] : String(error);
    } finally { runtime.dispose(); }
}

describe.each([false, true])('files as functions (compilation=%s)', compilation => {
    const call = (source: string) => run(source, compilation);

    it('returns from the top level of a program', () => {
        expect(call('return 5')).toBe('5');
        expect(call('X = 2\nreturn X * 3\nX = 9')).toBe('6');
    });

    it('calls a file with every right operand left out, given, or partly given', () => {
        expect(call('use "multiples.ra"\nmultiples')).toBe('233168');
        expect(call('use "multiples.ra"\nmultiples 10')).toBe('23');
        expect(call('use "affine.ra"\n3.0 affine')).toBe('6.5');
        expect(call('use "affine.ra"\n3.0 affine 4.0')).toBe('12.5');
        expect(call('use "affine.ra"\n3.0 affine 4.0 1.0')).toBe('13');
    });

    it('takes the lowercase alias as the name and composes with operators', () => {
        expect(call('use "multiples.ra" as sum35\nsum35 10')).toBe('23');
        expect(call('use "multiples.ra"\n(multiples 10) equal 23')).toBe('true');
        expect(call('use "multiples.ra"\n(multiples 10) + (multiples 5)')).toBe('26');
    });

    it('runs a fresh program for each call and keeps its names private', () => {
        expect(call('use "pair.ra"\nA = 1\nA pair')).toBe('12');
        expect(call('use "pair.ra"\nA = 1\nA pair 5')).toBe('15');
        expect(call('use "pair.ra"\nA = 1\nA pair\nHidden')).toContain('unknown name: Hidden');
        expect(call('use "multiples.ra"\nmultiples 10\nN')).toContain('unknown name: N');
        expect(call('use "multiples.ra"\nmultiples 10\nmultiples 5')).toBe('3');
    });

    it('does not read the caller workspace', () => {
        expect(call('Limit = 10\nuse "multiples.ra"\nmultiples')).toBe('233168');
    });

    it('checks argument types with the same contract as a program input', () => {
        expect(call('use "affine.ra"\n3 affine')).toContain('X expects real, got integer');
        expect(call('use "multiples.ra"\nmultiples 1.5')).toContain('Limit expects integer, got real');
    });

    it('leaves a file without its required left operand as a function value', () => {
        expect(call('use "pair.ra"\npair')).toBe('<function pair>');
    });

    it('locates an error inside the file', () => {
        expect(call('use "failing.ra"\n3 failing')).toContain('division by zero');
    });

    it('keeps functions of a file with a return importable', () => {
        expect(call('use "helpers.ra"\n3 twice')).toBe('6');
        expect(call('use "helpers.ra" as h\n4 h.twice')).toBe('8');
        expect(call('use "helpers.ra" as h\nh')).toBe('7');
    });

    it('is callable only under a lowercase name, and is otherwise a plain module', () => {
        expect(call('use "001_multiples.ra" as first\nfirst')).toBe('1');
        expect(call('use "001_multiples.ra"\n1')).toBe('1');
        expect(call('use "001_multiples.ra"\nfirst')).toContain('unknown name: first');
        expect(call('use "helpers.ra"\n3 twice')).toBe('6');
    });

    it('leaves a file without a return as an ordinary module', () => {
        expect(call('use "plain.ra"\n3 twice')).toBe('6');
    });
});

describe('top-level return completes lazy values', () => {
    it('returns a finished value from a deferred expression', () => {
        const source = "use numbers\nN = 1 till 11\nMask' = N mod 2 equal 0\nreturn N Mask sum";
        expect(run(source)).toBe('30');
        expect(run(source, false)).toBe('30');
    });
});
