import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, demandValue, isRankArray, isRankPlan, isRankSequence } from '@arrrank/interpreter';
import { SequenceReplay } from '../src/sequence-replay.js';
import { preview } from '../src/preview.js';
import { inspectValue } from '../src/value-inspection.js';

describe.each([false, true])('explicit sequence plans alongside REPL tapes (compilation=%s)', compilation => {
    it('bounds scalar plan preview and leaves subsequent demands usable', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute("use sequences\nfun X never = false\nStuck' = (1 to # filter never) take 1 sum");
            const stuck = runtime.variables.get('Stuck')!;
            expect(preview(stuck)).toEqual({ text: '...', note: 'preview demand budget exhausted' });
            expect(preview(stuck)).toEqual({ text: '...', note: 'preview demand budget exhausted' });
            expect(runtime.execute('1 + 2')).toBe(3n);
        } finally { runtime.dispose(); }
    });
    it.each([['primes', 129n, 28n], ['fibonacci', 53n, 19n]] as const)(
        'intersects repeated upper bounds on %s', (source, sum, exclusive) => {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(`use numbers\nuse sequences\nG' = ${source} till 30`);
                expect(runtime.execute('G till 100 sum')).toBe(sum);
                expect(runtime.execute('(G to 13) till 13 sum')).toBe(exclusive);
                expect(runtime.execute('(G till 13) to 13 sum')).toBe(exclusive);
            } finally { runtime.dispose(); }
        });
    it.each([
        ['primes', '2 3 5 7', 17n],
        ['fibonacci', '1 2 3 5', 11n],
    ] as const)('keeps %s repeatable through aliases, preview and rewind', (source, text, sum) => {
        const replay = new SequenceReplay();
        const runtime = new Interpreter(() => {}, { compilation, wrapSinglePassSequence: replay.wrap });
        try {
            runtime.execute(`use numbers\nuse sequences\nG' = ${source}\nH' = G\nSmall' = G take 4`);
            const small = runtime.variables.get('Small')!;
            expect(replay.preview(() => preview(small)).text).toBe(text);
            expect(runtime.execute('G take 4 sum')).toBe(sum);
            expect(runtime.execute('H take 4 sum')).toBe(sum);
            replay.rewind(0);
            expect(runtime.execute('G take 4 sum')).toBe(sum);
            expect(preview(small).text).toBe(text);
            const native = demandValue(runtime.variables.get('G')!);
            expect(isRankSequence(native)).toBe(true);
            if (isRankSequence(native)) expect(replay.forced(native)).toBeUndefined();
            runtime.execute("Answer' = G take 4 sum");
            expect(inspectValue(runtime.variables.get('Answer')!, {})).toMatchObject({ kind: 'scalar', type: 'integer', text: String(sum) });
        } finally { runtime.dispose(); replay.dispose(); }
    });
    it.each(['', "'"])('preserves binding mode during preview and rewind: %s', marker => {
        const replay = new SequenceReplay();
        const runtime = new Interpreter(() => {}, {
            compilation, wrapSinglePassSequence: replay.wrap,
        });
        const stats = new RuntimeDiagnostics();
        try {
            stats.run(() => runtime.execute(`use sequences
fun X odd = X mod 2 equal 1
S${marker} = (1 to # filter odd) take 5
A = S sum
B = S sum`));
            expect(runtime.variables.get('A')).toBe(25n);
            expect(runtime.variables.get('B')).toBe(25n);
            const source = runtime.variables.get('S')!;
            expect(isRankPlan(source)).toBe(Boolean(marker));
            expect(isRankArray(source)).toBe(!marker);
            expect(stats.sequencePredicateCalls).toBe(marker ? 18 : 9);
            replay.atLine(5);
            expect(stats.run(() => replay.preview(() => runtime.execute('S sum')))).toBe(25n);
            replay.rewind(0);
            expect(stats.run(() => runtime.execute('S sum'))).toBe(25n);
            expect(stats.sequencePredicateCalls).toBe(marker ? 36 : 9);
        } finally { runtime.dispose(); replay.dispose(); }
    });
});
