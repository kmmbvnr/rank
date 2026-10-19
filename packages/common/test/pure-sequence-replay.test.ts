import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankSequence } from '@arrrank/interpreter';
import { SequenceReplay } from '../src/sequence-replay.js';

describe('pure sequence reuse alongside REPL consumption tapes', () => {
    it('does not add a second tape to a retained pure result', () => {
        const replay = new SequenceReplay();
        const runtime = new Interpreter(() => {}, {
            wrapStoredSequence: replay.store, wrapSinglePassSequence: replay.wrap,
        });
        const stats = new RuntimeDiagnostics();
        try {
            stats.run(() => runtime.execute(`use sequences
fun X odd = X mod 2 equal 1
S = (1 to # filter odd) take 5
A = S sum
B = S sum`));
            expect(runtime.variables.get('A')).toBe(25n);
            expect(runtime.variables.get('B')).toBe(25n);
            const source = runtime.variables.get('S')!;
            expect(isRankSequence(source)).toBe(true);
            if (!isRankSequence(source)) throw new Error('expected sequence');
            expect(replay.forced(source)).toBeUndefined();
            replay.atLine(5);
            expect(replay.preview(() => runtime.execute('S sum'))).toBe(25n);
            replay.rewind(0);
            expect(runtime.execute('S sum')).toBe(25n);
            expect(stats.sequenceCachedValues).toBe(5);
            expect(stats.sequencePredicateCalls).toBe(9);
        } finally { runtime.dispose(); replay.dispose(); }
    });

    it('allows an unanticipated later pure read without retaining a history', () => {
        const replay = new SequenceReplay();
        const runtime = new Interpreter(() => {}, {
            wrapStoredSequence: replay.store, wrapSinglePassSequence: replay.wrap,
        });
        const stats = new RuntimeDiagnostics();
        try {
            expect(stats.run(() => runtime.execute(`use sequences
fun X odd = X mod 2 equal 1
S = (1 to # filter odd) take 5
S sum`))).toBe(25n);
            expect(stats.run(() => runtime.execute('S sum'))).toBe(25n);
            expect(stats.sequenceCachedValues).toBe(0);
            expect(stats.sequencePredicateCalls).toBe(18);
        } finally { runtime.dispose(); replay.dispose(); }
    });
});
