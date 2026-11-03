import assert from 'node:assert/strict';
const { Interpreter } = await import(process.env.RANK_BITS_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url).href);
const mode = process.argv[2] ?? 'compiled';
const rt = new Interpreter(() => {}, { compilation: mode !== 'reference' });
const size = 28123;
const bits = (1n << 40000n) - 1n - (1n << 2n) - (1n << 128n);
const median = samples => samples.sort((a, b) => a - b)[samples.length >> 1];
try {
    rt.execute(`use bits
use sequences
N = 1 to ${size}
Bits = ${bits}
Positions = N mod 4096
Values = N mod 65536
A = Values reshape 28123 1
B = (0 to 15) array reshape 1 16`);
    const cases = [
        ['range-mask-sum', 'N (not (Bits bit N)) sum', 130n],
        ['range-count', '(Bits bit N) count', BigInt(size - 2)],
        ['irregular-count', '(Bits bit Positions) count', BigInt(size - 2 * 7)],
        ['values-scalar-bit', '(Values bit 3) count', null],
        ['pairwise-bit', '(Values bit Positions) count', null],
        ['broadcast-bit', '(A bit B) count', null],
        ['combined-masks', '((Bits bit N) and not (Bits bit Positions)) count', null],
    ];
    for (const [name, expression, known] of cases) {
        const oracle = (() => {
            if (known !== null) return known;
            let count = 0n;
            for (let n = 1; n <= size; n++) {
                if (name === 'values-scalar-bit') count += BigInt(!!(n & 8));
                else if (name === 'pairwise-bit') count += BigInt((BigInt(n) & (1n << BigInt(n % 4096))) !== 0n);
                else if (name === 'broadcast-bit') {
                    for (let b = 0; b < 16; b++) count += BigInt(!!(n & (1 << b)));
                } else count += BigInt((bits & (1n << BigInt(n))) !== 0n && (bits & (1n << BigInt(n % 4096))) === 0n);
            }
            return count;
        })();
        const samples = [];
        for (let i = 0; i < 12; i++) {
            const start = performance.now();
            const answer = rt.execute(`Answer = ${expression}`);
            samples.push(performance.now() - start);
            assert.equal(answer, oracle, name);
        }
        console.log(JSON.stringify({ arch: process.arch, node: process.version, mode, name,
            medianMs: median(samples.slice(3)), answer: String(oracle) }));
    }
} finally { rt.dispose(); }
