import { ownedArray } from '../src/array-storage.js';
import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { argumentSignature } from '../src/return-contract.js';

describe('argument signature memo', () => {
    it('invalidates signatures after a host replaces all cells with another homogeneous type', () => {
        const value = ownedArray([1n, 2n]);
        const first = argumentSignature([value]);
        value.items.splice(0, 2, 1.0, 2.0);
        expect(argumentSignature([value])).not.toBe(first);
    });

    it('does not mix up different scalars, arrays and argument counts', () => {
        const runtime = new Interpreter();
        runtime.execute('A = array 1 2 3\nB = array 1.5 2.5');
        const a = runtime.variables.get('A')!, b = runtime.variables.get('B')!;
        const keys = [[1n], [1.5], [a], [b], [a, b], [b, a], [1n, a], ['x']].map(args => argumentSignature(args));
        expect(new Set(keys).size).toBe(keys.length);
        expect(argumentSignature([a])).toBe(keys[2]);
    });

    it('specializes separately for integer and real arrays', () => {
        const runtime = new Interpreter();
        runtime.execute('fun double Row\n  return Row * 2\nend\nA = array 1 2 3\nB = array 1.0 2.0 3.0');
        expect(formatValue(runtime.execute('A double')!)).toBe('2 4 6');
        expect(formatValue(runtime.execute('B double')!)).toBe('2 4 6');
    });
});
