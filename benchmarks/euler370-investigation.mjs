import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';

// The baseline disables only the delivered polling selector. Other runtime
// changes and all generated arithmetic/storage checks are identical.
export const control = process.env.CONTROL || 'production';
let patched = false;
registerHooks({load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/out/jit/number-loop-runtime.js') || control === 'production') return result;
    assert.equal(control, 'baseline');
    let source = String(result.source);
    const policy = /const polling = !interruptsEnabled\(\) \? 'none'\s*: !demandBudgetEnabled\(\) && !plan\.calls\.length && !plan\.callouts\?\.length \? 'batched' : 'checked';/;
    assert.ok(policy.test(source), 'baseline control no longer matches the built runtime');
    source = source.replace(policy, "const polling = 'checked';");
    patched = true;
    return {...result, source};
}});
const {Interpreter, RuntimeDiagnostics} = await import('../packages/interpreter/out/index.js');
export {Interpreter, RuntimeDiagnostics};
export function assertPatched() { if (control !== 'production') assert.ok(patched); }

if (process.argv[1] === import.meta.filename) {
    const [mode = 'compiled', limit = '100000000', pivot = '1'] = process.argv.slice(2);
    let source = readFileSync(new URL('../demos/euler/370_triangles.ra', import.meta.url), 'utf8');
    if (pivot !== '1') source = source.replace('Cut = (Limit ** (1 / 3)) integer', `Cut = (${pivot} * Limit ** (1 / 3)) integer`);
    const runtime = new Interpreter(() => {}, {compilation: mode !== 'reference', args: ['--limit', limit]});
    const diagnostics = new RuntimeDiagnostics();
    const {withInterrupt} = await import('../packages/interpreter/out/interrupt.js');
    const start = performance.now();
    try {
        const execute = () => runtime.execute(source);
        const run = () => process.env.POLL ? withInterrupt(new Int32Array(1), execute) : execute();
        if (process.env.DIAGNOSTICS) diagnostics.run(run); else run();
        const answer = String((runtime.variables.get('Answer') ?? runtime.lastResult));
        const known = {1000000: '861805', 100000000: '108073540', 25000000000000: '41791929448408'};
        if (known[limit]) assert.equal(answer, known[limit]);
        assertPatched();
        console.log(JSON.stringify({mode, limit, pivot, control, polling: Boolean(process.env.POLL), answer, ms: performance.now() - start,
            rssMiB: process.resourceUsage().maxRSS / 1024,
            ...(process.env.DIAGNOSTICS ? {diagnostics} : {})}));
    } finally { runtime.dispose(); }
}
