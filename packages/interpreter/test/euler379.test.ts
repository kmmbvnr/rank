import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {Interpreter,RuntimeDiagnostics} from '../src/index.js';

const source=readFileSync(new URL('../../../demos/euler/379_lcmcount.ra',import.meta.url),'utf8');

// For each prime exponent e of n, d(n^2) contributes 2e+1.
// This ordinary sieve is independent of the demo's quotient-value sieve.
function totals(limit: number) {
    const factors=new Int32Array(limit+1);
    const divisors=new Int32Array(limit+1).fill(1);
    for(let p=2;p<=limit;p++)if(!factors[p]) {
        for(let n=p;n<=limit;n+=p) {
            factors[n]=p;
            let rest=n,e=0;
            while(rest%p===0){rest/=p;e++;}
            divisors[n]*=2*e+1;
        }
    }
    let sum=0n;
    return Array.from(divisors,(count,n)=>{
        if(n===0)return 0n;
        sum+=BigInt(count);
        return (sum+BigInt(n))/2n;
    });
}

const expected=totals(10000);

describe.each([{}, {numberLoopCompilation:false}, {compilation:false}])('Euler 379 %o',options=>{
    it('matches direct divisor counts at square and quotient boundaries',()=>{
        for(const limit of [0,1,2,3,4,9,10,40,99,100,121,1234,4096,10000]) {
            const runtime=new Interpreter(()=>{},{...options,args:[`--limit=${limit}`]});
            try {
                runtime.execute(source);
                expect(runtime.variables.get('Answer')).toBe(expected[limit]);
            }finally{runtime.dispose();}
        }
    });
});

it('checks the independent divisor formula against explicit LCM pairs',()=>{
    const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
    for(let n=1;n<=100;n++) {
        let count=0n;
        for(let y=1;y<=n;y++)for(let x=1;x<=y;x++)if(x*y/gcd(x,y)<=n)count++;
        expect(expected[n]).toBe(count);
    }
});

it('compiles both full sieves above the private-copy cap',()=>{
    const runtime=new Interpreter(()=>{}),diagnostics=new RuntimeDiagnostics();
    try {
        diagnostics.run(()=>runtime.execute(source));
        expect(runtime.variables.get('Answer')).toBe(132314136838185n);
        expect(diagnostics.numberLoops).toBe(4);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.numberLoopCopyProbes).toBe(0);
        expect(diagnostics.fallbacks['number-loop:condition-write-budget']).toBeUndefined();
    }finally{runtime.dispose();}
},60000);
