import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    return formatValue(runtime.execute(source)!);
}

describe('array shape with a dimension vector', () => {
    it('builds an array from a shape vector', () => {
        expect(run('B = array shape (array 2 3) fill 7\nB shape')).toBe('2 3');
        expect(run('S = array 2 3 4\nB = array shape S fill 0\nB shape')).toBe('2 3 4');
    });
    it('matches the variadic form', () => {
        expect(run('S = array 2 3\nB = array shape S fill 5\nB')).toBe(run('B = array shape 2 3 fill 5\nB'));
    });
    it('keeps a single integer dimension', () => {
        expect(run('B = array shape 3 fill 1\nB')).toBe('1 1 1');
    });
    it('rejects a matrix or a negative dimension', () => {
        expect(() => run('S = array shape 2 2 fill 1\nB = array shape S fill 0\nB')).toThrow('vector');
        expect(() => run('B = array shape (array 2 -1) fill 0\nB')).toThrow('nonnegative');
    });
});
