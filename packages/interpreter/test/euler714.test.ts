import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/714_duodigits.ra', import.meta.url), 'utf8');
// Try successive multiples: no digit-pair generation or residue BFS.
function brute(count: number): number {
    let total = 0;
    for (let divisor = 1; divisor <= count; divisor++) {
        for (let multiple = divisor; ; multiple += divisor) {
            if (new Set(String(multiple)).size <= 2) { total += multiple; break; }
        }
    }
    return total;
}
for (const compilation of [false, true]) describe(`Euler 714 (compiled=${compilation})`, () => {
    it.each([1, 2, 9, 10, 11, 99, 100, 102, 103, 110, 150, 290, 317, 500])('matches direct multiples through %i', count => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('arg Count integer = 50000', `Count = ${count}`)
                .replace('arg Longest integer = 18', 'Longest = 8')
                .replace('arg Block integer = 16777216', 'Block = 8192'));
            expect(runtime.variables.get('Together')).toBe(brute(count));
        } finally { runtime.dispose(); }
    });
    it.each([1, 2])('preserves residue BFS with a %i-digit enumeration prefix', longest => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('arg Count integer = 50000', 'Count = 110')
                .replace('arg Longest integer = 18', `Longest = ${longest}`)
                .replace('arg Block integer = 16777216', 'Block = 8192'));
            expect(runtime.variables.get('Together')).toBe(11047);
        } finally { runtime.dispose(); }
    });
});
