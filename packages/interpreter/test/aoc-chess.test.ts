import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, pureHostFunction } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/aoc/2016/005_chess.ra', import.meta.url), 'utf8');

describe('AoC 2016 day 5', () => {
    it.each([false, true])('fills both passwords with pure host contract=%s', pure => {
        // Deterministic digest fixtures exercise the real loops without millions
        // of MD5 calls in CI. The benchmark --full checks the official abc input.
        const prefixes = [
            [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 16, 0],
            [0, 0, 15, 0], [0, 0, 8, 0],
            [0, 0, 1, 0x8f], [0, 0, 1, 0xf0],
            [0, 0, 0, 0x7f], [0, 0, 2, 0x9f], [0, 0, 3, 0xaf],
            [0, 0, 4, 0xbf], [0, 0, 5, 0xcf], [0, 0, 6, 0xdf], [0, 0, 7, 0xef],
        ];
        const calls: number[] = [];
        let compiledLoops = 0;
        const digest = (value: string | Uint8Array) => {
            expect(typeof value).toBe('string');
            expect(value).toMatch(/^door[0-9]+$/);
            const index = Number((value as string).slice(4));
            if (!pure) calls.push(index);
            if (index >= prefixes.length) throw new Error('search failed to terminate');
            const digest = new Uint8Array(16);
            digest.set(prefixes[index]);
            return digest;
        };
        const runtime = new Interpreter(undefined, {
            loadModule: () => ({ id: '/005_chess.ra', source }),
            md5: pure ? pureHostFunction(digest) : digest,
            onIntegerLoopExecuted: () => compiledLoops++,
        });
        try {
            runtime.execute('use "005_chess"');
            expect(runtime.execute('"door" part1')).toBe('f8110234');
            if (!pure) expect(calls).toEqual(Array.from({ length: 11 }, (_, index) => index));
            calls.length = 0;
            expect(runtime.execute('"door" part2')).toBe('789abcde');
            if (!pure) expect(calls).toEqual(Array.from({ length: 14 }, (_, index) => index));
            expect(compiledLoops).toBe(pure ? 2 : 0);
        } finally {
            runtime.dispose();
        }
    });
});
