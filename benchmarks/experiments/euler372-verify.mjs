import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const root = new URL('../../', import.meta.url);
const mode = process.argv[2] || 'compiled';
const options = {compilation:mode!=='reference', numberLoopCompilation:mode!=='exact'};
const source = readFileSync(new URL('demos/euler/372_pencils.ra', root),'utf8');
const original = readFileSync(new URL('demos/euler/372_pencils.ra', root),'utf8');
const runtime = new Interpreter(()=>{},options);
const baseline = new Interpreter(()=>{},options);
// Independent binary-search integer root.
function sqrt(n) {
    if(n<2n) return n;
    let lo=0n, hi=n;
    while(lo+1n<hi) {const mid=(lo+hi)/2n; if(mid*mid<=n)lo=mid; else hi=mid;}
    return lo;
}
let helper=0, whole=0, boundaries=0;
try {
    runtime.execute('use numbers\n'+source.slice(source.indexOf('fun Low pencils')));
    baseline.execute('use numbers\n'+original.slice(original.indexOf('fun Low pencils')));
    for(let k=2n;k<=150n;k++) {
        const r=sqrt(k);
        if(r*r===k)continue;
        let sum=0n;
        for(let n=0n;n<=70n;n++) {
            sum+=sqrt(k*n*n);
            assert.equal(runtime.execute(`${k} ${r} ${n} surdsum`),sum,`helper ${k}/${n}`);
            helper++;
        }
        for(const n of [999999999n,1000000000n,9007199254740993n,10n**30n]) {
            const a=runtime.execute(`${k} ${r} ${n} surdsum`);
            const b=runtime.execute(`${k} ${r} ${n-1n} surdsum`);
            assert.equal(a-b,sqrt(k*n*n),`boundary ${k}/${n}`);
            boundaries++;
        }
    }
    for(let high=1;high<=65;high++)for(let low=0;low<high;low+=3) {
        let expected=0n;
        // Enumerate lattice points directly.
        for(let x=low+1;x<=high;x++)for(let y=low+1;y<=high;y++)
            if(Math.floor(y*y/(x*x))%2)expected++;
        const call=`${low} pencils ${high}`;
        assert.equal(runtime.execute(call),expected,call);
        assert.equal(baseline.execute(call),expected,`original ${call}`);
        whole++;
    }
    assert.equal(runtime.execute('0 pencils 100'),3019n);
    assert.equal(runtime.execute('100 pencils 1000'),254713n);
    console.log(JSON.stringify({mode,helper,whole,boundaries,fixture:true}));
} finally {runtime.dispose();baseline.dispose();}
