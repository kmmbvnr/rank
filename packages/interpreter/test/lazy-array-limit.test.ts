import { expect, it } from 'vitest';
import { Interpreter, RankError, type RankArray } from '../src/index.js';
import { derivedArray } from '../src/array-storage.js';

it.each([true, false])('completes ordinary arithmetic bindings before another stage (compiled=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    let reads = 0;
    runtime.variables.set('Opaque', { kind: 'array', shape: [1], items: [],
        itemAt() { reads++; return 0n; } });
    try {
        runtime.execute('A = Opaque\nfor I in 0 till 6000\n A = A + 1\nend');
        expect(runtime.execute('A 0')).toBe(6000n);
        expect(reads).toBe(1);
        runtime.execute('for I in 0 till 2000\n A = A + 1\nend');
        expect(runtime.execute('A 0')).toBe(8000n);
        expect(reads).toBe(1);
    } finally { runtime.dispose(); }
});

it('bounds native reader chains without probing opaque source cells', () => {
    let reads = 0;
    let value: RankArray = { kind: 'array', shape: [1], items: [],
        itemAt() { reads++; return 0n; } };
    let failure: unknown;
    try {
        for (let depth = 0; depth < 8193; depth++) {
            const previous = value;
            value = derivedArray([1], [previous], index => previous.itemAt!(index));
        }
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RankError);
    expect(failure).toMatchObject({ rankKind: 'ResourceLimit' });
    expect((failure as Error).message).toContain('8192 reader layers');
    expect(reads).toBe(0);
});
