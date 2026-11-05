import { readFileSync } from 'node:fs';
import { Interpreter } from '../../packages/interpreter/out/index.js';
const files = ['demos/euler/410_circleandtangent.ra',
    'benchmarks/experiments/euler410-original.ra', 'benchmarks/experiments/euler410-weights.ra'];
const sources = files.map(file => readFileSync(file, 'utf8'));
function oracle(r, x) {
    let sum = 0n;
    for (let m = 1; m <= Math.min(Number(r), Number(x)); m++) {
        let n = m, weight = 1n;
        for (let p = 2; p * p <= n; p++) if (n % p === 0) {
            weight *= 2n;
            while (n % p === 0) n /= p;
        }
        if (n > 1) weight *= 2n;
        const a = BigInt(r) / BigInt(m), b = BigInt(x) / BigInt(m);
        sum += weight * (m % 2 ? 2n * a * b : a * b + a % 2n * (b % 2n));
    }
    return 2n * sum;
}
const inputs = [[0, 5], [1, 5], [2, 10], [10, 100], [12, 20], [20, 12],
    [16, 31], [64, 65], [100, 100], [197, 251], [251, 197]];
let count = 0;
for (const [r, x, blocks] of [...inputs.map(([r, x]) => [r, x, [1, 17, 1000]]),
    [12, 9007199254740993n, [4]], [12, 18446744073709551617n, [4]]]) {
    for (const block of blocks) for (const compilation of [false, true]) for (const source of sources) {
        const runtime = new Interpreter(() => {}, { compilation, args: [`--r=${r}`, `--x=${x}`, `--block=${block}`] });
        try {
            runtime.execute(source);
            const value = runtime.variables.get('Answer');
            if (value !== oracle(r, x)) throw Error(`${r}/${x}/${block}/${compilation}: ${value}`);
            count++;
        } finally { runtime.dispose(); }
    }
}
console.log(JSON.stringify({ cases: count, oracle: 'Independent trial division and BigInt division/summation', files }));
