import { expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';
import { ownedArray, readArrayItem, typedArray } from '../src/array-storage.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';

const count = 4101;
for (const compilation of [false, true]) for (const width of [2, 3]) {
    for (const op of ['+', '-', '*', 'min', 'max']) {
        it(`broadcasts ${width} lanes through three axes: ${op}, compilation=${compilation}`, () => {
            const runtime = new Interpreter(undefined, { compilation });
            const cells = Int32Array.from({ length: count }, (_, i) => i - 2050);
            const offsets = [2n, -3n, 5n].slice(0, width);
            runtime.variables.set('Left', typedArray(cells, [3, 1367, 1]));
            runtime.execute('use sequences');
            runtime.variables.set('Right', ownedArray(offsets));
            try {
                const result = runtime.execute(`Left ${op} Right`) as RankArray;
                expect(result.shape).toEqual([3, 1367, width]);
                for (let row = 0; row < count; row++) for (let column = 0; column < width; column++) {
                    const a = BigInt(cells[row]), b = offsets[column];
                    const expected = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b
                        : op === 'min' ? a < b ? a : b : a > b ? a : b;
                    expect(readArrayItem(result, row * width + column)).toBe(expected);
                }
            } finally { runtime.dispose(); }
        });
    }
}
it('widens two-lane arithmetic instead of wrapping int32 cells', () => {
    const runtime = new Interpreter(undefined, { compilation: false });
    runtime.variables.set('Left', typedArray(new Int32Array(count).fill(2147483647), [count, 1]));
    try {
        const result = runtime.execute('use sequences\nRight = array 1 2\nLeft + Right') as RankArray;
        expect(readArrayItem(result, 0)).toBe(2147483648n);
        expect(readArrayItem(result, 2 * count - 1)).toBe(2147483649n);
    } finally { runtime.dispose(); }
});

it.each([2, 3])('keeps scoped demand limits for %s-lane rows', width => {
    const runtime = new Interpreter(undefined, { compilation: false });
    runtime.variables.set('Left', typedArray(Int32Array.from({ length: count }, (_, i) => i), [count, 1]));
    runtime.variables.set('Right', ownedArray(Array.from({ length: width }, (_, i) => BigInt(i + 1))));
    try {
        runtime.execute('use sequences');
        expect(() => withDemandBudget(1000, () => runtime.execute('Result = Left + Right'))).toThrow(DemandBudgetExhausted);
        expect(runtime.variables.has('Result')).toBe(false);
        const result = withDemandBudget(1000000, () => runtime.execute('Result = Left + Right\nResult')) as RankArray;
        expect(readArrayItem(result, count * width - 1)).toBe(BigInt(count + width - 1));
    } finally { runtime.dispose(); }
});
