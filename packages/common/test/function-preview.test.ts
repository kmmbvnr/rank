import { describe, expect, it } from 'vitest';
import { createReplSession } from '../src/repl-session.js';

describe('function result signatures', () => {
    it.each([
        ['fun inc X\n return X + 1\nend', 'integer → integer ; missing → missing ; numeric cells lift ; … (other domains)'],
        ['fun identity X\n return X\nend', 'a → a'],
        ['fun pair X\n return tuple X "label"\nend', 'a → tuple(a, text)'],
        ['fun add X Y\n return X + Y\nend', 'integer integer → integer ; integer missing → missing ; numeric cells lift ; … (other domains)'],
        ['fun countdown N\n for N greater 0\n  yield N\n  N -= 1\n end\nend', 'integer → sequence<integer> ; … (other domains)'],
    ])('shows the inferred signature for %s', async (source, signature) => {
        const session = createReplSession();
        try {
            const result = await session.execute(source, 0, [], 40, true);
            expect(result.ok).toBe(true);
            expect(result.output.map(line => line.text).join(' ')).toBe(signature);
            expect(session.preview(source).output.map(line => line.text).join(' ')).toBe(signature);
            expect(session.preview(source, 40, true).valueSummary).toBe(signature);
            const name = source.split(' ')[1];
            expect((await session.execute(name, 1, [], 40, true)).output.map(line => line.text).join(' ')).toBe(signature);
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

it('does not cache example specialization as the general function contract', async () => {
    const session = createReplSession();
    const source = 'fun twice X\n return X + X\nend';
    const general = 'integer → integer ; real → real ; numeric cells lift ; … (other domains)';
    try {
        await session.execute(source, 0, [], 40, true);
        for (const expression of ['1 twice', '1.5 twice', '2 twice']) {
            expect((await session.execute(expression, 1, [], 40, true)).ok).toBe(true);
            expect((await session.execute('twice', 2, [], 40, true)).output.map(row => row.text).join(' ')).toBe(general);
        }
        expect(session.preview(source, 40, true).valueSummary).toBe(general);
    } finally { session.dispose(); }
});
