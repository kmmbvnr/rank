import { describe, expect, it } from 'vitest';
import { createReplSession } from '../src/repl-session.js';
import { withInterrupt } from '@arrrank/interpreter';

describe('open ranges in notebook cells', () => {
    it.each([5, 500])('finds the Euler 12 answer for more than %i divisors cell by cell', async minimum => {
        const session = createReplSession();
        const file = ['use numbers\nuse sequences', 'N = 1 to #',
            'Triangles = N * (N + 1) // 2', 'Divs = Triangles divisors count rank 0',
            `Triangles (Divs greater ${minimum}) first`];
        const signal = new Int32Array(new SharedArrayBuffer(12));
        try {
            for (let id = 0; id < file.length; id++) {
                const result = await withInterrupt(signal,
                    () => session.execute(file[id], id, file, 40, true), () => {});
                expect(result.ok).toBe(true);
                if (id === 2) expect(result.output[0].text).toMatch(/^1 3 6 10 15 /);
                if (id === 4) expect(result.output[0].text).toBe(minimum === 5 ? '28' : '76576500');
            }
            session.rewind(4);
            const again = await session.execute(file[4], 4, file, 40, true);
            expect(again.ok).toBe(true);
            expect(again.output[0].text).toBe(minimum === 5 ? '28' : '76576500');
        } finally { session.dispose(); }
    });

    it.each(['1 to #', '1 till #', '1 to # by 2'])('keeps independent reads of %s', async range => {
        const session = createReplSession();
        const file = ['use numbers\nuse sequences', `N = ${range}`,
            'Triangles = N * (N + 1) // 2', 'Triangles take 5 array'];
        try {
            for (let id = 0; id < file.length; id++) {
                const result = await session.execute(file[id], id, file, 40, true);
                expect(result.ok).toBe(true);
                if (id === 3) expect(result.output[0].text).toBe(
                    range.endsWith('by 2') ? '1 6 15 28 45' : '1 3 6 10 15');
            }
            const again = await session.execute(file[3], 4, file, 40, true);
            expect(again.ok).toBe(true);
            expect(again.output[0].text).toBe(range.endsWith('by 2') ? '1 6 15 28 45' : '1 3 6 10 15');
        } finally { session.dispose(); }
    });
});
