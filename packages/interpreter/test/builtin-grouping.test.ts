import { describe, expect, it } from 'vitest';
import { Interpreter, parse } from '../src/index.js';

describe('binding-aware builtin grouping', () => {
    it.each(['round'])('keeps user-defined %s calls and result indexing', name => {
        const runtime = new Interpreter();
        expect(runtime.execute(`fun X ${name}\n return array X X X\nend\n5 ${name} 0`)).toBe(5n);
        expect(runtime.execute(`7 ${name} 0`)).toBe(7n);
    });

    it('keeps subtraction after a user-defined round', () => {
        expect(new Interpreter().execute('fun X round\n return X\nend\n5 round - 2')).toBe(3n);
    });

    it.each(['min', 'max'])('reports the binding conflict for %s instead of a builtin call diagnostic', name => {
        const source = `fun X ${name}\n return array X X X\nend\n5 ${name} 0`;
        expect(() => parse(source)).not.toThrow();
        expect(() => new Interpreter().execute(source)).toThrow(`cannot redefine available builtin: ${name}`);
    });

    it('retains builtin rounding and extrema diagnostics', () => {
        const runtime = new Interpreter();
        expect(runtime.execute('use numbers\n2.5 round 0')).toBe(2);
        expect(runtime.execute('1250 round -2')).toBe(1200n);
        expect(runtime.execute('5 min 0')).toBe(0n);
        expect(runtime.execute('5 max 0')).toBe(5n);
    });
});
