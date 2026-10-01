import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { argumentSignature } from '../src/return-contract.js';

describe('argument signature memo', () => {
    it('follows a changed element type of the same array', () => {
        const runtime = new Interpreter();
        runtime.execute('A = array 1 2 3');
        const first = argumentSignature([runtime.variables.get('A')!]);
        runtime.execute('A 0 = 1.5');
        expect(argumentSignature([runtime.variables.get('A')!])).not.toBe(first);
    });

    it('does not mix up different scalars, arrays and argument counts', () => {
        const runtime = new Interpreter();
        runtime.execute('A = array 1 2 3\nB = array 1.5 2.5');
        const a = runtime.variables.get('A')!, b = runtime.variables.get('B')!;
        const keys = [[1n], [1.5], [a], [b], [a, b], [b, a], [1n, a], ['x']].map(args => argumentSignature(args));
        expect(new Set(keys).size).toBe(keys.length);
        expect(argumentSignature([a])).toBe(keys[2]);
    });

    it('keeps return contracts exact across calls that change element types', () => {
        const runtime = new Interpreter();
        runtime.execute('fun double Row\n  return Row * 2\nend\nA = array 1 2 3');
        expect(formatValue(runtime.execute('A double')!)).toBe('2 4 6');
        runtime.execute('A 0 = 1.5');
        expect(formatValue(runtime.execute('A double')!)).toBe('3 4 6');
    });
});
