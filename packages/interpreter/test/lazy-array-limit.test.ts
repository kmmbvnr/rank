import { expect, it } from 'vitest';
import { Interpreter, RankError } from '../src/index.js';

it.each([true, false])('bounds opaque lazy reader chains without forcing them (compiled=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    let reads = 0;
    runtime.variables.set('Opaque', { kind: 'array', shape: [1], items: [],
        itemAt() { reads++; return 0n; } });
    try {
        let failure: unknown;
        try {
            runtime.execute('A = Opaque\nfor I in 0 till 2000\n A = A + 1\nend');
        } catch (error) { failure = error; }
        expect(failure).toBeInstanceOf(RankError);
        expect(failure).toMatchObject({ rankKind: 'ResourceLimit' });
        expect((failure as Error).message).toContain('use copy');
        expect(reads).toBe(0);
        runtime.execute('use sequences\nA = A copy\nfor I in 0 till 2000\n A = A + 1\nend');
        expect(runtime.execute('A 0')).toBeGreaterThan(2000n);
        expect(reads).toBe(1);
    } finally { runtime.dispose(); }
});
