import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction } from '../src/index.js';

describe('single-expression function bindings', () => {
    it('supports both definition forms and replacement', () => {
        const runtime = new Interpreter();
        expect(runtime.execute('use numbers\nf = abs sqrt\n9 f')).toBe(3);
        expect(runtime.execute('f A B = (A abs) + B\n-3 2 f')).toBe(5n);
    });
    it('preserves unary and binary entry arities', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers\npositive_max = max abs');
        const fn = runtime.variables.get('positive_max')!;
        expect(isNativeFunction(fn) && fn.arities).toEqual([1, 2]);
        expect(runtime.execute('(array -3 -4) positive_max')).toBe(3n);
        expect(runtime.execute('-3 -4 positive_max')).toBe(3n);
        runtime.execute('binary_max = max rank 0 0 abs');
        const binary = runtime.variables.get('binary_max')!;
        expect(isNativeFunction(binary) && binary.arities).toEqual([2]);
        expect(runtime.execute('-3 -4 binary_max')).toBe(3n);
    });
    it('rejects incompatible later stages and ambiguous factory syntax at definition analysis', () => {
        expect(() => new Interpreter().execute('use numbers\nuse linalg\nf = abs matmul')).toThrow(/must accept one value/);
        expect(() => new Interpreter().execute('f = 10 make')).toThrow(/explicit parameters/);
    });
    it('does not invoke a nullary alias', () => {
        const runtime = new Interpreter();
        runtime.execute('fun zero\n return 7\nend\nf = zero');
        expect(runtime.variables.get('f')).toBe(runtime.variables.get('zero'));
        expect(runtime.execute('f')).toBe(7n);
    });
    it('makes bindings available only after their definition', () => {
        expect(() => new Interpreter().execute('3 f\nf = abs')).toThrow(/before|unknown/);
    });
    it('keeps internal rank separate from whole-function external rank', () => {
        const runtime = new Interpreter();
        runtime.execute('use linalg\nuse sequences\ntotal = matmul sum\nA = (array 1 0 0 1 2 0 0 2) reshape 2 2 2');
        expect(runtime.execute('A A total')).toBe(18n);
        expect(runtime.execute('A A total rank 2 2')).toMatchObject({ items: [2n, 8n] });
    });
    it('passes tuples as one result and resolves callback pipelines at definition time', () => {
        const runtime = new Interpreter();
        expect(runtime.execute('fun pair A B\n return tuple A B\nend\nf = pair len\n3 4 f')).toBe(2n);
        runtime.execute('use numbers\nfun apply op X\n composed = op abs\n return X composed\nend');
        const apply = runtime.variables.get('apply')!;
        expect(isNativeFunction(apply) && apply.call([runtime.execute('abs')!, -3n])).toBe(3n);
        runtime.execute('through = apply abs');
        const through = runtime.variables.get('through')!;
        expect(isNativeFunction(through) && through.call([runtime.execute('abs')!, -3n])).toBe(3n);
    });
    it('distinguishes delayed explicit bodies from immediate grouped factories', () => {
        const runtime = new Interpreter();
        runtime.execute('fun make Base\n fun add X\n  return Base + X\n end\n return add\nend\nf = (10 make)');
        expect(runtime.execute('5 f')).toBe(15n);
        runtime.execute('fail X = .Failure raise');
        expect(() => runtime.execute('1 fail')).toThrow();
    });
    it('requires lowercase function bindings and callback parameters', () => {
        expect(() => new Interpreter().execute('use numbers\nF = abs')).toThrow(/lowercase/);
        const runtime = new Interpreter();
        runtime.execute('use numbers\nfun apply F X\n return X F\nend');
        const apply = runtime.variables.get('apply')!;
        expect(() => isNativeFunction(apply) && apply.call([runtime.execute('abs')!, -3n])).toThrow(/lowercase/);
    });
    it('counts operation parameters separately from input operands', () => {
        const runtime = new Interpreter();
        expect(runtime.execute('use sequences\nf = window 2 len\n(array 1 2 3 4) f')).toBe(3n);
        expect(runtime.execute('reshape_sum = reshape 2 2 sum\n(array 1 2 3 4) reshape_sum')).toBe(10n);
    });
    it('releases definitions introduced inside a block', () => {
        const runtime = new Interpreter();
        runtime.execute('use numbers\nif true\n local = abs\n Result = -3 local\nend');
        expect(runtime.variables.has('local')).toBe(false);
        expect(() => runtime.execute('-3 local')).toThrow(/unknown/);
    });
    it('imports only function definitions in source order', () => {
        const runtime = new Interpreter(undefined, { loadModule: () => ({ id: 'module.ra', source: 'use numbers\nf = abs sqrt\ng X = X f\n1 / 0' }) });
        expect(runtime.execute('use "module.ra"\n9 g')).toBe(3);
    });
});
