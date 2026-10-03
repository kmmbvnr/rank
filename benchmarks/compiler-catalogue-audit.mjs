// Run in disposable, built checkouts: standalone SQL demos write CSV exports.
// Fixtures required: africa.csv, club.sqlite3, tpch.sqlite3 (see demo READMEs).
// node benchmarks/compiler-catalogue-audit.mjs CHECKOUT compiled|reference OUTPUT [FILTER] [tests|unpaired|chess]
// node benchmarks/compiler-catalogue-audit.mjs compare BEFORE.json AFTER.json [--behavior-only]
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

if (process.argv[2] === 'compare') {
    const [, beforePath, afterPath, option] = process.argv.slice(2);
    assert(beforePath && afterPath, 'Provide two audit JSON paths');
    assert(option === undefined || option === '--behavior-only');
    const before = JSON.parse(await readFile(beforePath, 'utf8'));
    const after = JSON.parse(await readFile(afterPath, 'utf8'));
    const canonical = source => {
        const { durationMs, fallbacks, loadedSources, generated, compiledLoops, compiledTensors, ...result } = source;
        if (option !== '--behavior-only') {
            result.compiledLoops = compiledLoops;
            result.compiledTensors = compiledTensors;
            result.generated = Object.fromEntries(Object.entries(generated)
                .map(([kind, items]) => [kind, items.map(item => item.guardsNormalized)]));
        }
        return result;
    };
    assert.deepEqual(before.results.map(result => result.file), after.results.map(result => result.file), 'File coverage differs');
    for (let i = 0; i < before.results.length; i++) {
        assert.deepEqual(canonical(before.results[i]), canonical(after.results[i]), before.results[i].file);
    }
    assert.deepEqual(before.exports, after.exports, 'CSV exports differ');
    console.log(`Matched ${before.results.length} files and ${before.results.reduce((sum, result) => sum + result.tests.length, 0)} tests`);
    process.exit(0);
}

const [checkout, mode, output, filter = '', selection = 'tests'] = process.argv.slice(2);
if (!checkout || !['compiled', 'reference'].includes(mode) || !output || !['tests', 'unpaired', 'chess'].includes(selection)) {
    throw new Error('Usage: node compiler-catalogue-audit.mjs CHECKOUT compiled|reference OUTPUT [FILTER] [tests|unpaired|chess]');
}
const root = resolve(checkout);
process.chdir(root);
const load = path => import(pathToFileURL(join(root, path)).href);
const { Interpreter, RankError, pureHostFunction } = await load('packages/interpreter/out/index.js');
const { RuntimeDiagnostics } = await load('packages/interpreter/out/diagnostics.js');
const { nodeIo } = await load('packages/cli/out/node-io.js');
const { nodeMd5 } = await load('packages/cli/out/node-crypto.js');
const { loadModule } = await load('packages/cli/out/load-module.js');
const normalize = value => typeof value === 'string' ? value.replaceAll(root, '<checkout>') : value;
async function files(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const found = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) found.push(...await files(path));
        else if (entry.name.endsWith('.ra')) found.push(path);
    }
    return found.sort();
}
const reference = Object.fromEntries([
    'scalarEntryCompilation', 'scalarFunctionCompilation', 'scalarCallCompilation',
    'scalarTextCompilation', 'textArrayLoopCompilation', 'textLoopCompilation',
    'absoluteLoopCompilation', 'loopReturnCompilation', 'arrayLocalCompilation',
    'booleanArrayCompilation', 'booleanLoopCompilation', 'scalarAddressCompilation',
    'extremaLoopCompilation', 'compoundArrayCompilation', 'arrayIterationCompilation',
    'arrayWriteCompilation', 'arrayLoopCompilation', 'nestedLoopCompilation',
    'tensorCellCompilation', 'nativeLoopCompilation', 'functionBodyCompilation',
    'integerLoopCompilation', 'blockCompilation', 'scalarCompilation', 'tensorFusion',
].map(name => [name, false]));
const results = [];
const allFiles = await files(join(root, 'demos'));
const paths = new Set(allFiles);
const selected = allFiles.filter(file => file.includes(filter) && (selection === 'unpaired'
    ? !file.endsWith('_test.ra') && !paths.has(file.slice(0, -3) + '_test.ra')
    : selection === 'chess' ? file.endsWith('/aoc/2016/005_chess.ra') : file.endsWith('_test.ra')));
for (const file of selected) {
    const diagnostics = new RuntimeDiagnostics(), tests = [], generated = {}, stdout = [];
    const loadedSources = new Set([relative(root, file)]);
    const capture = kind => source => {
        const hash = value => createHash('sha256').update(value).digest('hex');
        const normalized = source.replace(/return decline\((['"]).*?\1\);/g, 'return undefined;');
        (generated[kind] ??= []).push({ raw: hash(source), guardsNormalized: hash(normalized) });
    };
    const updateDatabase = selection === 'unpaired' && file.includes('/pgexercises/updates/')
        ? join(root, 'demos/pgexercises/data/compiler-audit-update.sqlite3') : undefined;
    if (updateDatabase) await copyFile(join(root, 'demos/pgexercises/data/club.sqlite3'), updateDatabase);
    // The full unchanged password program is exercised with a deterministic,
    // pure host digest fixture. Actual MD5 is covered by the existing hash tests;
    // this fixture covers rejected prefixes, duplicate positions and termination
    // without a multi-million-hash search in the reference interpreter.
    const chessDirectory = selection === 'chess' ? await mkdtemp(join(tmpdir(), 'rank-catalogue-chess-')) : undefined;
    const chessInput = chessDirectory ? join(chessDirectory, 'door.txt') : undefined;
    if (chessInput) await writeFile(chessInput, 'door\n');
    const chessDigest = pureHostFunction(value => {
        const key = typeof value === 'string' ? value : new TextDecoder().decode(value);
        assert.match(key, /^door\d+$/);
        const index = Number(key.slice(4));
        const positions = [16, 8, 0, 0, 7, 1, 6, 2, 5, 3, 4];
        assert(index < positions.length, 'Chess fixture exceeded its expected search');
        const hash = new Uint8Array(16), position = positions[index];
        hash[0] = index === 0 ? 1 : 0;
        hash[2] = position;
        hash[3] = (position + 8) % 16 * 16;
        return hash;
    });
    let seed = 123456789;
    const runtime = new Interpreter(value => stdout.push(normalize(value)), {
        ...(mode === 'reference' ? reference : {}),
        args: updateDatabase ? [updateDatabase] : chessInput ? [chessInput] : [],
        io: nodeIo, md5: chessInput ? chessDigest : nodeMd5, sourceId: file, testing: file.endsWith('_test.ra'),
        loadModule: (...args) => {
            const module = loadModule(...args);
            loadedSources.add(relative(root, module.id));
            return module;
        },
        random: () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296),
        onTestResult: ({ name, passed, output, error }) => tests.push({
            name, passed, output: output.map(normalize), ...(error ? { error: normalize(error) } : {}),
        }),
        onIntegerLoopCompiled: capture('loop'), onTensorKernelCompiled: capture('tensor'),
        onScalarCompiled: capture('scalar'), onBlockCompiled: capture('block'),
        onFunctionBodyCompiled: capture('function'),
    });
    let error;
    const start = performance.now();
    try { const source = await readFile(file, 'utf8'); diagnostics.run(() => runtime.execute(source)); }
    catch (caught) { error = normalize(caught instanceof RankError ? caught.format() : String(caught)); }
    finally {
        runtime.dispose();
        if (chessDirectory) await rm(chessDirectory, { recursive: true });
    }
    const updatedDatabase = updateDatabase ? createHash('sha256').update(await readFile(updateDatabase)).digest('hex') : undefined;
    const result = { ...(updatedDatabase ? { updatedDatabase } : {}), file: relative(root, file), tests, stdout, ...(error ? { error } : {}),
        compiledLoops: diagnostics.compiledLoops, compiledTensors: diagnostics.compiledTensors,
        loadedSources: [...loadedSources].sort(), generated, fallbacks: diagnostics.fallbacks, durationMs: performance.now() - start };
    if (chessInput) {
        assert.equal(error, undefined);
        assert.deepEqual(stdout, ['80071625', '89abcdef']);
    }
    results.push(result);
    await writeFile(output, JSON.stringify({ mode, results }, null, 2) + '\n');
    process.stderr.write(`${result.file}: ${tests.length} tests, ${Math.round(result.durationMs)}ms${error || tests.some(test => !test.passed) ? ' FAILED' : ''}\n`);
}
if (selection === 'unpaired') {
    const directory = join(root, 'demos/pgexercises/data');
    const exports = {};
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.csv')).sort()) {
        exports[name] = createHash('sha256').update(await readFile(join(directory, name))).digest('hex');
    }
    await writeFile(output, JSON.stringify({ mode, results, exports }, null, 2) + '\n');
}
if (mode === 'reference' && results.some(result => result.compiledLoops || result.compiledTensors || Object.keys(result.generated).length)) {
    throw new Error('Reference audit unexpectedly compiled code');
}
if (results.some(result => result.error || result.tests.some(test => !test.passed))) process.exitCode = 1;
