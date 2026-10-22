import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { isStoredValue } from '../src/stored-value.js';

for (const compilation of [false, true]) describe(`recursive queens demo (compiled=${compilation})`, () => {
    it('runs the queens demo with small boards and empty solution sets', () => {
        const demo = readFileSync(new URL('../../../demos/classic/queens_recursive.ra', import.meta.url), 'utf8');
        expect(demo).toContain('Size = 8');
        for (const [size, count] of [[0, 1], [1, 1], [2, 0], [3, 0], [4, 2], [8, 92]]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(demo.replace('Size = 8', `Size = ${size}`));
                expect(runtime.variables.get('Placements')).toMatchObject({ shape: [count, size] });
                expect(isStoredValue(runtime.variables.get('Boards')!)).toBe(false);
                runtime.execute('Saved = Boards');
                expect(runtime.variables.get('Saved')).toMatchObject({ shape: [count, size, size] });
                expect(isStoredValue(runtime.variables.get('Saved')!)).toBe(true);
                if (size === 1) expect(formatValue(runtime.execute('Boards')!)).toBe('Q');
                if (size === 4) {
                    expect(formatValue(runtime.execute('Placements')!)).toBe('1 3 0 2 2 0 3 1');
                    expect(formatValue(runtime.execute('Boards')!)).toBe(
                        '. Q . . . . . Q Q . . . . . Q . . . Q . Q . . . . . . Q . Q . .');
                }
            } finally { runtime.dispose(); }
        }
    });
});
