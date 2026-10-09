import { describe, expect, it } from 'vitest';
import { createReplSession } from '../src/repl-session.js';

describe('print as the last expression', () => {
    it('shows the value once', async () => {
        const session = createReplSession();
        try {
            const lines = async (source: string) =>
                (await session.execute(source, 0, [], 40, true)).output.map(line => line.text);
            expect(await lines('use io\n42 print')).toEqual(['42']);
            expect(await lines('use io\n"a" print')).toEqual(['a']);
            expect(await lines('use io\n1 print\n2')).toEqual(['1', '2']);
        } finally { session.dispose(); }
    });
});
