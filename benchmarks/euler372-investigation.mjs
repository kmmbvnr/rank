import {readFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
// Isolate catalogue admission without editing the installed compiler.
if (process.env.ABS_INTEGER) {
    const {registerHooks} = await import('node:module');
    registerHooks({load(url, context, nextLoad) {
        const loaded = nextLoad(url, context);
        if (!url.endsWith('/operations.js')) return loaded;
        const source = String(loaded.source);
        const marker = "{ name: 'abs', module: 'numbers'";
        const start = source.indexOf(marker);
        if (start < 0) return loaded;
        const before = source.slice(0, start);
        const after = source.slice(start).replace(
            "compiledCall: { inputs: ['real'], result: 'real'",
            "compiledCall: { inputs: ['integer'], result: 'integer'");
        return {...loaded, source:before+after};
    }});
}
const {Interpreter, RuntimeDiagnostics} = await import('../packages/interpreter/out/index.js');

const [variant='original', mode='compiled', low='20000', high='1000000'] = process.argv.slice(2);
const path = variant === 'production'
    ? '../demos/euler/372_pencils.ra' : `experiments/euler372-${variant}.ra`;
const source = readFileSync(new URL(path, import.meta.url), 'utf8');
const diagnostics = new RuntimeDiagnostics();
const sources = [];
let scalarCalls = 0;
const runtime = new Interpreter(()=>{}, {
    compilation: mode !== 'reference',
    numberLoopCompilation: mode !== 'exact',
    ...(mode === 'nohelper' ? {scalarFunctionCompilation:false} : {}),
    onScalarFunctionExecuted: ()=>scalarCalls++,
    args: [`--low=${low}`, `--high=${high}`],
    ...(process.env.SOURCES ? {
        onIntegerLoopCompiled: s=>sources.push({kind:'loop', source:s}),
        onFunctionBodyCompiled: s=>sources.push({kind:'function', source:s}),
    } : {}),
});
let session;
try {
    if(process.env.PROFILE) {
        session = new Session(); session.connect();
        await session.post('Profiler.enable');
        await session.post('Profiler.start');
    }
    const start = performance.now();
    const run = ()=>runtime.execute(source);
    if(process.env.DIAGNOSTICS) diagnostics.run(run); else run();
    console.log(JSON.stringify({variant, mode, low, high, node:process.version,
        ms:performance.now()-start, rssMiB:process.resourceUsage().maxRSS/1024,
        answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)), scalarCalls,
        absIntegerPrototype:!!process.env.ABS_INTEGER,
        ...(process.env.DIAGNOSTICS ? {diagnostics} : {})}));
    if(session) {
        const {profile} = await session.post('Profiler.stop');
        writeFileSync(process.env.PROFILE, JSON.stringify(profile));
    }
    if(process.env.SOURCES) writeFileSync(process.env.SOURCES, JSON.stringify(sources));
} finally {session?.disconnect(); runtime.dispose();}
