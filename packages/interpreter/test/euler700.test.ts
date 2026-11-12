import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/700_eulercoin.ra', import.meta.url), 'utf8');

it('checks both coin-search phases against every residue of small coprime inputs', () => {
    for (const [multiplier, modulus] of [[1, 11], [2, 5], [3, 7], [5, 13], [7, 19], [10, 11]]) {
        let minimum = modulus, expected = 0n;
        for (let index = 1; index < modulus; index++) {
            const value = index * multiplier % modulus;
            if (value < minimum) { minimum = value; expected += BigInt(value); }
        }
        for (const compilation of [false, true]) for (const cut of [1, 2, modulus - 1]) {
            const runtime = new Interpreter(() => {}, {
                compilation, args: [`--aa=${multiplier}`, `--mm=${modulus}`, `--cut=${cut}`],
            });
            try {
                runtime.execute(source);
                expect(runtime.variables.get('Answer'), `${multiplier}/${modulus}, cut ${cut}, ${compilation}`).toBe(expected);
            } finally { runtime.dispose(); }
        }
    }
});
