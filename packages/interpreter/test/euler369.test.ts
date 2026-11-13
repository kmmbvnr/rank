import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {Interpreter} from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/369_badugi.ra', import.meta.url), 'utf8')
    .replace('Answer = Ranks badugi Max\n', '').replace(/\nreturn Answer\n*$/, '\n');

// Independent actual-card oracle: mark four distinct ranks in four suits,
// then propagate acceptance to all hands containing such a selection.
function smallDeckCounts() {
    const ranks = 4, size = 1 << 16;
    const good = new Uint8Array(size), counts = Array<bigint>(17).fill(0n);
    for (let a = 0; a < ranks; a++) {
        for (let b = 0; b < ranks; b++) {
            for (let c = 0; c < ranks; c++) {
                for (let d = 0; d < ranks; d++) {
                    if (new Set([a, b, c, d]).size === 4) {
                        good[1 << a | 1 << (4 + b) | 1 << (8 + c) | 1 << (12 + d)] = 1;
                    }
                }
            }
        }
    }
    for (let bit = 1; bit < size; bit *= 2) {
        for (let mask = 0; mask < size; mask++) {
            if (mask & bit) good[mask] |= good[mask ^ bit];
        }
    }
    for (let mask = 0; mask < size; mask++) {
        if (good[mask]) counts[mask.toString(2).replace(/0/g, '').length]++;
    }
    return counts;
}
const expected = smallDeckCounts();

it.each([false, true])('matches all small-deck hand sizes (compilation=%s)', compilation => {
    const output: bigint[] = [];
    const runtime = new Interpreter(text => output.push(BigInt(text)), {compilation});
    try {
        runtime.execute(source + `
Results = 4 table 16
for N in 0 to 16
  Results N print
end
`);
        expect(output).toEqual(expected);
    } finally { runtime.dispose(); }
});
