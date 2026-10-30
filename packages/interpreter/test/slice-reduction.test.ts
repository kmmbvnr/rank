import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { typedArray } from '../src/array-storage.js';

function run(program: string, cells: Int32Array | Float64Array) {
    const runtime = new Interpreter();
    try {
        runtime.variables.set('X', typedArray(cells, [cells.length]));
        return runtime.execute(`use numbers\nuse stats\n${program}`);
    } finally { runtime.dispose(); }
}

function range(from: number, to: number, by: number) {
    const out: number[] = [];
    for (let i = from; by > 0 ? i <= to : i >= to; i += by) out.push(i);
    return out;
}

describe('a reduction over a slice of a stored array', () => {
    const ints = Int32Array.from({ length: 3000 }, (_, i) => (i * 7919) % 2001 - 1000);
    const reals = Float64Array.from({ length: 3000 }, (_, i) => ((i * 7919) % 2001 - 1000) / 8);
    for (const [name, cells] of [['integer', ints], ['real', reals]] as const) {
        for (const op of ['sum', 'min', 'max', 'mean']) {
            for (const [lo, hi] of [[0, 2998], [5, 2990], [100, 100], [2999, 2999]]) {
                it(`${op} of ${name} cells ${lo} to ${hi}`, () => {
                    const inline = run(`(X (${lo} to ${hi})) ${op}`, cells);
                    const bound = run(`Y = X (${lo} to ${hi})\nY ${op}`, cells);
                    expect(inline).toEqual(bound);
                    const part = Array.from(cells.subarray(lo, hi + 1));
                    const want = op === 'sum' ? part.reduce((a, b) => a + b, 0) : op === 'min' ? Math.min(...part)
                        : op === 'max' ? Math.max(...part) : part.reduce((a, b) => a + b, 0) / part.length;
                    expect(Number(inline)).toBeCloseTo(want, 9);
                });
            }
        }
    }
    for (const [name, cells] of [['integer', ints], ['real', reals]] as const) {
        for (const op of ['sum', 'min', 'max', 'mean']) {
            for (const [spec, picks] of [['0 to 2998 by 2', range(0, 2998, 2)], ['2999 to 0 by -1', range(2999, 0, -1)],
                ['2990 to 10 by -7', range(2990, 10, -7)], ['4 to 2996 by 3', range(4, 2996, 3)]] as const) {
                it(`${op} of ${name} cells ${spec}`, () => {
                    const inline = run(`(X (${spec})) ${op}`, cells);
                    expect(inline).toEqual(run(`Y = X (${spec})\nY ${op}`, cells));
                    const part = picks.map(i => cells[i]);
                    const want = op === 'sum' ? part.reduce((a, b) => a + b, 0) : op === 'min' ? Math.min(...part)
                        : op === 'max' ? Math.max(...part) : part.reduce((a, b) => a + b, 0) / part.length;
                    expect(Number(inline)).toBeCloseTo(want, 9);
                });
            }
        }
    }
    it('leaves the source unchanged', () => {
        const before = Array.from(ints);
        run('(X (10 to 20)) sum', ints);
        expect(Array.from(ints)).toEqual(before);
    });
});
