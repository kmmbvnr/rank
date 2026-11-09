import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export function tables(m) {
    const bound = BigInt(Math.max(m, 1)), bits = bound.toString(2).length;
    const height = 4 * bits + 2, depth = 2 * height + 20;
    const positive = [[1n, 0n, 0n], [0n, 1n, 0n], [0n, 0n, 1n]];
    for (let i = 3; i <= height; i++) positive.push(positive[i - 1].map((value, j) => value + positive[i - 3][j]));
    const negative = [];
    let [a, b, c] = positive;
    for (let i = 0; i < depth; i++) {
        const next = c.map((value, j) => value - b[j]);
        negative.push(next); [a, b, c] = [next, a, b];
    }
    const rows = [...negative.reverse(), ...positive];
    const magnitude = rows.flat().reduce((sum, value) => sum + (value < 0n ? -value : value), 0n);
    const budget = bound * bound + 2n * magnitude, precision = budget.toString(2).length;
    const scale = 1n << BigInt(3 * precision + 4);
    let low = scale, high = 2n * scale;
    while (high - low > 1n) {
        const middle = (low + high) / 2n;
        if (middle ** 3n > middle * middle * scale + scale ** 3n) high = middle;
        else low = middle;
    }
    const second = low * low / scale;
    return { scale, powers: rows.map(([a, b, c]) => a * scale + b * low + c * second) };
}
export function solve(m) {
    if (!Number.isSafeInteger(m) || m < 0) throw Error('expected a nonnegative safe bound');
    const { scale, powers } = tables(m), keys = powers.map(Number);
    const distinct = keys.every((value, i) => !i || keys[i - 1] < value);
    let answer = 0n;
    for (let j = 1; j <= m; j++) {
        let rest = BigInt(j) ** 2n * scale, count = 0;
        while (rest > 0n) {
            let low = 0, high = powers.length;
            const wanted = Number(rest);
            while (low < high) {
                const middle = (low + high) >>> 1;
                if (distinct ? keys[middle] <= wanted : powers[middle] <= rest) low = middle + 1;
                else high = middle;
            }
            let index = low - 1;
            if (distinct && index >= 0 && powers[index] > rest) index--;
            if (index < 0) throw Error('exponent window exhausted');
            rest -= powers[index]; count++;
        }
        answer += BigInt(count);
    }
    return { answer, powerSha256: createHash('sha256').update(powers.join(',')).digest('hex') };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const m = Number(process.argv[2] ?? 5000000), start = performance.now(), cpu = process.cpuUsage();
    const { answer, powerSha256 } = solve(m), ms = performance.now() - start, used = process.cpuUsage(cpu);
    if (process.env.RANK558_EXPECTED && answer !== BigInt(process.env.RANK558_EXPECTED)) throw Error(`wrong answer: ${answer}`);
    console.log(JSON.stringify({ m, answer: String(answer), powerSha256, ms, cpu: used,
        rssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch }));
}
