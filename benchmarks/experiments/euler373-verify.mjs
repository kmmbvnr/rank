import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const limit=120, counts=Array(limit+1).fill(0n);
// Exhaust integer side triples, independently of rational-angle generation.
for(let a=1;a<=2*limit;a++)for(let b=a;b<=2*limit;b++)for(let c=b;c<Math.min(a+b,2*limit+1);c++) {
    const left=a*a*b*b*c*c;
    const right=(a+b+c)*(-a+b+c)*(a-b+c)*(a+b-c);
    if(left%right)continue;
    const square=left/right,r=Math.floor(Math.sqrt(square));
    if(r<=limit&&r*r===square)counts[r]++;
}
const prefix=[];let sum=0n;
for(let r=0;r<=limit;r++){sum+=BigInt(r)*counts[r];prefix.push(sum);}
for(const variant of ['original','pairs','formula'])for(const compilation of [true,false]) {
    const source=readFileSync(new URL(`euler373-${variant}.ra`,import.meta.url),'utf8')
        .replace('arg Limit integer = 10000000','arg Limit integer = 0');
    const runtime=new Interpreter(()=>{},{compilation,testing:true,
        loadModule:()=>({id:'/e373.ra',source})});
    try {
        runtime.execute('use "e373"');
        for(let n=0;n<=limit;n++) {
            runtime.execute(`Limit = ${n}\nrun`);
            assert.equal((runtime.variables.get('Answer') ?? runtime.lastResult),prefix[n],`${variant}/${compilation}/${n}`);
        }
        runtime.execute('Limit = 1200\nrun');
        assert.equal((runtime.variables.get('Answer') ?? runtime.lastResult),1653605n);
        console.log(JSON.stringify({variant,compilation,whole:limit+1,fixture:true,oracle:'exhaustive integer side triples'}));
    }finally{runtime.dispose();}
}

// Compare every individual radius against the original geometric algorithm.
function count(r) {
    let f=1,m=1,h=1,n=r;
    for(let p=2;p*p<=n;p++) {
        let e=0;
        while(n%p===0){n/=p;e++;}
        if(p%4!==1||!e)continue;
        f*=3*e*(e+1)+1;m*=2*e+1;h*=2*Math.floor(e/2)+1;
    }
    if(n>1&&n%4===1){f*=7;m*=3;}
    return BigInt((2*f-3*m+3*h-2)/6);
}
const original=readFileSync(new URL('euler373-original.ra',import.meta.url),'utf8')
    .replace('arg Limit integer = 10000000','arg Limit integer = 0');
const baseline=new Interpreter(()=>{},{testing:true,loadModule:()=>({id:'/original.ra',source:original})});
try {
    baseline.execute('use "original"\nLimit = 10000\nrun');
    for(let r=1;r<=10000;r++)assert.equal(baseline.execute(`${r} Spf Data circles`),count(r),`radius ${r}`);
    console.log(JSON.stringify({individualRadii:10000,oracle:'original exact geometric algorithm',formula:'(2F-3M+3H-2)/6'}));
}finally{baseline.dispose();}
