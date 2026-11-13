import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/213_fleacircus.ra', import.meta.url), 'utf8');

describe.each([false, true])('Euler 213 (compilation=%s)', compilation => {
    it.each([
        [4, 2, 5.215096],
        [6, 5, 12.689647],
        [3, 1, 2.725309],
        [5, 2, 8.198453],
        [1, 50, 0],
        [2, 0, 0],
        [3, 0, 0],
        [2, 1, 1],
    ])('N=%s, Rings=%s gives %s empty cells', (n, rings, answer) => {
        const runtime = new Interpreter(() => {}, { compilation, args: [`--n=${n}`, `--rings=${rings}`] });
        try {
            runtime.execute(source);
            expect(answerOf(runtime)).toBe(answer);
        } finally { runtime.dispose(); }
    });
});
