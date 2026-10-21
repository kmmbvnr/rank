import { describe, expect, it } from 'vitest';
import { createReplSession } from '../src/repl-session.js';

describe('plan protection in notebook sessions', () => {
    it('keeps source protection across cells and an ordinary rebind', async () => {
        const session = createReplSession();
        try {
            expect((await session.execute("A = array 1 2\nPlan' = A * 2", 0, [], 80, true)).ok).toBe(true);
            expect((await session.execute('A = array 3 4', 1, [], 80, true)).ok).toBe(true);
            const write = await session.execute('A 0 = 9', 2, [], 80, true);
            expect(write.ok).toBe(false);
            expect(write.errorOffset).toBe(0);
            expect(write.output.some(line => line.error && line.text.includes('A is read-only because plan Plan reads it'))).toBe(true);
            const result = await session.execute('Plan', 3, [], 80, true);
            expect(result.ok).toBe(true);
            expect(result.output.map(line => line.text)).toEqual(['2 4']);
        } finally { session.dispose(); }
    });

    it('checks preview mutations without altering the retained session', async () => {
        const session = createReplSession();
        try {
            expect((await session.execute("use algo\nQ = new queue\nPlan' = Q len", 0, [], 80, true)).ok).toBe(true);
            const preview = session.preview('Q push 9');
            expect(preview.ok).toBe(false);
            expect(preview.output.some(line => line.error && line.text.includes('Q is read-only'))).toBe(true);
            const result = await session.execute('Plan', 1, [], 80, true);
            expect(result.ok).toBe(true);
            expect(result.output.map(line => line.text)).toEqual(['0']);
        } finally { session.dispose(); }
    });

    it('starts a fresh protection scope after a clean execution reset', async () => {
        const session = createReplSession();
        try {
            expect((await session.execute("A = array 1 2\nPlan' = A * 2", 0, [], 80, true)).ok).toBe(true);
            session.resetExecution();
            const result = await session.execute('A = array 3 4\nA 0 = 9\nA', 0, [], 80, true);
            expect(result.ok).toBe(true);
            expect(result.output.map(line => line.text)).toEqual(['9 4']);
        } finally { session.dispose(); }
    });
});
