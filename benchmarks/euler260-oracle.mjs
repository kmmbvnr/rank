// Enumerate actual legal moves; no pair/diagonal flags or bitsets.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function oracle(top) {
    const losing = new Set();
    let sum = 0;
    for (let z = 0; z <= top; z++) for (let y = 0; y <= z; y++) for (let x = 0; x <= y; x++) {
        let won = false;
        const piles = [x, y, z];
        for (let mask = 1; mask < 8 && !won; mask++) {
            const maximum = Math.min(...piles.filter((_, j) => mask & (1 << j)));
            for (let amount = 1; amount <= maximum && !won; amount++) {
                const next = piles.map((value, j) => value - ((mask & (1 << j)) ? amount : 0))
                    .sort((a, b) => a - b);
                if (losing.has(next.join(','))) won = true;
            }
        }
        if (!won) {
            losing.add(piles.join(','));
            sum += x + y + z;
        }
    }
    return { sum, lost: losing.size };
}

let checks = 0;
for (const top of [0, 1, 2, 3, 5, 10, 15]) {
    const expected = oracle(top);
    for (const variant of ['original', 'skipshort', 'bitset']) for (const mode of ['compiled', 'reference']) {
        const child = spawnSync(process.execPath,
            [fileURLToPath(new URL('./euler260-stonegame.mjs', import.meta.url)), String(top), variant, mode],
            { encoding: 'utf8', timeout: 60_000 });
        assert.equal(child.status, 0, child.stderr);
        assert.equal(+JSON.parse(child.stdout).answer, expected.sum);
        checks++;
    }
    console.log(JSON.stringify({ top, ...expected }));
}
console.log(JSON.stringify({ checks }));
