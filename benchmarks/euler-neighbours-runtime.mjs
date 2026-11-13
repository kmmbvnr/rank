import {readFileSync, writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {Session} from 'node:inspector/promises';
const controls = (process.env.CONTROL || '').split(',');
const disabled = name => controls.includes(name) || controls.includes('all');
registerHooks({load(url, context, next) {
    const result = next(url,context);
    if (!url.endsWith('.js') || !url.includes('/out/')) return result;
    let source = String(result.source);
    if(disabled('vector-work')&&url.endsWith('/jit/number-loop-runtime.js')) {
        const needle='const vectorEntryWork = prepareVectorEntryWork(plan, host);';
        if(!source.includes(needle))throw Error('vector work control mismatch');
        source=source.replace(needle,'const vectorEntryWork = undefined;');
    }
    if(process.env.PROBE_CAP==='unbounded'&&url.endsWith('/jit/number-loop-runtime.js')) {
        const needle='conditionWriteCells > COPY_PROBE_CAP || !feedback';
        if(!source.includes(needle))throw Error('copy cap probe mismatch');
        source=source.replace(needle,'!feedback');
    }
    if(disabled('fenwick-storage')&&url.endsWith('/runtime/fenwick.js')) {
        source=readFileSync(new URL('experiments/fenwick-boxed-control.js',import.meta.url),'utf8');
    }
    if (disabled('abs') && url.endsWith('/operations.js')) {
        const start = source.indexOf("{ name: 'abs', module: 'numbers'");
        if (start >= 0) source = source.slice(0,start) + source.slice(start).replace(
            /\{ inputs: \['integer'\], result: 'integer', callbacks: 'none', cost: 'input-dependent' \},\s*/,'');
    }
    if (disabled('backoff') && url.endsWith('/function-invocation.js')) {
        const needle = 'const probeNumber = numberDelay === 0;';
        if (!source.includes(needle)) throw Error('backoff control mismatch');
        source = source.replace(needle, 'const probeNumber = true; numberDelay = 0; numberBackoff = 0;');
    }
    if (disabled('containers') && url.endsWith('/jit/scalar-function-proof.js')) {
        const needle = '!value || resultType && !sameCompiledCalleeType(resultType, value)';
        if (!source.includes(needle)) throw Error('container control mismatch');
        source = source.replace(needle,'!value || isCompiledContainer(value) || resultType && !sameCompiledCalleeType(resultType, value)');
    }
    if (disabled('fenwick') && url.endsWith('/runtime/fenwick.js')) {
        source = source.replace('export function hasNativeFenwick(value) {','export function hasNativeFenwick(value) { return false;');
    }
    if (disabled('groups') && url.endsWith('/runtime/integer-groups.js')) {
        source = source.replace('export function hasNativeIntegerGroups(value) {','export function hasNativeIntegerGroups(value) { return false;');
    }
    if (disabled('ordering') && url.endsWith('/jit/scalar-function-proof.js')) {
        source = source.replace("['sort', 'unique', 'argsort'].includes(last.name)","false && ['sort', 'unique', 'argsort'].includes(last.name)");
    }
    if (disabled('borrow') && url.endsWith('/jit/scalar-function-kernel.js')) {
        source = source.replace('parameterTypes.every(t => isNumType(t) || arrayParameter(t))','parameterTypes.every(t => isNumType(t))');
    }
    if (disabled('sort32') && url.endsWith('/runtime/numeric-collections.js')) {
        source = source.replace('new Int32Array(items.length)','new BigInt64Array(items.length)');
    }
    return {...result,source};
}});
const {Interpreter, RuntimeDiagnostics} = await import('../packages/interpreter/out/index.js');
const [id='373',scale='small',mode='compiled'] = process.argv.slice(2);
const files={370:'triangles',372:'pencils',373:'circles',374:'partproduct',375:'subseqmin',378:'triangles',379:'lcmcount',386:'antichain',388:'lines'};
const defaults={370:['--limit=10000000'],372:['--low=20000','--high=1000000'],373:['--limit=10000'],374:['--limit=10000000'],
    375:['--limit=100000','--period=100000'],378:['--limit=100000'],379:['--limit=10000000'],
    386:['--limit=100000'],388:['--n=1000000','--cut=10000']};
if(!files[id])throw Error('unknown case');
const args=scale==='full'?[]:scale==='small'?defaults[id]:[`--limit=${scale}`];
const path=process.env.VARIANT ? `benchmarks/experiments/euler${id}-${process.env.VARIANT}.ra`
    : id==='372'&&process.env.ORIGINAL ? 'benchmarks/experiments/euler372-original.ra' : `demos/euler/${id}_${files[id]}.ra`;
const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
let scalarCalls=0;
const runtime=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact',args,
    onScalarFunctionExecuted:()=>scalarCalls++});
const diagnostics=new RuntimeDiagnostics();
let session;
try {
    if(process.env.PROFILE){session=new Session();session.connect();await session.post('Profiler.enable');await session.post('Profiler.start');}
    const start=performance.now(),run=()=>runtime.execute(source);
    if(process.env.DIAGNOSTICS)diagnostics.run(run);else run();
    const ms=performance.now()-start;
    let memory;
    if(process.env.MEMORY) {
        const {ownedStorage}=await import('../packages/interpreter/out/array-storage-state.js');
        const arrays={};
        for(const [name,value] of runtime.variables) {
            const storage=value&&typeof value==='object'?ownedStorage.get(value):undefined;
            if(storage)arrays[name]={kind:storage.typed?.constructor.name||'boxed',length:storage.items.length,bytes:storage.typed?.byteLength};
        }
        const beforeGC=process.memoryUsage();globalThis.gc?.();
        memory={arrays,beforeGC,afterGC:process.memoryUsage()};
    }
    console.log(JSON.stringify({id,scale,mode,controls,args,ms,
        answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),scalarCalls,rssMiB:process.resourceUsage().maxRSS/1024,
        ...(process.env.DIAGNOSTICS?{diagnostics}:{}),...(memory?{memory}:{})}));
    if(session){const {profile}=await session.post('Profiler.stop');writeFileSync(process.env.PROFILE,JSON.stringify(profile));}
}finally{session?.disconnect();runtime.dispose();}
