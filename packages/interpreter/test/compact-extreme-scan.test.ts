import { expect, it } from 'vitest';
import { Interpreter, isRankArray, formatValue } from '../src/index.js';
import { integer32Cells, readArrayItem, typedArray } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';
import { withDemandBudget, withInterrupt, InterruptedError } from '../src/interrupt.js';

it.each(['min', 'max'])('keeps unranked %s prefixes compact, exact and independent', operation => {
    for (const compilation of [false, true]) for (const size of [0, 1, 4097]) {
        const cells = Int32Array.from({ length: size }, (_, i) => [-2147483648, 2147483647, 0, -1, 1][i % 5]);
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.variables.set('Input', typedArray(cells));
            const result = r.execute(`Result = Input scan ${operation}`);
            if (!result || !isRankArray(result)) throw Error('expected prefix array');
            expect(integer32Cells(result)).toBeDefined(); expect(result.shape).toEqual([size]);
            let best = cells[0];
            for (let i = 0; i < size; i++) {
                best = operation === 'min' ? Math.min(best, cells[i]) : Math.max(best, cells[i]);
                expect(readArrayItem(result, i)).toBe(BigInt(best));
            }
            if (size) {
                r.execute('Result 0 = 17\nInput 0 = 23');
                expect(readArrayItem(result, 0)).toBe(17n);
                if (size > 1) expect(readArrayItem(result, 1)).toBe(BigInt(operation === 'min' ? -2147483648 : 2147483647));
            }
        } finally { r.dispose(); }
    }
});
it.each(['min', 'max'])('retains seeds and custom %s callbacks', operation => {
    const r = new Interpreter(() => {});
    try {
        r.variables.set('Input', typedArray(new Int32Array([3, 1, 2])));
        const seeded = formatValue(r.execute(`Input scan ${operation} with 7`)!);
        expect(seeded).toBe(operation === 'min' ? '7 3 1 1' : '7 7 7 7');
        r.variables.set(operation, native('custom', 2, a => (a[0] as bigint) + (a[1] as bigint)));
        expect(formatValue(r.execute(`Input scan ${operation}`)!)).toBe('3 4 6');
    } finally { r.dispose(); }
});
it.each(['min', 'max'])('can enter compact %s after a budgeted or cancelled call', operation => {
    const r = new Interpreter(() => {});
    try {
        r.variables.set('Input', typedArray(new Int32Array([3, 1, 2])));
        const source = `Result = Input scan ${operation}`;
        const expected = operation === 'min' ? '3 1 1' : '3 3 3';
        expect(formatValue(withDemandBudget(100000, () => r.execute(source))!)).toBe(expected);
        const flag = new Int32Array(new SharedArrayBuffer(4)); flag[0] = 1;
        expect(() => withInterrupt(flag, () => r.execute(source))).toThrow(InterruptedError);
        expect(formatValue(r.execute(source)!)).toBe(expected);
        const result = r.execute(source);
        if (!result || !isRankArray(result)) throw Error('expected prefix array');
        expect(integer32Cells(result)).toBeDefined();
    } finally { r.dispose(); }
});

it.each(['min', 'max'])('does not infer an empty %s scan binding from physical storage', operation => {
    const r = new Interpreter(() => {}, { compilation: false });
    try {
        r.variables.set('Input', typedArray(new Int32Array(0)));
        expect(formatValue(r.execute(`Result = Input scan ${operation}\nResult = array 1.5`)!)).toBe('1.5');
    } finally { r.dispose(); }
});
it.each(['min', 'max'])('honors a changed standard %s call implementation', operation => {
    const r = new Interpreter(() => {});
    try {
        r.variables.set('Input', typedArray(new Int32Array([3, 1, 2])));
        const fn = r.execute(operation);
        if (!fn || typeof fn !== 'object' || fn.kind !== 'function') throw Error('expected function');
        r.execute(`Input scan ${operation}`);
        const descriptor = Object.getOwnPropertyDescriptor(fn, 'call');
        if (!descriptor) throw Error('expected own call implementation');
        try {
            Object.defineProperty(fn, 'call', { value: (args: bigint[]) => args[0] + args[1], configurable: true });
            expect(formatValue(r.execute(`Input scan ${operation}`)!)).toBe('3 4 6');
        } finally { Object.defineProperty(fn, 'call', descriptor); }
    } finally { r.dispose(); }
});
