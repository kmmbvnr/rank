import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL(
    '../../../demos/euler/671_colouringloop.ra',
    import.meta.url), 'utf8');

it.each([
    [4, 3, 104n],
    [5, 7, 3327300n],
    [6, 101, 75309980n],
    [10, 10004003002001, 946106780n],
])('keeps Euler 671 for K=%s, N=%s',
    (k, n, answer) => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(source
                .replace('arg Kc integer = 10',
                    `arg Kc integer = ${k}`)
                .replace(
                    'arg Nn integer = 10004003002001',
                    `arg Nn integer = ${n}`));
            expect(answerOf(runtime))
                .toBe(answer);
        } finally {
            runtime.dispose();
        }
    }, 60_000);
