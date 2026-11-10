import {fork} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

if (process.argv[2] === '--worker') {
    const [root, file] = process.argv.slice(3);
    const {default: main} = await import(pathToFileURL(resolve(root, 'packages/cli/out/main.js')));
    process.argv = [process.execPath, resolve(root, 'packages/cli/bin/cli.js'), file];
    const cpu = process.cpuUsage(), start = performance.now();
    await main();
    const ms = performance.now() - start, usage = process.cpuUsage(cpu);
    const memory = {};
    if (process.env.GC === '1') {
        memory.heapBeforeGc = process.memoryUsage().heapUsed;
        global.gc();
        memory.heapAfterGc = process.memoryUsage().heapUsed;
        for (let turn = 0; turn < 4; turn++) {
            await new Promise(resolve => setImmediate(resolve));
            global.gc();
        }
        memory.heapAfterTurnGc = process.memoryUsage().heapUsed;
        const v8 = await import('node:v8');
        memory.code = v8.getHeapCodeStatistics();
        memory.spaces = v8.getHeapSpaceStatistics();
    }
    process.send({...memory, ms, cpuMs: (usage.user + usage.system) / 1000,
        peakRssMiB: process.resourceUsage().maxRSS / 1024}, () => process.disconnect());
} else {
    const roots = process.argv.slice(2).map(root => resolve(root));
    if (roots.length !== 2) throw Error('Usage: node benchmarks/experiments/nightly-2026-11-10.mjs BEFORE AFTER');
    const cases = [
    ["552_chineseleftovers2", "326227335"],
    [
        "750_cardstacking",
        "160640"
    ],
    [
        "507_shortestlattice",
        "316558047002627270"
    ],
    [
        "522_hiddenchains",
        "96772715"
    ],
    [
        "524_firstsort2",
        "2432925835413407847"
    ],
    [
        "542_geometricsums",
        "697586734240314852"
    ],
    [
        "543_primesums",
        "199007746081234640"
    ],
    [
        "614_specialpartitions",
        "130694090"
    ],
    [
        "615_millionthnumber",
        "108424772"
    ],
    [
        "623_lambdaterms",
        "3679796"
    ],
    [
        "625_gcdsum",
        "551614306"
    ],
    [
        "626_binarymatrices",
        "695577663"
    ],
    [
        "670_colouringstrip",
        "551055065"
    ],
    [
        "729_periodicrange",
        "308896374.2502"
    ],
    [
        "060_primepairs",
        "26033"
    ],
    [
        "200_primeproofsqube",
        "229161792008"
    ],
    [
        "248_eulertotient",
        "23507044290"
    ],
    [
        "353_riskymoon",
        "1.2759860331"
    ],
    [
        "438_integerpart",
        "2046409616809"
    ],
    [
        "606_gozintachains",
        "158452775"
    ],
    [
        "667_movingpentagon",
        "1.5276527929"
    ],
    [
        "678_fermatlike",
        "1986065"
    ],
    [
        "699_triffle",
        "37010438774467572"
    ],
    [
        "708_twosareallyouneed",
        "28874142998632109"
    ],
    [
        "742_convexgridpolygon",
        "18397727"
    ],
    [
        "782_distinctrowscolumns",
        "318313204"
    ]
].filter(([name]) => !process.env.CASES || process.env.CASES.split(',').includes(name.slice(0, 3)));
    const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
    for (let round = 0; round < Number(process.env.ROUNDS || 3); round++) {
        for (const [name, answer] of cases) {
            const file = `demos/euler/${name}.ra`, sourceHash = sha(resolve(roots[0], file));
            if (sourceHash !== sha(resolve(roots[1], file))) throw Error(`Different sources: ${file}`);
            for (const variant of round % 2 ? [1, 0] : [0, 1]) {
                const root = roots[variant];
                const result = await new Promise((resolveResult, reject) => {
                    let measured, stdout = '', stderr = '';
                    const child = fork(new URL(import.meta.url), ['--worker', root, file], {
                        cwd: root, silent: true,
                        execArgv: ['--max-old-space-size=4096', ...(process.env.GC === '1' ? ['--expose-gc'] : [])],
                        env: {...process.env, UV_THREADPOOL_SIZE: '1', OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1'},
                    });
                    const timeout = setTimeout(() => child.kill('SIGKILL'), 600000);
                    child.on('message', value => { measured = value; });
                    child.stdout.on('data', chunk => { stdout += chunk; });
                    child.stderr.on('data', chunk => { stderr += chunk; });
                    child.on('error', error => { clearTimeout(timeout); reject(error); });
                    child.on('exit', (code, signal) => {
                        clearTimeout(timeout);
                        if (code !== 0 || !Number.isFinite(measured?.ms) || stdout.trim() !== answer)
                            reject(Error(`${file}: code=${code}, signal=${signal}, output=${stdout}, error=${stderr}`));
                        else resolveResult({round, variant, root, path: file, sourceHash, ...measured, answer,
                            node: process.version, arch: process.arch});
                    });
                });
                console.log(JSON.stringify(result));
            }
        }
    }
}
