import { expect, it } from 'vitest';
import { inferRequirements } from '@arrrank/language';
import { Interpreter, formatValue, parse } from '../src/index.js';

it('accepts runtime-valid rank applications across scalar, text, tensor and empty inputs', () => {
    let checked = 0;
    for (const value of ['2', '"abc"', 'array 1 2', 'array "a" "b"',
        'array shape 0 fill 0', 'array shape 2 3 fill 1', 'array shape 2 2 fill 1']) {
        for (const operation of ['sum', 'min', 'sort', 'abs', 'sqrt', 'lower', 'len', 'shape', 'det', 'inverse']) {
            for (const rank of ['', ' rank 0', ' rank 1', ' rank 2', ' rank 5', ' rank -1']) {
                const source = `use numbers\nuse sequences\nuse text\nuse linalg\nX = ${value}\nX ${operation}${rank}`;
                try { formatValue(new Interpreter().execute(source)!); }
                catch { continue; } // The oracle here is successful, fully forced evaluation.
                checked++;
                expect(inferRequirements(parse(source)).conflicts, source).toEqual([]);
            }
        }
    }
    expect(checked).toBeGreaterThanOrEqual(200);
});

it('keeps runtime guards and empty-frame behavior independent of downstream requirements', () => {
    const source = 'fun identity X\n return X\nend\nA = array shape 0 fill 0\nB = A identity rank 0\nB # 0';
    const before = new Interpreter();
    expect(() => formatValue(before.execute(source)!)).toThrow();
    inferRequirements(parse(source));
    const after = new Interpreter();
    expect(() => formatValue(after.execute(source)!)).toThrow();
    const empty = 'use sequences\nfun matrix X\n return array shape 2 2 fill X\nend\n(array shape 0 fill 0) matrix rank 0 shape';
    const expected = formatValue(new Interpreter().execute(empty)!);
    inferRequirements(parse(empty));
    expect(formatValue(new Interpreter().execute(empty)!)).toBe(expected);
});

it('uses explicit frame axes when checking cell shapes and empty frames', () => {
    for (const shape of ['2 3 2', '2 0 2', '3 0 2']) {
        const source = `use linalg\nM = array shape ${shape} fill 1\nM det axis 1 rank 2`;
        expect(() => formatValue(new Interpreter().execute(source)!)).not.toThrow();
        expect(inferRequirements(parse(source)).conflicts, shape).toEqual([]);
    }
});
