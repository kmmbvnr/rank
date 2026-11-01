import { expect, it } from 'vitest';
import { run } from './support.js';

const setup = 'V = array -100 200 300 -400 500 600\nK = array 0 1 0 1 0 1\n';
for (const operation of ['reduce +', 'reduce *', 'scan +', 'scan *', 'sum']) {
    for (const modulus of [1, 7, 2147483648, 1099511627776, -7]) {
        it(`${operation} by keys mod ${modulus} matches exact execution`, () => {
            const fold = `V ${operation} by K with 3 size 4`;
            expect(run(setup + `(${fold}) mod (${modulus})`))
                .toBe(run(setup + `Exact = ${fold}\nExact mod (${modulus})`));
        });
    }
}
it('keeps keys on unfused reducers and real inputs', () => {
    for (const fold of ['V reduce - by K', 'V scan - by K', 'V reduce / by K']) {
        expect(run(setup + `(${fold}) mod 7`)).toBe(run(setup + `Exact = ${fold}\nExact mod 7`));
    }
    const real = 'V = array 1.5 2.5 3.5\nK = array 0 1 0\n';
    expect(run(real + '(V reduce + by K) mod 2'))
        .toBe(run(real + 'Exact = V reduce + by K\nExact mod 2'));
});
it('reports modulus and key errors', () => {
    expect(() => run(setup + '(V reduce + by K) mod 0')).toThrow(/division by zero/);
    expect(() => run(setup + '(V reduce * by K size 1) mod 7')).toThrow(/outside/);
});
it('does not move mod through a user callback', () => {
    const source = 'fun A mix B = A * 10 + B\n' + setup;
    expect(run(source + '(V reduce mix by K) mod 7'))
        .toBe(run(source + 'Exact = V reduce mix by K\nExact mod 7'));
});
it('preserves missing-value sum behavior in a modular expression', () => {
    expect(run('V = array 1 .NA 3\nK = array 0 0 1\n(V sum by K) mod 2')).toBe('1 1');
});
