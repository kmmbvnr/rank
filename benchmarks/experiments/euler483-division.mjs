import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK483_RUNTIME;
const url = chosen ? chosen.startsWith('file:') ? new URL(chosen) : pathToFileURL(chosen)
    : new URL('../../packages/interpreter/out/index.js', import.meta.url);
const { floorDivide } = await import(new URL('runtime/numeric-division.js', url));
const mode = process.argv[2] ?? 'same', repeats = Number(process.argv[3] ?? 200000);
if (!['same', 'opposite'].includes(mode)) throw Error('Expected same or opposite signs');
const cases = Array.from({ length: 16 }, (_, i) => {
    const magnitude = (1n << 2500n) + BigInt(i * 97 + 7);
    const left = mode === 'same' ? magnitude : -magnitude, right = (1n << BigInt(128 + i * 5)) + 3n;
    const truncated = left / right;
    const expected = mode === 'same' || left % right === 0n ? truncated : truncated - 1n;
    return { left, right, expected };
});
function run(count) {
    let checksum = 0n;
    for (let i = 0; i < count; i++) {
        const { left, right, expected } = cases[i % cases.length];
        const result = floorDivide(left, right);
        if (result !== expected) throw Error('Wrong quotient');
        checksum += result & 255n;
    }
    return checksum.toString();
}
run(10000); run(10000);
const start = performance.now(), cpuStart = process.cpuUsage();
const checksum = run(repeats);
console.log(JSON.stringify({ runtime: url.href, node: process.version, arch: process.arch, mode, repeats,
    ms: performance.now() - start, cpu: process.cpuUsage(cpuStart), rssMiB: process.resourceUsage().maxRSS / 1024, checksum }));
