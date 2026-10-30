import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../packages/interpreter/out/index.js';

// Independent oracle: build the actual image, then classify each square by
// its pixel count. No near/far corner, symmetry or split-count identities.
function oracle(n) {
    const size = 2 ** n, center = size / 2, pitch = size + 1;
    const prefix = new Int32Array(pitch * pitch);
    for (let y = 0; y < size; y++) {
        let row = 0;
        for (let x = 0; x < size; x++) {
            row += Number((x - center) ** 2 + (y - center) ** 2 <= center ** 2);
            prefix[(y + 1) * pitch + x + 1] = prefix[y * pitch + x + 1] + row;
        }
    }
    function cost(x, y, side) {
        const x1 = x + side, y1 = y + side;
        const black = prefix[y1 * pitch + x1] - prefix[y * pitch + x1]
            - prefix[y1 * pitch + x] + prefix[y * pitch + x];
        if (black === 0 || black === side * side) return 2;
        const half = side / 2;
        return 1 + cost(x, y, half) + cost(x + half, y, half)
            + cost(x, y + half, half) + cost(x + half, y + half, half);
    }
    return BigInt(cost(0, 0, size));
}

let comparisons = 0;
const answers = {};
for (let n = 1; n <= 10; n++) {
    const expected = oracle(n);
    answers[n] = String(expected);
    for (const variant of ['original', 'terminal', 'symmetric', 'corners', 'shipping']) {
        const source = readFileSync(new URL(variant === 'shipping' ? '../demos/euler/287_quadtree.ra' : `./experiments/euler287-${variant}.ra`, import.meta.url), 'utf8')
            .replace('arg N integer = 24', `arg N integer = ${n}`);
        for (const compilation of [true, false]) {
            const runtime = new Interpreter(() => {}, {compilation});
            try {
                runtime.execute(source);
                assert.equal(runtime.variables.get('Answer'), expected, `${variant}/${n}/${compilation}`);
                comparisons++;
            } finally {
                runtime.dispose();
            }
        }
    }
}
console.log(JSON.stringify({comparisons, answers}));
