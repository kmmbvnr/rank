import { expect, it } from 'vitest';
import { withInterrupt } from '@arrrank/interpreter';
import { createReplSession } from '../src/repl-session.js';

it('runs mask fill and bounded collection through the web/REPL session', async () => {
    const session = createReplSession();
    const signal = new Int32Array(new SharedArrayBuffer(12));
    const file = ['use numbers\nuse sequences', 'A = 0 till 10', 'M = A even',
        'A M fill -1', 'A M shape 3 fill -1', 'M indices shape 7 fill -1',
        'A unique shape 3 fill -1', 'A findall 3 shape 2 fill -1',
        'Grid = (1 to 6) reshape 2 3', 'Even = Grid even',
        'Grid Even shape 2 2 fill -1', '(Grid Even shape 2 2 fill -1) shape'];
    const expected = new Map([[3, '0 -1 2 -1 4 -1 6 -1 8 -1'], [4, '0 2 4'],
        [5, '0 2 4 6 8 -1 -1'], [6, '0 1 2'], [7, '3 -1'], [10, '2 4 6 -1'], [11, '2 2']]);
    try {
        for (let id = 0; id < file.length; id++) {
            const result = await withInterrupt(signal, () => session.execute(file[id], id, file, 80), () => {});
            expect(result.ok, JSON.stringify(result.output)).toBe(true);
            if (expected.has(id)) expect(result.output[0]?.text).toBe(expected.get(id));
        }
    } finally { session.dispose(); }
});
