import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL(
    '../../../demos/euler/696_mahjong.ra',
    import.meta.url), 'utf8');

it.each([
    [4, 1, 1, 20n],
    [9, 1, 4, 13259n],
    [9, 3, 4, 5237550n],
    [1000, 1000, 5, 107662178n],
    [100000000, 100000000, 30, 436944244n],
])('keeps Euler 696 for n=%s, s=%s, t=%s',
    (n, s, t, answer) => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(source
                .replace(
                    'arg Nn integer = 100000000',
                    `arg Nn integer = ${n}`)
                .replace(
                    'arg Ss integer = 100000000',
                    `arg Ss integer = ${s}`)
                .replace('arg Tt integer = 30',
                    `arg Tt integer = ${t}`));
            expect(runtime.variables.get('Answer'))
                .toBe(answer);
        } finally {
            runtime.dispose();
        }
    }, 30_000);
