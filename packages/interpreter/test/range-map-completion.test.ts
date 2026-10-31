import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    const runtime = new Interpreter();
    try { return formatValue(runtime.execute('use sequences\nuse numbers\n' + source)!); } finally { runtime.dispose(); }
}

const nums = Array.from({ length: 200 }, (_, i) => 5 + i);
const join = (cells: (number | bigint | boolean)[]) => cells.join(' ');

describe('scalar maps over ranges', () => {
    it('fills real arithmetic from the packed range', () => {
        expect(run('(5 to 204) * 0.5')).toBe(join(nums.map(x => x * 0.5)));
        expect(run('0.5 - (5 to 204)')).toBe(join(nums.map(x => 0.5 - x)));
    });
    it('fills integer arithmetic and comparisons', () => {
        expect(run('(5 to 204) * 3')).toBe(join(nums.map(x => x * 3)));
        expect(run('(5 to 204) less 100.5')).toBe(join(nums.map(x => x < 100.5)));
        expect(run('100 at most (5 to 204)')).toBe(join(nums.map(x => 100 <= x)));
    });
    it('compares real cells to a scalar', () => {
        expect(run('((5 to 204) * 0.5) at least 50.0')).toBe(join(nums.map(x => x * 0.5 >= 50)));
    });
    it('stays lazy for a taken prefix', () => {
        expect(run('((1 to 1000000000) * 2) take 3')).toBe('2 4 6');
    });
});
