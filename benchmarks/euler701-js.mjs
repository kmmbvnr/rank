import assert from 'node:assert/strict';

// Same frontier states and empty/filled transitions as the Rank demo.
// Keep packed sizes (42 bits) plus best (6 bits) in exact Number integers,
// and labels in a separate Uint32 word. Counts fit exactly through 7x7.
const width = Number(process.argv[2] ?? 7);
assert(Number.isInteger(width) && width >= 1 && width <= 7);
const powers = Float64Array.from({ length: width }, (_, i) => 64 ** i);
const tags = new Uint8Array(width), sizes = new Uint8Array(width);
let labels = Uint32Array.of(0), packed = Float64Array.of(0), ways = Float64Array.of(1);
let peakStates = 1, peakBuffers = 20;
const stages = [];
const collect = process.argv.includes('--gc');
if (collect) assert.equal(typeof global.gc, 'function', '--gc needs node --expose-gc');
const started = performance.now();

function sortedPositions(labels, packed) {
    const size = labels.length;
    let order = Uint32Array.from({ length: size }, (_, i) => i);
    let other = new Uint32Array(size);
    const counts = new Uint32Array(65536);
    // Stable radix order: labels are the minor key, packed is the major key.
    for (let pass = 0; pass < 5; pass++) {
        const divisor = pass < 2 ? 65536 ** pass : 65536 ** (pass - 2);
        const key = pass < 2 ? labels : packed;
        counts.fill(0);
        for (let i = 0; i < size; i++) counts[Math.floor(key[i] / divisor) & 65535]++;
        let offset = 0;
        for (let i = 0; i < counts.length; i++) {
            const count = counts[i]; counts[i] = offset; offset += count;
        }
        for (let i = 0; i < size; i++) {
            const at = order[i], bucket = Math.floor(key[at] / divisor) & 65535;
            other[counts[bucket]++] = at;
        }
        [order, other] = [other, order];
    }
    return order;
}

for (let cell = 0; cell < width * width; cell++) {
    const row = cell % width, count = ways.length, length = count * 2;
    const nextLabels = new Uint32Array(length), nextPacked = new Float64Array(length), nextWays = new Float64Array(length);
    for (let state = 0; state < count; state++) {
        const code = labels[state], best = packed[state] % 64;
        let area = Math.floor(packed[state] / 64);
        for (let i = 0; i < width; i++) {
            tags[i] = (code >>> (3 * i)) & 7;
            sizes[i] = area % 64;
            area = Math.floor(area / 64);
        }
        const old = tags[row], up = row ? tags[row - 1] : 0;
        const total = 1 + sizes[row] + (up !== old && row ? sizes[row - 1] : 0);
        let first = 8;
        if (old === row + 1) for (let i = 0; i < width; i++) {
            if (i !== row && tags[i] === old) { first = i + 1; break; }
        }
        const label = Math.min(old || 8, up || 8, row + 1);
        let emptyTags = 0, fullTags = 0, emptySizes = 0, fullSizes = 0;
        for (let i = 0; i < width; i++) {
            const gone = i === row ? 0 : tags[i];
            const empty = old === row + 1 && gone === old ? first : gone;
            const join = i === row || tags[i] > 0 && (tags[i] === old || tags[i] === up);
            emptyTags |= empty << (3 * i);
            fullTags |= (join ? label : tags[i]) << (3 * i);
            emptySizes += (i === row ? 0 : sizes[i]) * powers[i];
            fullSizes += (join ? total : sizes[i]) * powers[i];
        }
        nextLabels[state] = emptyTags;
        nextPacked[state] = emptySizes * 64 + best;
        nextWays[state] = ways[state];
        nextLabels[count + state] = fullTags;
        nextPacked[count + state] = fullSizes * 64 + Math.max(best, total);
        nextWays[count + state] = ways[state];
    }
    const order = sortedPositions(nextLabels, nextPacked);
    let unique = 0, previousLabels = -1, previousPacked = -1;
    for (const at of order) if (nextLabels[at] !== previousLabels || nextPacked[at] !== previousPacked) {
        unique++; previousLabels = nextLabels[at]; previousPacked = nextPacked[at];
    }
    const mergedLabels = new Uint32Array(unique), mergedPacked = new Float64Array(unique), mergedWays = new Float64Array(unique);
    previousLabels = previousPacked = -1;
    let group = -1;
    for (const at of order) {
        if (nextLabels[at] !== previousLabels || nextPacked[at] !== previousPacked) {
            group++; previousLabels = nextLabels[at]; previousPacked = nextPacked[at];
            mergedLabels[group] = previousLabels; mergedPacked[group] = previousPacked;
        }
        mergedWays[group] += nextWays[at];
    }
    // Includes both radix position buffers even though one is dead by merge.
    const liveBytes = count * 20 + length * 28 + unique * 20 + 65536 * 4;
    peakBuffers = Math.max(peakBuffers, liveBytes);
    labels = mergedLabels; packed = mergedPacked; ways = mergedWays;
    peakStates = Math.max(peakStates, unique);
    if (collect) global.gc();
    const memory = process.memoryUsage();
    stages.push({ cell, states: unique, liveBytes, rss: memory.rss, heapUsed: memory.heapUsed, arrayBuffers: memory.arrayBuffers });
}
let total = 0n, mass = 0n;
for (let i = 0; i < ways.length; i++) {
    assert(Number.isSafeInteger(ways[i]));
    total += BigInt(ways[i]) * BigInt(packed[i] % 64);
    mass += BigInt(ways[i]);
}
assert.equal(mass, 1n << BigInt(width * width));
const totals = { 2: 30n, 3: 1866n, 4: 377807n, 5: 273366893n, 6: 738221900249n, 7: 7606015899310446n };
if (width in totals) assert.equal(total, totals[width]);
console.log(JSON.stringify({ width, node: process.version, arch: process.arch, ms: performance.now() - started,
    answer: Number(total) / 2 ** (width * width), total: String(total), peakStates,
    peakLiveBufferMiB: peakBuffers / 1048576, finalStateMiB: ways.length * 20 / 1048576,
    forcedGc: collect, rssMiB: process.resourceUsage().maxRSS / 1024, stages }));
