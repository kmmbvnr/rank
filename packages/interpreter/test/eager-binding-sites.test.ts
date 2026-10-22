import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, tuple, type RankArray, type RankValue } from '../src/index.js';
import { completed } from '../src/execution.js';
import { ownedArray, denseScalarItems } from '../src/array-storage.js';
import { sequence } from '../src/sequence.js';
import type { RankPlan } from '../src/plan.js';

function plan(evaluate: () => RankValue): RankPlan {
    return { kind: 'plan', dependencies: new Map(), evaluate: () => completed(evaluate()) };
}

describe.each([false, true])('unpack storage boundaries (compilation=%s)', compilation => {
    it('completes each named tuple position and retains it for repeated reads', () => {
        let calls = 0;
        let reads = 0;
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', tuple([
            plan(() => { calls++; return sequence({ name: 'tuple source', size: { kind: 'exact', value: 3n },
                *iterate() { for (let value = 1n; value <= 3n; value++) { reads++; yield value; } },
            }); }),
            plan(() => { calls++; return 7n; }),
        ]));
        try {
            runtime.execute('unpack Values Total = Input');
            expect(calls).toBe(2);
            expect(reads).toBe(3);
            expect(runtime.variables.get('Values')).toMatchObject({ kind: 'array', shape: [3] });
            expect(runtime.execute('(Values sum) + (Values sum) + Total')).toBe(19n);
            expect(calls).toBe(2);
            expect(reads).toBe(3);
        } finally { runtime.dispose(); }
    });

    it('leaves an ignored position unevaluated', () => {
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', tuple([plan(() => { throw new Error('ignored'); }), 7n]));
        try {
            runtime.execute('unpack # Value = Input');
            expect(runtime.variables.get('Value')).toBe(7n);
        } finally { runtime.dispose(); }
    });

    it('completes all named positions before publishing them', () => {
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', tuple([plan(() => 1n), plan(() => { throw new Error('completion failed'); })]));
        try {
            runtime.execute('A = 9\nB = 8');
            expect(() => runtime.execute('unpack A B = Input')).toThrowError('completion failed');
            expect(runtime.variables.get('A')).toBe(9n);
            expect(runtime.variables.get('B')).toBe(8n);
        } finally { runtime.dispose(); }
    });

    it('stores writable tensor slices with independent source cells', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('use sequences\nM = (1 to 6) reshape 2 3\nunpack A B C = M axis 1');
            const a = runtime.variables.get('A') as RankArray;
            expect(a.shape).toEqual([2]);
            expect(denseScalarItems(a)).toBeDefined();
            runtime.execute('A 0 = 99');
            expect(formatValue(runtime.variables.get('A')!)).toBe('99 4');
            expect(runtime.execute('M 0 0')).toBe(1n);
        } finally { runtime.dispose(); }
    });
});

describe.each([
    { compilation: false, directIteration: true },
    { compilation: false, directIteration: false },
    { compilation: true, directIteration: true },
    { compilation: true, directIteration: false },
])('for storage boundaries ($compilation, direct=$directIteration)', options => {
    it('materializes a planned item once before the body reads it', () => {
        let reads = 0;
        let calls = 0;
        const runtime = new Interpreter(undefined, options);
        runtime.variables.set('Input', sequence({ name: 'planned items', size: { kind: 'exact', value: 1n },
            *iterate() { yield plan(() => { calls++; return { kind: 'array', shape: [2], items: [],
                itemAt: index => { reads++; return BigInt(index + 1); } }; }); },
        }));
        try {
            runtime.execute('Total = 0\nSeen = array shape 0 fill 0\nfor Row I in Input\n Seen = Row\n Total += (Row sum) + (Row sum) + I\nend');
            expect(runtime.variables.get('Total')).toBe(6n);
            expect(runtime.variables.get('Seen')).toMatchObject({ kind: 'array', shape: [2] });
            expect(calls).toBe(1);
            expect(reads).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('declares the computed array type of sequence-valued cells', () => {
        const runtime = new Interpreter(undefined, options);
        runtime.variables.set('Input', ownedArray([sequence({ name: 'range cell', size: { kind: 'exact', value: 2n },
            *iterate() { yield 2n; yield 3n; },
        })]));
        try {
            runtime.execute('Total = 0\nSeen = array shape 0 fill 0\nfor Values in Input\n Seen = Values\n Total += Values sum\nend');
            expect(runtime.variables.get('Total')).toBe(5n);
            expect(runtime.variables.get('Seen')).toMatchObject({ kind: 'array', shape: [2] });
        } finally { runtime.dispose(); }
    });

    it('does not complete an ignored item or read past a break', () => {
        let reads = 0;
        let closed = 0;
        const runtime = new Interpreter(undefined, options);
        runtime.variables.set('Input', sequence({ name: 'ignored item', size: { kind: 'unknown' },
            *iterate() {
                try {
                    reads++;
                    yield plan(() => { throw new Error('ignored'); });
                    throw new Error('read past break');
                } finally { closed++; }
            },
        }));
        try {
            runtime.execute('Seen = -1\nfor # I in Input\n Seen = I\n break\nend');
            expect(runtime.variables.get('Seen')).toBe(0n);
            expect(reads).toBe(1);
            expect(closed).toBe(1);
        } finally { runtime.dispose(); }
    });
});

it.each([false, true])('shares completion with the suspending generator loop (compiled=%s)', generatorLoopCompilation => {
    let calls = 0;
    let entries = 0;
    const runtime = new Interpreter(undefined, { generatorLoopCompilation, loopYieldCompilation: false,
        onGeneratorLoopExecuted: () => entries++ });
    runtime.variables.set('Input', sequence({ name: 'generator loop source', size: { kind: 'unknown' },
        *iterate() { yield plan(() => { calls++; return 4n; }); },
    }));
    try {
        runtime.execute("fun Source' relay\n for Value in Source\n  yield Value + Value\n end\nend\nSaved = Input relay");
        expect(formatValue(runtime.variables.get('Saved')!)).toBe('8');
        expect(calls).toBe(1);
        expect(entries).toBe(generatorLoopCompilation ? 1 : 0);
    } finally { runtime.dispose(); }
});
