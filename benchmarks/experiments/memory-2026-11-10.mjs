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
    const measured = {...memory, ms, cpuMs: (usage.user + usage.system) / 1000,
        peakRssMiB: process.resourceUsage().maxRSS / 1024};
    if (process.send) process.send(measured, () => process.disconnect());
    else console.error(JSON.stringify(measured));
} else {
    const roots = process.argv.slice(2).map(root => resolve(root));
    if (roots.length !== 2) throw Error('Usage: node benchmarks/experiments/nightly-2026-11-10.mjs BEFORE AFTER');
    const cases = [
    [
        "609_pisequences",
        "172023848"
    ],
    [
        "730_shiftedtriples",
        "1315965924"
    ],
    [
        "663_sumsofsubarrays",
        "1884138010064752"
    ],
    [
        "752_powers",
        "5610899769745488"
    ],
    [
        "468_smoothbinomial",
        "852950321"
    ],
    [
        "735_divisorsoftwo",
        "174848216767932"
    ],
    [
        "680_yarragnisrever",
        "563917241"
    ],
    [
        "718_unreachable",
        "228579116"
    ],
    [
        "608_divisorsums",
        "439689828"
    ],
    [
        "789_minimalpairing",
        "13431419535872807040"
    ],
    [
        "581_smoothtriangular",
        "2227616372734"
    ],
    [
        "660_pandigitaltriangles",
        "474766783"
    ],
    [
        "769_binaryquadraticform",
        "14246712611506"
    ],
    [
        "238_infinitestring",
        "9922545104535661"
    ],
    [
        "688_pilesofplates",
        "110941813"
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
                    const timeout = setTimeout(() => child.kill('SIGKILL'), 1200000);
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
