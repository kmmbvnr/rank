import { readFileSync } from 'node:fs';
import { Interpreter, formatValue } from '../../packages/interpreter/out/index.js';
const files = ['demos/euler/408_admissiblepaths.ra', 'benchmarks/experiments/euler408-filter.ra', 'benchmarks/experiments/euler408-candidate.ra'];
const modulus = 1000000007n;
function oracle(n) {
    const square = value => Number.isInteger(Math.sqrt(value));
    const forbidden = (x, y) => x > 0 && y > 0 && square(x) && square(y) && square(x + y);
    const paths = Array(n + 1).fill(0n), points = [];
    paths[0] = 1n;
    for (let x = 0; x <= n; x++) for (let y = 0; y <= n; y++) {
        if (forbidden(x, y)) { paths[y] = 0n; points.push([x, y]); }
        else if (y > 0) paths[y] = (paths[y] + paths[y - 1]) % modulus;
    }
    return { answer: String(paths[n]), x: points.map(p => p[0]).join(' '), y: points.map(p => p[1]).join(' ') };
}
const limits = [0, 1, 5, 8, 9, 15, 16, 17, 25, 36, 64, 100, 1000];
let comparisons = 0;
for (const n of limits) {
    const expected = oracle(n);
    for (const file of files) for (const compilation of [false, true]) {
        const source = readFileSync(file, 'utf8').replace(/arg N integer = \d+/, `arg N integer = ${n}`);
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source);
            const observed = { answer: String(runtime.variables.get('Answer')), x: formatValue(runtime.variables.get('X')), y: formatValue(runtime.variables.get('Y')) };
            if (JSON.stringify(observed) !== JSON.stringify(expected)) throw new Error(JSON.stringify({ file, n, compilation, observed, expected }));
            comparisons++;
        } finally { runtime.dispose(); }
    }
}
console.log(JSON.stringify({ comparisons, limits, files }));
