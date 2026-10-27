import { describe, expect, it } from 'vitest';
import { Interpreter, parse } from '../src/index.js';
import { native } from '../src/modules/shared.js';

describe.each([false, true])('prepared scalar expressions (compilation=%s)', compilation => {
    it('reads public binding replacements and deletions through the same prepared program', () => {
        const r = new Interpreter(() => {}, { compilation });
        const program = parse('Answer = X * 3 + 1');
        try {
            r.variables.set('X', 2n);
            r.executeProgram(program);
            expect(r.variables.get('Answer')).toBe(7n);
            r.variables.set('X', 5n);
            r.executeProgram(program);
            expect(r.variables.get('Answer')).toBe(16n);
            r.variables.delete('X');
            expect(() => r.executeProgram(program)).toThrow('unknown name: X');
        } finally { r.dispose(); }
    });

    it('falls back when live operands change from integers to real, text or arrays', () => {
        const r = new Interpreter(() => {}, { compilation });
        const program = parse('X + Y');
        try {
            for (const [x, y, expected] of [[2n, 3n, 5n], [2.5, 3n, 5.5], ['a', 'b', 'ab']] as const) {
                r.variables.set('X', x); r.variables.set('Y', y);
                expect(r.executeProgram(program)).toBe(expected);
            }
            r.variables.delete('X'); r.variables.delete('Y');
            r.execute('use sequences\nX = array 1 2\nY = array 3 4');
            r.variables.set('Result', r.executeProgram(program)!);
            expect(r.execute('Result sum')).toBe(10n);
        } finally { r.dispose(); }
    });

    it('still invokes a live nullary host function at each read', () => {
        const r = new Interpreter(() => {}, { compilation });
        let calls = 0;
        try {
            r.variables.set('next', native('next', 0, () => BigInt(++calls)));
            expect(r.execute('next * 10 + next')).toBe(12n);
            expect(calls).toBe(2);
        } finally { r.dispose(); }
    });
});
