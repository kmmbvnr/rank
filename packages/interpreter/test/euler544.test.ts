import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {Interpreter, type InterpreterOptions} from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/544_chromaticconundrum.ra', import.meta.url), 'utf8');
const modulus = 1000000007n;
function brute(rows: number, columns: number, colours: number) {
    if (!rows || !columns) return 1n;
    const cells = new Int32Array(rows * columns);
    function visit(at: number): bigint {
        if (at === cells.length) return 1n;
        let count = 0n;
        for (let colour = 0; colour < colours; colour++) {
            if (at >= columns && cells[at-columns] === colour || at % columns && cells[at-1] === colour) continue;
            cells[at] = colour;
            count += visit(at+1);
        }
        return count;
    }
    return visit(0);
}
function solve(rows: number, columns: number, n: number, options: InterpreterOptions) {
    const runtime = new Interpreter(() => {}, {...options, args: [`--r=${rows}`, `--c=${columns}`, `--n=${n}`]});
    try {runtime.execute(source); return runtime.variables.get('Answer');}
    finally {runtime.dispose();}
}
const modes = [{name: 'Number', options: {}}, {name: 'exact', options: {numberLoopCompilation: false}}, {name: 'reference', options: {compilation: false}}];
describe.each(modes)('Euler 544 $name', ({options}) => {
    it.each([[0,0,0], [0,3,7], [4,0,13], [1,1,0], [1,1,6], [1,5,4], [5,1,4], [2,2,5], [2,3,4], [3,2,4], [3,3,2], [4,4,2]])('matches enumerated grid %s x %s through %s colours', (rows, columns, n) => {
        let expected = 0n;
        for (let colours = 1; colours <= n; colours++) expected += brute(rows, columns, colours);
        expect(solve(rows, columns, n, options)).toBe(expected % modulus);
    });
    it.each([[3,3,5,152680n], [4,4,15,325951319n]])('matches statement grid %s x %s through %s', (rows, columns, n, expected) => {
        expect(solve(rows, columns, n, options)).toBe(expected);
    });
    it.each([1, 2, 3, 5])('interpolates a path of %s cells, including a complete field period', length => {
        let expected = 0n;
        for (let colours = 1n; colours <= 100n; colours++) expected += colours * (colours - 1n) ** BigInt(length - 1);
        expect(solve(1, length, 100, options)).toBe(expected % modulus);
        expect(solve(length, 1, Number(modulus)+100, options)).toBe(expected % modulus);
    });
    it('matches the complete grid with repeated transfer phases and sample blocks', () => {
        expect(solve(10, 9, 1112131415, options)).toBe(640432376n);
    }, 120000);
});
