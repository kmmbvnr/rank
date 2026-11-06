import {fork} from 'node:child_process';
import {resolve} from 'node:path';

// Each checkout must have its own built packages and installed dependencies.
const roots = process.argv.slice(2).map(root => resolve(root));
if (roots.length !== 2) throw Error('Usage: node benchmarks/experiments/nightly-seven.mjs BEFORE AFTER');
const cases = [
    ['700_eulercoin', '1517926517777556'],
    ['212_combinedvolume', '328968937309'],
    ['645_everydayholiday', '48894.2174'],
    ['234_semidivisible', '1259187438574927161'],
    ['245_coresilience', '288084712410001'],
    ['283_integertriangles', '28038042525570324'],
    ['695_randomrectangles', '0.1017786859'],
];
for (let round = 0; round < 3; round++) {
    for (const [name, answer] of cases) {
        for (const variant of round % 2 ? [1, 0] : [0, 1]) {
            const root = roots[variant], path = `demos/euler/${name}.ra`;
            const result = await new Promise((resolve, reject) => {
                let ms, stdout = '', stderr = '';
                const child = fork(resolveWorker(root), [root, 'program', path], {cwd: root, silent: true});
                const timeout = setTimeout(() => child.kill('SIGKILL'), 600000);
                child.on('message', message => { ms = message.ms; });
                child.stdout.on('data', chunk => { stdout += chunk; });
                child.stderr.on('data', chunk => { stderr += chunk; });
                child.on('error', error => { clearTimeout(timeout); reject(error); });
                child.on('exit', (code, signal) => {
                    clearTimeout(timeout);
                    if (code !== 0 || !Number.isFinite(ms) || stdout.trim() !== answer)
                        reject(Error(`${path}: code=${code}, signal=${signal}, output=${stdout}, error=${stderr}`));
                    else resolve({round, variant, path, ms, answer});
                });
            });
            console.log(JSON.stringify(result));
        }
    }
}
function resolveWorker(root) { return resolve(root, 'benchmarks/nightly/worker.mjs'); }
