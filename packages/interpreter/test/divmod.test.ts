import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { isRankTuple } from '../src/value.js';
import { run } from './support.js';

describe('divmod', () => {
    it.each([false, true])('matches floor division and modulo (compiled=%s)', compiled => {
        const interpreter = new Interpreter(undefined, { scalarFunctionCompilation: compiled });
        interpreter.execute('fun N D split\nreturn N divmod D\nend');
        for (const a of ['17', '-17', '0', '100000000000000000000000000000000000001',
            '17.5', '-17.5', '1.0', '0.0', '0.3']) {
            for (const b of ['5', '-5', '5.0', '-5.0', '0.1', '-0.1']) {
                const pair = interpreter.execute(`${a} ${b} split`)!;
                expect(isRankTuple(pair)).toBe(true);
                if (!isRankTuple(pair)) throw new Error('expected tuple');
                expect(pair.items[0]).toBe(interpreter.execute(`${a} // ${b}`));
                expect(pair.items[1]).toBe(interpreter.execute(`${a} mod ${b}`));
            }
        }
    });

    it('unpacks exact integer results and reassigns an operand', () => {
        expect(run('unpack Q R = .NA divmod 3\narray Q R')).toBe('.NA .NA');
        expect(run('N = 342\nunpack Hundreds N = N divmod 100\narray Hundreds N')).toBe('3 42');
        expect(run('unpack Q R = 17 divmod 5\nQ * 5 + R')).toBe('17');
        expect(run('unpack Q R = (10 + 7) divmod (2 + 3)\narray Q R')).toBe('3 2');
    });

    it('broadcasts into separate quotient and remainder arrays', () => {
        expect(run('unpack Q R = (array 7 -7 9) divmod 3\nQ')).toBe('2 -3 3');
        expect(run('unpack Q R = (array 7 -7 9) divmod 3\nR')).toBe('1 2 0');
        expect(run('unpack Q R = 17 divmod (array 3 -5)\nQ')).toBe('5 -4');
        expect(run('unpack Q R = 17 divmod (array 3 -5)\nR')).toBe('2 -3');
        expect(run('unpack Q R = (array 7 9) divmod (array 3 4)\nR')).toBe('1 1');
        expect(run('unpack Q R = (array 7.5 9.5) divmod 2\nR')).toBe('1.5 1.5');
        expect(run('use sequences\nunpack Q R = (array shape 2 1 fill 7) divmod (array 2 3)\nQ shape')).toBe('2 2');
        expect(run('unpack Q R = (array shape 2 1 fill 7) divmod (array 2 3)\nQ')).toBe('3 2 3 2');
    });

    it('reports invalid operands and zero divisors', () => {
        for (const divisor of ['0', '0.0', '-0.0']) {
            expect(() => run(`17 divmod ${divisor}`)).toThrow('division by zero');
        }
        expect(() => run('"x" divmod 3')).toThrow('numeric');
        expect(() => run('3 divmod true')).toThrow('numeric');
        expect(() => run('unpack Q R = 17 divmod (array 3 0)\nR')).toThrow('division by zero');
        expect(() => run('(array 1 2) divmod (array 1 2 3)')).toThrow();
    });
});
