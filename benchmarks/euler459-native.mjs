import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Fixed-input timing controls, without Rank's dynamic checks or snapshots.
const [text = '1000000', mode = 'scalar'] = process.argv.slice(2);
const n = Number(text);
if (!Number.isInteger(n) || n < 0 || n > 1000000 || !['scalar', 'vector'].includes(mode)) throw Error('Invalid control input');
const cpuStart = process.cpuUsage(), started = performance.now();
const root = Math.floor(Math.sqrt(2 * n)) + 1;
function axis(triangular) {
    const lengths = Int32Array.from({ length: root }, (_, index) => {
        const k = index + 1; return triangular ? k * (k + 1) / 2 : k * k;
    });
    const prefix = new Int32Array(n + 1), seen = new Int32Array(2 * root + 2);
    const counts = new Int32Array(seen.length), old = new Int32Array(root);
    let active = 0;
    for (let i = 1; i <= n; i++) {
        while (active < lengths.length && lengths[active] <= i) active++;
        const previous = prefix[i - 1];
        if (mode === 'vector') {
            for (let j = 0; j < active; j++) old[j] = prefix[i - lengths[j]];
            for (let j = 0; j < active; j++) seen[previous ^ old[j]] = i;
        } else {
            for (let j = 0; j < active; j++) seen[previous ^ prefix[i - lengths[j]]] = i;
        }
        let mex = 0; while (seen[mex] === i) mex++;
        const current = previous ^ mex; prefix[i] = current;
        if (mode === 'vector') {
            for (let j = 0; j < active; j++) counts[current ^ old[j]]++;
        } else {
            for (let j = 0; j < active; j++) counts[current ^ prefix[i - lengths[j]]]++;
        }
    }
    return { word: prefix[n], counts };
}
const row = axis(true), col = axis(false);
let size = Math.max(2, row.word + 1, col.word + 1);
for (const counts of [row.counts, col.counts]) for (let i = 0; i < counts.length; i++) if (counts[i]) size = Math.max(size, i + 1);
let table = Int32Array.of(0, 0, 0, 1), base = 2;
while (base < size) {
    const width = Math.min(base * base, size), next = new Int32Array(width * width);
    for (let a = 0; a < width; a++) for (let b = 0; b < width; b++) {
        const ah = Math.floor(a / base), al = a % base, bh = Math.floor(b / base), bl = b % base;
        const top = table[ah * base + bh], left = table[ah * base + bl], side = table[al * base + bh], low = table[al * base + bl];
        next[a * width + b] = (top ^ left ^ side) * base + (low ^ table[top * base + base / 2]);
    }
    table = next; base = width;
}
const goal = table[row.word * size + col.word];
let answer = 0n;
for (let a = 0; a < size; a++) if (row.counts[a]) for (let b = 0; b < size; b++)
    if (col.counts[b] && table[a * size + b] === goal) answer += BigInt(row.counts[a]) * BigInt(col.counts[b]);
const ms = performance.now() - started, cpu = process.cpuUsage(cpuStart);
const expected = { 1: 1n, 2: 0n, 5: 8n, 100: 31395n, 3000: 55837744n, 10000: 2477885152n, 1000000: 3996390106631n };
if (expected[n] !== undefined && answer !== expected[n]) throw Error('Wrong control answer');
console.log(JSON.stringify({ mode, n, answer: String(answer), ms, cpu, rssMiB: process.resourceUsage().maxRSS / 1024,
    node: process.version, arch: process.arch, nimSize: size,
    sourceSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex') }));
