import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, isRankPlan } from '@arrrank/interpreter';
import { SequenceReplay } from '../src/sequence-replay.js';

describe.each([false, true])('explicit sequence plans alongside REPL tapes (compilation=%s)', compilation => {
    it.each(['', "'"])('preserves binding mode during preview and rewind: %s', marker => {
        const replay = new SequenceReplay();
        const runtime = new Interpreter(() => {}, {
            compilation, wrapStoredSequence: replay.store, wrapSinglePassSequence: replay.wrap,
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
