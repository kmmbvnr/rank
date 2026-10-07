import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { formatValue } from '../src/value.js';

function run(source: string, compiled = true): string {
    const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled });
    try { return formatValue(runtime.execute(source)!); }
    finally { runtime.dispose(); }
}

for (const operator of ['+', '-', '*', '/', '//', 'mod', '**',
    'equal', 'not equal', 'less', 'greater', 'at least', 'at most']) {
    it(`requires explicit conversion for scalar ${operator}`, () => {
        for (const compiled of [false, true]) {
            for (const [left, right] of [['1', '2.0'], ['1.0', '2']]) {
                expect(() => run(`${left} ${operator} ${right}`, compiled)).toThrow('explicit conversion');
                expect(() => run(`fun probe X Y\n return X ${operator} Y\nend\n${left} ${right} probe`, compiled))
                    .toThrow('explicit conversion');
            }
        }
    });

    it(`requires explicit conversion for small and dense array ${operator}`, () => {
        for (const size of [3, 2000]) {
            const setup = `A = array shape ${size} fill 1\nB = array shape ${size} fill 2.0\n`;
            for (const expression of [`A ${operator} B`, `A ${operator} 2.0`, `1 ${operator} B`]) {
                expect(() => run(`${setup}(${expression}) 0`)).toThrow('explicit conversion');
            }
        }
    });
}

it('keeps integer division and makes conversion easy to request', () => {
    expect(run('5 / 2')).toBe('2.5');
    expect(run('5.0 / 2.0')).toBe('2.5');
    expect(run('(5 real) / 2.0')).toBe('2.5');
    expect(run('5 + (2.0 integer)')).toBe('7');
    expect(run('A = array 1 2 3\nB = A real rank 0\n(B + 0.5) 2')).toBe('3.5');
});

it('keeps tensor fusion from bypassing numeric type checks', () => {
    for (const tensorFusion of [false, true]) {
        const runtime = new Interpreter(undefined, { tensorFusion });
        try {
            for (const expression of ['(A + 0.5) sum', '(A * 0.5) copy', '(A / 2.0) sum']) {
                expect(() => runtime.execute(`use sequences\nA = array 1 2 3\n${expression}`))
                    .toThrow('explicit conversion');
            }
        } finally { runtime.dispose(); }
    }
});

it('keeps missing propagation and rejects implicit conversion in array construction', () => {
    expect(run('.NA + 2.0')).toBe('.NA');
    expect(run('.NA equal 2')).toBe('.NA');
    expect(() => run('array 1 2.0')).toThrow();
    expect(run('array (1 real) 2.0')).toBe('1 2');
});
