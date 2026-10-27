// Build first; compare --runtime=PATH in serial fresh processes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const { Interpreter, RuntimeDiagnostics } = await import(option('runtime')
    ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
const consumer = option('consumer') ?? 'unique len';
assert(['unique', 'unique len', 'unique sort'].includes(consumer));
const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
try {
    runtime.execute("use sequences\nInput = 1 to 200000 array\nPlan' = concat (Input mod 997) (Input mod 991)");
    const start = performance.now();
    if (process.argv.includes('--diag')) diagnostics.run(() => runtime.execute(`Answer = Plan ${consumer}`));
    else runtime.execute(`Answer = Plan ${consumer}`);
    const ms = performance.now() - start, rss = process.resourceUsage().maxRSS / 1024;
    if (consumer === 'unique len') assert.equal(runtime.variables.get('Answer'), 997n);
    else {
        assert.equal(runtime.execute('Answer len'), 997n);
        assert.equal(runtime.execute('Answer sum'), 496506n);
        assert.equal(runtime.execute('Answer 0'), consumer === 'unique sort' ? 0n : 1n);
        assert.equal(runtime.execute('Answer 996'), consumer === 'unique sort' ? 996n : 0n);
    }
    console.log(JSON.stringify({ consumer, cells: 400000, distinct: 997, ms, rss,
        ...(process.argv.includes('--diag') ? { diagnostics } : {}) }));
} finally { runtime.dispose(); }
