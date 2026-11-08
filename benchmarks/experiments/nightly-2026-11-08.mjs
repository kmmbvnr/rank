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
    process.send({ms, cpuMs: (usage.user + usage.system) / 1000,
        peakRssMiB: process.resourceUsage().maxRSS / 1024}, () => process.disconnect());
} else {
    const roots = process.argv.slice(2).map(root => resolve(root));
    if (roots.length !== 2) throw Error('Usage: node benchmarks/experiments/nightly-2026-11-08.mjs BEFORE AFTER');
    const cases = [
        ['150_subtriangle', '-271248680'], ['201_subsetsums', '115039000'],
        ['026_reciprocal', '983'], ['547_hollowsquarelaminae', '11730879.0023'],
        ['543_primesums', '199007746081234640'], ['238_infinitestring', '9922545104535661'],
        ['580_squarefreehilbert', '2327213148095366'], ['680_yarragnisrever', '563917241'],
        ['715_sextupletnorms', '883188017'],
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
                        cwd: root, silent: true, execArgv: ['--max-old-space-size=4096'],
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
                        else resolveResult({round, variant, path: file, sourceHash, ...measured, answer,
                            node: process.version, arch: process.arch});
                    });
                });
                console.log(JSON.stringify(result));
            }
        }
    }
}
