import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction } from '../src/index.js';

describe('single-expression function bindings', () => {
    it('keeps both inline and multiline declarations constant', () => {
        const runtime = new Interpreter();
        expect(runtime.execute('fun X f = X + 1\n3 f')).toBe(4n);
        expect(() => runtime.execute('fun X f = X + 2')).toThrow(/function declaration/);
        runtime.execute('fun X fixed\n  return X + 1\nend');
        expect(() => runtime.execute('fun X fixed = X + 2')).toThrow(/function declaration/);
        expect(() => runtime.execute('fun X fixed\n  return X + 2\nend')).toThrow(/function declaration/);
        expect(runtime.execute('3 fixed')).toBe(4n);
        runtime.forgetBindings(['fixed']);
        expect(runtime.execute('fun X fixed\n  return X + 3\nend\n3 fixed')).toBe(6n);
    });
    it('requires forgetting a binding before replacing it with a declaration', () => {
        const runtime = new Interpreter();
        expect(runtime.execute('use numbers\nf = abs sqrt\n9 f')).toBe(3);
        runtime.forgetBindings(['f']);
        expect(runtime.execute('fun A B f = (A abs) + B\n-3 2 f')).toBe(5n);
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
        expect(runtime.execute('fun A B pair\n return tuple A B\nend\nf = pair len\n3 4 f')).toBe(2n);
        runtime.execute('use numbers\nfun X apply op\n composed = op abs\n return X composed\nend');
        const apply = runtime.variables.get('apply')!;
        expect(isNativeFunction(apply) && apply.call([-3n, runtime.execute('abs')!])).toBe(3n);
        runtime.execute('through = apply abs');
        const through = runtime.variables.get('through')!;
        expect(isNativeFunction(through) && through.call([-3n, runtime.execute('abs')!])).toBe(3n);
    });
    it('distinguishes delayed explicit bodies from immediate grouped factories', () => {
        const runtime = new Interpreter();
        runtime.execute('fun Base make\n fun X add\n  return Base + X\n end\n return add\nend\nf = (10 make)');
        expect(runtime.execute('5 f')).toBe(15n);
        runtime.execute('fun X fail = .Failure raise');
        expect(() => runtime.execute('1 fail')).toThrow();
    });
    it('requires lowercase function bindings and callback parameters', () => {
        expect(() => new Interpreter().execute('use numbers\nF = abs')).toThrow(/lowercase/);
        const runtime = new Interpreter();
        runtime.execute('use numbers\nfun F X apply\n return X F\nend');
        const apply = runtime.variables.get('apply')!;
        expect(() => isNativeFunction(apply) && apply.call([runtime.execute('abs')!, -3n])).toThrow(/lowercase/);
    });
    it.each([false, true])('preserves positional parameter contracts (compilation=%s)', compilation => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('fun accept value\n return value\nend\nfun Value scalar\n return Value\nend');
            const accept = runtime.variables.get('accept')!;
            const scalar = runtime.variables.get('scalar')!;
            if (!isNativeFunction(accept) || !isNativeFunction(scalar)) throw new Error('expected functions');
            // Lowercase parameters require a callable operand.
            expect(() => accept.call([7n])).toThrow('value expects a function');
            expect(accept.call([scalar])).toBe(scalar);
            expect(() => scalar.call([accept])).toThrow('Function parameters use lowercase names: Value');
            expect(() => scalar.call([])).toThrow('scalar expects 1 arguments, got 0');
            expect(() => scalar.call([1n, 2n])).toThrow('scalar expects 1 arguments, got 2');
        } finally { runtime.dispose(); }
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
        const runtime = new Interpreter(undefined, { loadModule: () => ({ id: 'module.ra', source: 'use numbers\nf = abs sqrt\nfun X g = X f\n1 / 0' }) });
        expect(runtime.execute('use "module.ra"\n9 g')).toBe(3);
    });
    it.each(['fun', 'memo', 'generator'])('runs imported %s declarations against the program globals', kind => {
        const body = kind === 'generator' ? 'yield Seed + N' : 'return Seed + N';
        const source = `use sequences\nSeed = 7\n${kind === 'memo' ? 'memo' : 'fun'} N value\n  ${body}\nend\n`
            + (kind === 'generator' ? '(2 value) first' : '2 value');
        const runtime = new Interpreter(undefined, { loadModule: () => ({ id: 'module.ra', source }) });
        expect(runtime.execute('run "module.ra"')).toBe(9n);
        expect(runtime.execute('run "module.ra"')).toBe(9n);
    });
});
