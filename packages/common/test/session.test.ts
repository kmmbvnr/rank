import { describe, expect, it } from 'vitest';
import { RankSession, runProgram } from '../src/index.js';

describe('RankSession', () => {
    it('keeps definitions between executions', () => {
        const session = new RankSession(() => undefined);
        try {
            session.execute('Answer = 40');
            expect(session.execute('Answer + 2')).toBe(42n);
        } finally {
            session.dispose();
        }
    });

    it('cannot execute after disposal', () => {
        const session = new RankSession(() => undefined);
        session.dispose();
        expect(() => session.execute('1')).toThrow('Rank session is disposed');
    });
});

describe('runProgram', () => {
    it('returns the final value and forwards output', () => {
        const output: string[] = [];
        const result = runProgram('use io\n1 print\n2 + 3', text => output.push(text));
        expect(output).toEqual(['1']);
        expect(result).toBe(5n);
    });
});
