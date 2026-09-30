import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    const runtime = new Interpreter();
    for (const name of ['numbers', 'bits', 'text']) runtime.execute(`use ${name}`);
    return formatValue(runtime.execute(source)!);
}

describe('binary scalar built-ins broadcast with intrinsic 0 0 ranks', () => {
    it('gcd and lcm work elementwise', () => {
        expect(run('(array 4 6) (array 6 9) gcd')).toBe('2 3');
        expect(run('(array 4 6) 6 lcm')).toBe('12 6');
        expect(run('4 6 gcd')).toBe('2');
    });

    it('bit tests a position in every value', () => {
        expect(run('(array 5 6) (array 0 1) bit')).toBe('true true');
        expect(run('(array 5 6) 0 bit')).toBe('true false');
    });

    it('round takes places per element or one for all', () => {
        expect(run('(array 1.234 5.678) (array 1 2) round')).toBe('1.2 5.68');
        expect(run('(array 1.234 5.678) 1 round')).toBe('1.2 5.7');
    });

    it('lcm of one collection is still a reduction', () => {
        expect(run('(array 4 6) lcm')).toBe('12');
    });
});
