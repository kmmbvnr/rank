import { isExpressionStatement } from '@arrrank/language';
import { describe, expect, it } from 'vitest';
import { Interpreter, parse, isRankSequence, type RankArray } from '../src/index.js';
import { derivedArray } from '../src/array-storage.js';
import { native } from '../src/modules/shared.js';

describe('runtime ownership boundaries', () => {
    it.each(['execute', 'executeProgram', 'evaluate'] as const)('invalidates untracked caches across nested %s', entry => {
        for (const throws of [false, true]) {
            const source: RankArray = { kind: 'array', shape: [1], items: [1n] };
            const observed = derivedArray([1], [source], index => source.items[index]);
            const outer = new Interpreter(), inner = new Interpreter();
            inner.variables.set('change', native('change', 0, () => {
                source.items[0] = 2n;
                expect(observed.itemAt!(0)).toBe(2n);
                if (throws) throw new Error('inner');
                return 0n;
            }));
            outer.variables.set('probe', native('probe', 0, () => {
                expect(observed.itemAt!(0)).toBe(1n);
                try {
                    if (entry === 'execute') inner.execute('change');
                    else {
                        const program = parse('change');
                        if (entry === 'executeProgram') inner.executeProgram(program);
                        else {
                            const statement = program.statements[0];
                            if (!isExpressionStatement(statement)) throw new Error('missing expression');
                            inner.evaluate(statement.value);
                        }
                    }
                } catch (error) {
                    if (!throws || !(error instanceof Error) || !error.message.includes('inner')) throw error;
                }
                return observed.itemAt!(0);
            }));
            try { expect(outer.execute('probe')).toBe(2n); }
            finally { outer.dispose(); inner.dispose(); }
        }
    });

    it('interleaves lazy generators from independent interpreters across host writes', () => {
        const source: RankArray = { kind: 'array', shape: [1], items: [1n] };
        const observed = derivedArray([1], [source], index => source.items[index]);
        const runtimes = [new Interpreter(), new Interpreter()];
        const iterators = runtimes.map(runtime => {
            runtime.variables.set('readcell', native('readcell', 0, () => observed.itemAt!(0)));
            const value = runtime.execute('fun values\n  for I in 1 to 2\n    yield readcell\n  end\nend\nvalues');
            if (!value || !isRankSequence(value)) throw new Error('missing sequence');
            return value.plan.iterate();
        });
        try {
            expect(iterators[0].next().value).toBe(1n);
            source.items[0] = 2n;
            expect(iterators[1].next().value).toBe(2n);
            source.items[0] = 3n;
            expect(iterators[0].next().value).toBe(3n);
        } finally {
            for (const iterator of iterators) iterator.return?.();
            for (const runtime of runtimes) runtime.dispose();
        }
    });
});
