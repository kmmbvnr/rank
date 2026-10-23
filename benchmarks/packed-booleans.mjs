// Build first. Full corner runs are explicit: --case=corner --size=3000.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(case|size|samples|checkout|worker|variant|timeout|fixture|baseline|baseline-variant)=(.+)$/.exec(arg);
    assert(match, `Unknown option ${arg}`);
    return [match[1], match[2]];
}));
const checkout = resolve(options.checkout ?? root);
const size = Number(options.size ?? 100);
const variant = options.variant ?? 'packed';
const name = options.case ?? 'money';
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (!options.worker) {
    const samples = Number(options.samples ?? 3);
    assert(Number.isSafeInteger(samples) && samples >= 1);
    const versions = { candidate: { checkout, variant, results: [] } };
    if (options.baseline) versions.baseline = { checkout: resolve(options.baseline), variant: options['baseline-variant'] ?? variant, results: [] };
    for (let i = 0; i < samples; i++) {
        const entries = Object.values(versions);
        if (i % 2) entries.reverse();
        for (const version of entries) {
            const start = performance.now();
            const child = spawnSync(process.execPath, ['--expose-gc', import.meta.filename,
                ...process.argv.slice(2), '--worker=true', `--checkout=${version.checkout}`, `--variant=${version.variant}`],
                { encoding: 'utf8', timeout: Number(options.timeout ?? 60000) });
            if (child.error?.code === 'ETIMEDOUT') {
                version.results.push({ timedOut: true, validated: false, timeoutMs: Number(options.timeout ?? 60000), processMs: performance.now() - start });
                continue;
            }
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            version.results.push({ ...JSON.parse(child.stdout), processMs: performance.now() - start });
        }
    }
    const reports = Object.fromEntries(Object.entries(versions).map(([key, version]) => {
        const { checkout, variant, results } = version;
        const fields = Object.keys(results[0]).filter(key => typeof results[0][key] === 'number');
        return [key, { name, size, variant, fixture: options.fixture ?? 'dense', checkout,
            revision: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
            dirty: Boolean(execFileSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).trim()),
            implementationHash: readdirSync(resolve(checkout, 'packages/interpreter/src'), { recursive: true }).filter(path => path.endsWith('.ts')).sort().reduce((hash, path) => hash.update(path).update(readFileSync(resolve(checkout, 'packages/interpreter/src', path))), createHash('sha256')).digest('hex'),
            node: process.version, cpu: cpus()[0].model,
            timing: 'fresh processes; execution excludes import, parsing, fixture construction and result validation; process includes all of these',
            sampling: options.baseline ? 'alternating candidate/baseline order' : 'one checkout',
            median: Object.fromEntries(fields.map(key => [key, median(results.map(result => result[key]))])), results }];
    }));
    console.log(JSON.stringify(options.baseline ? reports : reports.candidate, null, 2));
} else {
    const importStart = performance.now();
    const module = async path => import(pathToFileURL(resolve(checkout, `packages/interpreter/out/${path}.js`)));
    const { Interpreter, parse } = await module('index');
    const { filledArray, ownedArray, readArrayItem, privateArrayCopy, writeArrayCell } = await module('array-storage');
    const importMs = performance.now() - importStart;
    if (name === 'memory') {
        global.gc(); const before = process.memoryUsage();
        let start = performance.now(); const a = filledArray(false, [size]);
        const allocationMs = performance.now() - start;
        global.gc(); const allocated = process.memoryUsage();
        start = performance.now(); const b = privateArrayCopy(a); const cowMs = performance.now() - start;
        if (size) { writeArrayCell(b, size - 1, true); assert.equal(readArrayItem(a, size - 1), false); }
        global.gc(); const copied = process.memoryUsage();
        if (size) { assert.equal(readArrayItem(a, size - 1), false); assert.equal(readArrayItem(b, size - 1), true); }
        console.log(JSON.stringify({ importMs, allocationMs, cowMs,
            heapBytes: allocated.heapUsed - before.heapUsed, bufferBytes: allocated.arrayBuffers - before.arrayBuffers,
            cowHeapBytes: copied.heapUsed - allocated.heapUsed, cowBufferBytes: copied.arrayBuffers - allocated.arrayBuffers,
            peakRssBytes: process.resourceUsage().maxRSS * 1024 }));
    } else {
        const runtime = new Interpreter(() => {});
        let source, expected, validate;
        const fixtureStart = performance.now();
        if (name === 'intersection') {
            runtime.variables.set('A', filledArray(true, [size]));
            runtime.variables.set('B', filledArray(true, [size]));
            source = 'use sequences\n(A and B) count';
            validate = result => { assert.equal(result, BigInt(size)); return String(result); };
        } else if (name === 'money') {
            const coins = Array.from({ length: 100 }, (_, i) => options.fixture === 'maximum' ? 1000 : 1 + i * 7919 % 1000);
            const sums = new Uint8Array(coins.reduce((a, b) => a + b, 0) + 1); sums[0] = 1;
            for (const coin of coins) for (let i = sums.length - 1; i >= coin; i--) sums[i] |= sums[i - coin];
            expected = Array.from(sums.keys()).filter(i => i && sums[i]);
            runtime.variables.set('Coins', ownedArray(coins.map(BigInt)));
            if (variant === 'demo') {
                const demo = readFileSync(resolve(checkout, 'demos/cses/dynamic/014_moneysums.ra'), 'utf8');
                source = 'use algo\nuse sequences\n' + demo.slice(demo.indexOf('fun Coins money_sums')) + '\nCoins money_sums';
            } else if (variant === 'bigint') {
                source = `use bits\nReach = 1\nfor W in Coins\n Reach = Reach (Reach W shl) bor\nend\nReach 1 bxor`;
            } else {
                source = `use sequences\nReach = array shape 100001 fill false\nReach 0 = true
for W in Coins
 Reach = (Reach or (Reach W shift with false)) copy
end
Reach 0 = false
Reach indices`;
            }
            validate = result => {
                if (variant === 'bigint') {
                    const positions = []; let bits = result;
                    for (let i = 0; bits; i++, bits >>= 1n) if (bits & 1n) positions.push(i);
                    assert.deepEqual(positions, expected);
                } else assert.deepEqual(Array.from(result.items, Number), expected);
                return String(expected.length);
            };
        } else {
            assert.equal(name, 'corner');
            assert(Number.isSafeInteger(size) && size >= 1 && size <= 3000);
            // Deterministic repeated patterns with an independent column-pair oracle.
            // Every row has two out of three column classes, selected by row % 3.
            const grid = variant === 'bigint' ? undefined : filledArray(false, [size, size]);
            if (grid) for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) if (j % 3 !== i % 3) writeArrayCell(grid, i * size + j, true);
            const classSizes = Array.from({ length: 3 }, (_, i) => BigInt(Math.floor((size + 2 - i) / 3)));
            const choose = n => n * (n - 1n) / 2n;
            expected = 0n;
            // Count row pairs by column classes; independent of the Rank row-pair walk.
            for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) {
                const columns = a === b ? choose(classSizes[a]) : classSizes[a] * classSizes[b];
                let rows = 0n;
                for (let r = 0; r < 3; r++) if (r !== a && r !== b) rows += classSizes[r];
                expected += columns * choose(rows);
            }
            if (grid) runtime.variables.set('Grid', grid);
            if (variant === 'bigint') {
                const rows = [];
                for (let i = 0; i < size; i++) {
                    const digits = Array.from({ length: size }, (_, j) => j % 3 !== i % 3 ? '1' : '0').reverse().join('');
                    rows.push(BigInt('0b' + digits));
                }
                runtime.variables.set('Rows', ownedArray(rows));
                source = `use sequences\nuse bits\nN = Rows len\nTotal = 0
for I in 0 till N
 for J in (I + 1) till N
  K = ((Rows I) (Rows J) band) popcount
  Total += K * (K - 1) // 2
 end
end
Total`;
            } else if (variant === 'pair') {
                source = `use sequences
fun Grid corners
 N = Grid shape 0
 Total = 0
 for I in 0 till N
  Row' = Grid I
  for J in (I + 1) till N
   K = (Row and (Grid J)) count
   Total += K * (K - 1) // 2
  end
 end
 return Total
end
Grid corners`;
            } else {
                const demo = readFileSync(resolve(root, 'demos/cses/advanced/004_cornercount.ra'), 'utf8');
                source = 'use sequences\n' + demo.slice(demo.indexOf('fun Grid corner_count')) + '\nGrid corner_count';
            }
            validate = result => { assert.equal(result, expected); return String(result); };
        }
        const fixtureMs = performance.now() - fixtureStart;
        const parseStart = performance.now(); const program = parse(source); const parseMs = performance.now() - parseStart;
        const start = performance.now(); const result = runtime.executeProgram(program, []); const executionMs = performance.now() - start;
        const validationStart = performance.now(); const answer = validate(result); const validationMs = performance.now() - validationStart;
        console.log(JSON.stringify({ importMs, fixtureMs, parseMs, executionMs, validationMs, answer,
            peakRssBytes: process.resourceUsage().maxRSS * 1024 }));
        runtime.dispose();
    }
}
