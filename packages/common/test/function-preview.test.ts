import { describe, expect, it } from 'vitest';
import { createReplSession } from '../src/repl-session.js';

describe('function result signatures', () => {
    it.each([
        ['fun inc X\n return X + 1\nend', 'a → b'],
        ['fun identity X\n return X\nend', 'a → a'],
        ['fun pair X\n return tuple X "label"\nend', 'a → tuple(a, text)'],
        ['fun add X Y\n return X + Y\nend', 'a b → c'],
    ])('shows the inferred signature for %s', async (source, signature) => {
        const session = createReplSession();
        try {
            const result = await session.execute(source, 0, [], 40, true);
            expect(result.ok).toBe(true);
            expect(result.output.map(line => line.text)).toEqual([signature]);
            expect(session.preview(source).output.map(line => line.text)).toEqual([signature]);
            expect(session.preview(source, 40, true).valueSummary).toBe(signature);
            const name = source.split(' ')[1];
            expect((await session.execute(name, 1, [], 40, true)).output.map(line => line.text)).toEqual([signature]);
        } finally { session.dispose(); }
    });

    it('uses the builtin signature and still executes ordinary values', async () => {
        const session = createReplSession();
        try {
            const result = await session.execute('use numbers\nsqrt', 0, [], 40, true);
            expect(result.ok).toBe(true);
            expect(result.output.map(line => line.text).join(' ')).toContain('→ real');
            expect(result.output.map(line => line.text).join(' ')).not.toContain('<function');
            expect((await session.execute('9 sqrt', 1, [], 40, true)).output.map(line => line.text)).toEqual(['3']);
        } finally { session.dispose(); }
    });
});
