// Fresh-process Euler 211 harness; --reuse/--multiplicative retain research controls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = name => process.argv.includes(`--${name}`);
const {Interpreter,RuntimeDiagnostics} = await import(pathToFileURL(resolve(option('runtime') ?? 'packages/interpreter/out/index.js')));
const file = fileURLToPath(new URL(flag('multiplicative') ? './experiments/euler211-multiplicative.ra'
    : `../demos/euler/211_divisorsquare${flag('fixture') ? '_test' : ''}.ra`, import.meta.url));
function transform(source) {
    if (flag('reuse')) source = source.replace('Total = 0', 'Total = 0\nSig = array shape Block fill 0')
        .replace('  Sig = array shape Block fill 0', '  for Clear in 0 till Block\n    Sig Clear = 0\n  end');
    if (option('Limit')) source = source.replace('64000000',option('Limit'));
    if (option('Block')) source = source.replace('1000000',option('Block'));
    return source;
}
const source = transform(readFileSync(file, 'utf8'));
const runtime = new Interpreter(()=>{}, {compilation: !flag('reference'), testing: flag('fixture'), sourceId: file,
    loadModule(specifier, from) {
        const id = resolve(dirname(from ?? file), `${specifier}.ra`);
        return {id, source: transform(readFileSync(id, 'utf8'))};
    },
});
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    if (flag('diag')) diagnostics.run(()=>runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const answer = flag('fixture') ? undefined : String(runtime.variables.get('Answer'));
    if (flag('fixture')) { assert.equal(runtime.testResults.length, 1); assert(runtime.testResults.every(t => t.passed)); }
    else if (!option('Limit') || option('Limit') === '64000000') assert.equal(answer,'1922364685');
    console.log(JSON.stringify({args:process.argv.slice(2),ms,rssMiB:process.resourceUsage().maxRSS/1024,answer,
        sourceHash:createHash('sha256').update(source).digest('hex'),tests:runtime.testResults,...(flag('diag') ? {diagnostics} : {})}));
} finally { runtime.dispose(); }
