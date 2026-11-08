import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { Interpreter,type InterpreterOptions } from '../src/index.js';
const fixture=new URL('../../../demos/euler/487_sumsofpowersums_test.ra',import.meta.url);
const source=readFileSync(new URL('487_sumsofpowersums.ra',fixture),'utf8');
const backends:InterpreterOptions[]=[{}, {compilation:false}, {numberLoopCompilation:false}];
function primes(low:number,width:number) {
    const result:number[]=[];
    for(let n=Math.max(2,low);n<=low+width;n++) {
        let prime=true;for(let d=2;d*d<=n;d++) if(n%d===0) {prime=false;break;}
        if(prime) result.push(n);
    }
    return result;
}
function brute(k:number,n:number,low:number,width:number) {
    let sum=0n;
    for(let i=1;i<=n;i++) sum+=BigInt(n+1-i)*BigInt(i)**BigInt(k);
    return primes(low,width).reduce((a,p)=>a+sum%BigInt(p),0n);
}
it.each([
    [0,0,2,0],[0,1,2,5],[0,10,17,0],[0,100,2,20],[1,37,2,20],[2,10,17,0],
    [5,1000,101,6],[3,3,17,0],[3,5,17,0],[3,6,17,0],[3,17,17,0],
    [3,18,17,0],[4,35,2,30],[8,99,3,20],[12,1000,2,20],[11,73,101,12],[2,20,14,2],
])('matches direct weighted powers: K=%s N=%s Lo=%s Wd=%s',(k,n,low,width)=>{
    for(const options of backends) {
        const r=new Interpreter(()=>{}, {...options,args:[`--k=${k}`,`--n=${n}`,`--lo=${low}`,`--wd=${width}`]});
        try {r.execute(source);expect(r.variables.get('Answer')).toBe(brute(k,n,low,width));}
        finally {r.dispose();}
    }
});
it.each(backends)('retains the fixture and exact large-N closed forms with %j',options=>{
    const results:boolean[]=[];
    const r=new Interpreter(()=>{}, {...options,testing:true,sourceId:fixture.pathname,
        loadModule:()=>({id:new URL('487_sumsofpowersums.ra',fixture).pathname,source}),onTestResult:x=>results.push(x.passed)});
    try {r.execute(readFileSync(fixture,'utf8'));expect(results).toEqual([true]);}
    finally {r.dispose();}
    const n=10n**40n+13n;
    for(const k of [0,1]) {
        const total=k===0?n*(n+1n)/2n:n*(n+1n)*(n+2n)/6n;
        const expected=primes(2,45).reduce((a,p)=>a+total%BigInt(p),0n);
        const runtime=new Interpreter(()=>{}, {...options,args:[`--k=${k}`,`--n=${n}`,'--lo=2','--wd=45']});
        try {runtime.execute(source);expect(runtime.variables.get('Answer')).toBe(expected);}
        finally {runtime.dispose();}
    }
});
it('matches the full exact native oracle',()=>{
    const r=new Interpreter(()=>{});
    try {r.execute(source);expect(r.variables.get('Answer')).toBe(106650212746n);}
    finally {r.dispose();}
},120000);
