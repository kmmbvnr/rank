import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const run = (source: string) => {
    const runtime = new Interpreter();
    try { return runtime.execute(source); } finally { runtime.dispose(); }
};

describe('pure builtins over large arrays', () => {
    const setup = 'use numbers\nuse random\nA = array shape 2000 fill 3.0\n';

    it('computes max over cells like the small lazy path', () => {
        expect(run(`${setup}B = A 5.0 max\nB sum`)).toBe(10000);
        expect(run('use numbers\nA = array shape 4 fill 3.0\nB = A 5.0 max\nB sum')).toBe(20);
    });

    it('is a value: a later write to the source does not reach the result', () => {
        expect(run(`${setup}B = A 5.0 max\nA 0 = 100.0\nB 0`)).toBe(5);
    });

    it('chains without keeping every layer lazy', () => {
        expect(run(`${setup}for I in 0 till 50\n  A = (A + 1.0) 0.0 max\nend\nA sum`)).toBe(2000 * 53);
    });

    it('reads drawn values as stored numbers', () => {
        expect(run('use random\nuse sequences\nState = 1 seed\nR = (1 to 6) 5000 choices\n(R sum) greater 0')).toBe(true);
    });
});
