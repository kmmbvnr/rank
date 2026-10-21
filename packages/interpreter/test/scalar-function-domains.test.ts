import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RankError, formatValue, isRankArray } from '../src/index.js';
import { isNativeFunction } from '../src/value.js';
import { native } from '../src/modules/shared.js';

function evaluate(compiled: boolean, source: string) {
    let kernels = 0;
    const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled,
        onScalarFunctionExecuted: () => kernels++ });
    try {
        const value = formatValue(runtime.execute(source)!);
        return { value, kernels };
    } catch (error) {
        if (!(error instanceof RankError)) throw error;
        return { error: error.format(), kernels };
    } finally { runtime.dispose(); }
}

describe('scalar function argument domains', () => {
    it.each([
        ['fun X Y combine\nreturn X + Y\nend\n"𝄞" "é" combine', '𝄞é'],
        ['fun X Y both\nreturn X and Y\nend\ntrue false both', 'false'],
        ['fun Flag Text picktext\nif Flag\nreturn Text reverse\nelse\nreturn Text\nend\nend\ntrue "𝄞é" picktext', '́e𝄞'],
        ['fun X Y equaltext\nreturn X equal Y\nend\n"𝄞" "𝄞" equaltext', 'true'],
    ])('matches ordinary execution for %s', (source, expected) => {
        const reference = evaluate(false, `use sequences\n${source}`);
        const compiled = evaluate(true, `use sequences\n${source}`);
        expect(reference).toEqual({ value: expected, kernels: 0 });
        expect(compiled.value).toBe(expected);
        expect(compiled.kernels).toBeGreaterThan(0);
    });

    it('keeps integer and text specializations separate and reuses changing values', () => {
        let kernels = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => kernels++ });
        try {
            runtime.execute('fun X Y combine\nreturn X + Y\nend');
            const fn = runtime.variables.get('combine');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
            expect(fn.call([1n, 2n])).toBe(3n);
            expect(fn.call(['a', 'b'])).toBe('ab');
            const serialize = vi.spyOn(JSON, 'stringify');
            try {
                expect(fn.call(['𝄞', 'é'])).toBe('𝄞é');
                expect(fn.call([20n, 30n])).toBe(50n);
                expect(serialize).not.toHaveBeenCalled();
            } finally { serialize.mockRestore(); }
            expect(kernels).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('rechecks native identity for a cached text specialization', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nfun Text flip\nreturn Text reverse\nend');
            const fn = runtime.variables.get('flip');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
            expect(fn.call(['abc'])).toBe('cba');
            runtime.variables.set('reverse', native('replacement', 1, ([text]) => `changed:${text}`));
            expect(fn.call(['def'])).toBe('changed:def');
        } finally { runtime.dispose(); }
    });

    it('rechecks floor identity and retains nonfinite domain errors', () => {
        let kernels = 0;
        const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => kernels++ });
        try {
            runtime.execute('use numbers\nfun X bound\nreturn X floor\nend');
            const fn = runtime.variables.get('bound');
            if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
            expect(fn.call([-1.5])).toBe(-2n);
            expect(kernels).toBe(1);
            for (const value of [NaN, Infinity, -Infinity]) expect(() => fn.call([value])).toThrow('floor expects a finite number');
            runtime.variables.set('floor', native('replacement', 1, () => 42n));
            expect(fn.call([1.5])).toBe(42n);
        } finally { runtime.dispose(); }
    });

    it('uses text kernels once per cell in each ranked traversal', () => {
        let kernels = 0;
        const runtime = new Interpreter(undefined, { onScalarFunctionExecuted: () => kernels++ });
        try {
            const result = runtime.execute('use sequences\nfun Text flip\nreturn Text reverse\nend\n(array "ab" "𝄞é") flip rank 0');
            if (!result || !isRankArray(result)) throw new Error('missing array');
            expect([...result.items]).toEqual(['ba', '́e𝄞']);
            expect(kernels).toBe(2);
            expect([...result.items]).toEqual(['ba', '́e𝄞']);
            expect(kernels).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('returns local results explicitly and preserves native error locations', () => {
        for (const source of [
            'fun X outer\nLocal = "before"\nfun Y rewrite\nReversed = Y reverse\nreturn Reversed\nend\nLocal = X rewrite\nreturn Local\nend\n"after" outer',
            'use text\nfun Text point\nreturn Text codepoint\nend\n"" point',
        ]) {
            const reference = evaluate(false, `use sequences\n${source}`);
            const compiled = evaluate(true, `use sequences\n${source}`);
            expect({ ...compiled, kernels: 0 }).toEqual(reference);
            if (source.startsWith('fun X outer')) expect(reference.value).toBe('retfa');
            else expect(reference.error).toContain('point');
        }
    });
});
