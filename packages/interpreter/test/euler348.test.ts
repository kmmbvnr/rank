import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

it('preserves the full Euler 348 answer with compiled root helpers', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(readFileSync(new URL('../../../demos/euler/348_squarecube.ra', import.meta.url), 'utf8'));
        expect(answerOf(runtime)).toBe(1004195061n);
    } finally { runtime.dispose(); }
}, 15_000);
