// Independent full-sampling check of the shipping precheck's visibility decisions.
// This verifies the sampled route, not convergence to the continuous optimum.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { Interpreter } = await import(pathToFileURL(resolve(
    process.env.RUNTIME ?? 'packages/interpreter/out/index.js')).href);
const [step = '2', mode = 'compiled'] = process.argv.slice(2);
assert(['compiled', 'reference'].includes(mode));
assert(/^\d+$/.test(step) && Number(step) > 0);
const source = readFileSync(new URL('../demos/euler/262_mountainrange.ra', import.meta.url), 'utf8')
    .replace('arg Step integer = 2', `arg Step integer = ${step}`);
const runtime = new Interpreter(() => {}, { compilation: mode === 'compiled' });
try {
    runtime.execute(source);
    const scalar = name => Number(runtime.variables.get(name));
    const vector = name => Array.from(runtime.variables.get(name).items, Number);
    const x = vector('Lx'), y = vector('Ly'), va = vector('Va'), vb = vector('Vb');
    const da = vector('Da'), db = vector('Db'), prefix = vector('Sc');
    const threshold = scalar('F') + 1e-9, circumference = scalar('Lt');
    let samples = 0;
    function visible(ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const count = Math.max(2, Math.floor(Math.sqrt(dx * dx + dy * dy) / 0.5));
        let maximum = -Infinity;
        // Deliberately evaluate every original sample, even after obstruction.
        for (let j = 0; j < count; j++) {
            const t = j / (count - 1.0), px = ax + dx * t, py = ay + dy * t;
            const height = (5000 - 0.005 * (px * px + py * py + px * py) + 12.5 * (px + py))
                * Math.exp(-Math.abs(0.000001 * (px * px + py * py) - 0.0015 * (px + py) + 0.7));
            maximum = Math.max(maximum, height);
        }
        samples += count;
        return maximum <= threshold;
    }
    for (let i = 0; i < x.length; i++) {
        for (const [endpoint, mask, distances] of [[200, va, da], [1400, vb, db]]) {
            const clear = visible(endpoint, endpoint, x[i], y[i]);
            assert.equal(mask[i], Number(clear), `Step=${step}, endpoint=${endpoint}, vertex=${i}`);
            const dx = x[i] - endpoint, dy = y[i] - endpoint;
            assert.equal(distances[i], clear ? Math.sqrt(dx * dx + dy * dy) : 0);
        }
    }
    let best = visible(200, 200, 1400, 1400) ? 1200 * Math.sqrt(2) : 1000000;
    for (let i = 0; i < x.length; i++) if (va[i]) {
        for (let j = 0; j < x.length; j++) if (vb[j]) {
            const distance = Math.abs(prefix[j] - prefix[i]);
            best = Math.min(best, da[i] + Math.min(distance, circumference - distance) + db[j]);
        }
    }
    assert.equal(best, scalar('Best'));
    assert.equal(Math.round(best * 1000) / 1000, scalar('Answer'));
    console.log(JSON.stringify({ step, mode, vertices: x.length, lines: 2 * x.length + 1,
        samples, best, answer: scalar('Answer') }));
} finally { runtime.dispose(); }
