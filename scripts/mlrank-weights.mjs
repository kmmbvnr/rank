// Rebuild the analytical XOR example's source weights (not native artifacts).
import { writeFileSync } from 'node:fs';
import { encodeRamWeights } from '../packages/interpreter/out/index.js';
for (const [name, shape, values] of [
    ['w1', [2,3], [1,1,-1,1,1,1]], ['b1', [3], [0,-1,0]],
    ['w2', [3,2], [-4,4,8,-8,1,1]], ['b2', [2], [2,-2]],
]) writeFileSync(new URL(`../demos/mlrank/${name}.rwt`, import.meta.url), encodeRamWeights(shape, values));
