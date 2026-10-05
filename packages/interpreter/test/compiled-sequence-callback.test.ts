import { describe, expect, it, vi } from 'vitest';
import { Interpreter, isRankArray, type RankValue } from '../src/index.js';
import { isNativeFunction, isRankSequence } from '../src/value.js';
import { sequence } from '../src/sequence.js';
import { native } from '../src/modules/shared.js';

function setup(compiled: boolean, declaration: string) {
    const runtime = new Interpreter(undefined, { scalarFunctionCompilation: compiled });
    runtime.execute(`use sequences\nuse text\n${declaration}`);
    const fn = runtime.variables.get('helper');
    if (!fn || !isNativeFunction(fn)) throw new Error('missing helper');
    return { runtime, calls: vi.spyOn(fn, 'call') };
}

describe('prepared sequence and dyadic callbacks', () => {
    it.each([false, true])('keeps sequence reads lazy and falls back without replay (compiled=%s)', compiled => {
        const { runtime, calls } = setup(compiled, 'fun helper X\nreturn X text reverse\nend');
        const reads: number[] = [];
        try {
            runtime.variables.set('Source', sequence({ name: 'source', size: { kind: 'unknown' },
                *iterate() {
                    for (let index = 0; index < 4; index++) {
                        reads.push(index);
                        if (index === 1) runtime.variables.set('reverse', native('replacement', 1, ([value]) => `changed:${value}`));
                        yield BigInt(12 + index);
                    }
                },
            }));
            runtime.execute('Mapped = Source helper rank 0');
            expect(reads).toEqual([]);
            const mapped = runtime.variables.get('Mapped');
            if (!mapped || !isRankSequence(mapped)) throw new Error('missing sequence');
            const iterator = mapped.plan.iterate()[Symbol.iterator]();
            expect(iterator.next().value).toBe('21');
            expect(reads).toEqual([0]);
            expect(calls).toHaveBeenCalledTimes(compiled ? 0 : 1);
            expect(iterator.next().value).toBe('changed:13');
            expect(reads).toEqual([0, 1]);
            expect(calls).toHaveBeenCalledTimes(compiled ? 1 : 2);
            iterator.return?.();
        } finally { runtime.dispose(); }
    });

    it('keeps the reference dyadic read order and fallback behavior', () => {
        const run = (compiled: boolean) => {
            const { runtime, calls } = setup(compiled, 'fun helper X Y rank 0 0\nreturn (X + Y) text reverse\nend');
            const reads: string[] = [];
            try {
                for (const name of ['Left', 'Right']) runtime.variables.set(name, {
                    kind: 'array', shape: [3], containsFiles: false, items: [],
                    itemAt(index: number): RankValue {
                        reads.push(`${name}:${index}`);
                        if (name === 'Right' && index === 1) runtime.variables.set('reverse', native('replacement', 1, ([value]) => `changed:${value}`));
                        return BigInt((name === 'Left' ? 10 : 2) + index);
                    },
                });
                runtime.execute('Mapped = Left Right helper');
                const mapped = runtime.variables.get('Mapped');
                if (!mapped || !isRankArray(mapped)) throw new Error('missing array');
                return { values: [...mapped.items], reads, calls: calls.mock.calls.length };
            } finally { runtime.dispose(); }
        };
        const reference = run(false);
        const compiled = run(true);
        expect(compiled.values).toEqual(reference.values);
        expect(compiled.reads).toEqual(reference.reads);
        expect(compiled.calls).toBeLessThan(reference.calls);
        expect(compiled.values).toContain('changed:14');
    });
    it.each([
        ['(array 1 2) (array 3 4) outer helper', [4n, 5n, 5n, 6n]],
        ['(array 1 2 3) scan helper', [1n, 3n, 6n]],
        ['(array 1 2 3) scan helper with 0', [0n, 1n, 3n, 6n]],
        ['((array 1 2 3 4) reshape 2 2) scan helper axis 1', [1n, 3n, 3n, 7n]],
    ] as const)('uses the checked kernel for %s', (expression, expected) => {
        for (const compiled of [false, true]) {
            const { runtime, calls } = setup(compiled, 'fun helper X Y rank 0 0\nreturn X + Y\nend');
            try {
                const value = runtime.execute(expression);
                if (!value || !isRankArray(value)) throw new Error('missing result');
                expect([...value.items]).toEqual(expected);
                if (compiled) expect(calls).not.toHaveBeenCalled();
                else expect(calls).toHaveBeenCalled();
            } finally { runtime.dispose(); }
        }
    });

    it('keeps a named scan lazy and checks native replacements between source reads', () => {
        const run = (compiled: boolean) => {
            const { runtime, calls } = setup(compiled, 'fun helper X Y\nreturn (X + Y) text len\nend');
            const reads: number[] = [];
            try {
                runtime.variables.set('Source', sequence({ name: 'source', size: { kind: 'unknown' },
                    *iterate() {
                        for (let index = 0; index < 4; index++) {
                            reads.push(index);
                            if (index === 2) runtime.variables.set('len', native('replacement', 1, () => 99n));
                            yield BigInt(index + 1);
                        }
                    },
                }));
                runtime.execute('Mapped = Source scan helper');
                expect(reads).toEqual([]);
                const mapped = runtime.variables.get('Mapped');
                if (!mapped || !isRankSequence(mapped)) throw new Error('missing sequence');
                const iterator = mapped.plan.iterate()[Symbol.iterator]();
                const values = [iterator.next().value, iterator.next().value, iterator.next().value];
                iterator.return?.();
                return { values, reads, calls: calls.mock.calls.length };
            } finally { runtime.dispose(); }
        };
        expect(run(false)).toEqual({ values: [1n, 1n, 99n], reads: [0, 1, 2], calls: 2 });
        expect(run(true)).toEqual({ values: [1n, 1n, 99n], reads: [0, 1, 2], calls: 1 });
    });

});
