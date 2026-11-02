// Euler 336 benchmark and independent forward-sorting oracle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Compare compiler admission alone without mutating installed runtime files.
if (process.env.TEXT_SLICING === '0') {
    const { registerHooks } = await import('node:module');
    registerHooks({ load(url, context, nextLoad) {
        const loaded = nextLoad(url, context);
        if (!url.endsWith('/jit/scalar-function-proof.js')) return loaded;
        const source = String(loaded.source);
        const needle = "typeof array === 'string' && array !== 'text'";
        assert(source.includes(needle), 'text slicing control must match exactly');
        return { ...loaded, source: source.replace(needle, "typeof array === 'string'") };
    } });
}
const { Interpreter, RuntimeDiagnostics } = await import('../packages/interpreter/out/index.js');
const [variant='original', mode='compiled', size='11', rank='2011', diagnostic] = process.argv.slice(2);
const load = name => readFileSync(new URL(`experiments/euler336-${name}.ra`, import.meta.url), 'utf8').replace('11 maximix 2011 print','');
const source = variant === 'production'
    ? readFileSync(new URL('../demos/euler/336_maximix.ra', import.meta.url), 'utf8').replace('11 maximix 2011 print','')
    : load(variant);
let scalarCalls=0;
const runtime = new Interpreter(()=>{}, { compilation: !['reference', 'verify-reference'].includes(mode),
    ...(mode === 'nohelper' ? { scalarFunctionCompilation: false } : {}),
    onScalarFunctionExecuted: ()=>scalarCalls++ });
const d = new RuntimeDiagnostics();
try {
    runtime.execute(source);
    if (mode.startsWith('verify')) {
        let checks=0;
        // Independent forward train-sorting oracle over all permutations.
        function permutations(a, i=0, out=[]) {
            if(i===a.length) { out.push([...a]); return out; }
            for(let j=i;j<a.length;j++) { [a[i],a[j]]=[a[j],a[i]]; permutations(a,i+1,out); [a[i],a[j]]=[a[j],a[i]]; }
            return out;
        }
        function reversals(a) {
            a=[...a]; let count=0;
            for(let i=0;i<a.length-1;i++) {
                const j=a.indexOf(i);
                if(j===i) continue;
                if(j!==a.length-1) { a.splice(j,a.length-j,...a.slice(j).reverse()); count++; }
                a.splice(i,a.length-i,...a.slice(i).reverse()); count++;
            }
            return count;
        }
        for(let n=2;n<=8;n++) {
            const expected=permutations(Array.from({length:n},(_,i)=>i))
                .filter(a=>reversals(a)===2*n-3).map(a=>a.map(i=>String.fromCharCode(65+i)).join('')).sort();
            let factorial=1; for(let i=2;i<=n-2;i++) factorial*=i;
            assert.equal(expected.length,factorial);
            const ranks=n<=6?expected.map((_,i)=>i+1):[1,2,Math.ceil(expected.length/2),expected.length];
            for(const k of ranks) { assert.equal(runtime.execute(`${n} maximix ${k}`),expected[k-1],`${variant}/${n}/${k}`); checks++; }
        }
        assert.equal(runtime.execute('11 maximix 2011'),'CAGBIHEFJDK');
        console.log(JSON.stringify({variant,mode,checks:checks+1,oracle:'forward sorting of every permutation through N=8'}));
    } else {
        assert(/^\d+$/.test(size) && /^\d+$/.test(rank));
        const start=performance.now(); const run=()=>runtime.execute(`${size} maximix ${rank}`);
        const answer=diagnostic?d.run(run):run();
        if(size==='11'&&rank==='2011') assert.equal(answer,'CAGBIHEFJDK');
        if(size==='6'&&rank==='10') assert.equal(answer,'DFAECB');
        console.log(JSON.stringify({variant,mode,n:Number(size),rank:Number(rank),node:process.version,textSlicing:process.env.TEXT_SLICING !== '0',
            ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer,scalarCalls,...(diagnostic?{diagnostics:d}:{})}));
    }
} finally { runtime.dispose(); }
