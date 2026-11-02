// Independent direct DP and fresh-process measurements, including production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
const [variant = 'original', mode = 'compiled', limit = '1000000', diag] = process.argv.slice(2);
assert(['original', 'reuse', 'fused', 'compact', 'region', 'reuse-sub', 'compact-sub', 'half-sub', 'private', 'private-range', 'production'].includes(variant));
const source = readFileSync(new URL(variant === 'production'
    ? '../demos/euler/337_totientstairs.ra' : `experiments/euler337-${variant}.ra`, import.meta.url), 'utf8');
const output = [];
const kernels = [];
const runtime = new Interpreter(text => output.push(text.trim()), {
    compilation: mode !== 'reference', args: [`--limit=${limit}`],
    ...(diag ? { onIntegerLoopCompiled: code => kernels.push(code) } : {}),
});
const diagnostics = new RuntimeDiagnostics();
function oraclePrefix(n) {
    const gcd = (a,b) => b ? gcd(b,a%b) : a;
    const phi = Array.from({length:n+1}, (_,k) => {
        let count=0; for(let j=1;j<=k;j++) if(gcd(j,k)===1) count++;
        return count;
    });
    const ways = new Float64Array(n+1);
    for(let k=6;k<=n;k++) {
        if(k===6) { ways[k]=1; continue; }
        for(let j=6;j<k;j++) if(j>phi[k] && phi[j]<phi[k]) ways[k]=(ways[k]+ways[j])%100000000;
    }
    let total=0;
    return Array.from(ways, value => total=(total+value)%100000000);
}
try {
    if(mode === 'verify' || mode === 'verify-reference') {
        runtime.dispose();
        const check = new Interpreter(()=>{}, {compilation:mode==='verify',args:[`--limit=${limit}`]});
        try {
            const program = variant === 'production'
                ? source.replace('Answer = Limit stairs\nAnswer print', '').replace('return Phi Limit', 'return Phi') + '\nLimit stairs'
                : variant.startsWith('private') || variant === 'region'
                ? source.replace('Limit solve print','').replace('return Phi Limit','return Phi') + '\nLimit solve'
                : source.replace(/(Pre|Phi) Limit print/, '$1');
            const actual=check.execute(program), expected=oraclePrefix(Number(limit));
            assert.deepEqual(actual.shape,[expected.length]);
            for(let i=0;i<expected.length;i++) assert.equal(actual.items[i],BigInt(expected[i]),`${variant}/${mode}/${i}`);
            console.log(JSON.stringify({variant,mode,n:Number(limit),checks:expected.length,oracle:'direct coprime counting and quadratic predecessor DP'}));
        } finally {check.dispose();}
    } else {
    const start=performance.now();
    const run=()=>runtime.execute(source);
    if(diag) diagnostics.run(run); else run();
    const ms=performance.now()-start;
    const answer=output.at(-1);
    const gold = new Map([[10,'4'],[100,'82073668'],[10000,'73808307'],[1000000,'23116575'],[20000000,'85068035']]);
    assert.equal(answer, Number(limit)<=300 ? String(oraclePrefix(Number(limit)).at(-1)) : gold.get(Number(limit)));
    console.log(JSON.stringify({variant,mode,n:Number(limit),node:process.version,ms,rssMiB:process.resourceUsage().maxRSS/1024,answer,...(diag?{diagnostics,kernels:kernels.map(code=>({rangeArray:code.includes('rangeArray('),createArray:code.includes('createArray('),loops:(code.match(/for \(/g)||[]).length}))}:{})}));
    }
} finally { runtime.dispose(); }
