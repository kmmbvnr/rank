import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const source=readFileSync(new URL('../../../demos/euler/468_smoothbinomial.ra',import.meta.url),'utf8');
const backends:InterpreterOptions[]=[{}, {compilation:false}, {numberLoopCompilation:false}];
const modulus=1000000993n;
// Build actual binomial coefficients and their B-smooth divisors.
// No event timelines, Kummer carries, affine maps or row symmetry.
function direct(n:number) {
    const primes=Array.from({length:n+1},(_,i)=>i).filter(p=>p>=2&&Array.from({length:Math.max(0,Math.floor(Math.sqrt(p))-1)},(_,j)=>j+2).every(d=>p%d!==0));
    let coefficient=1n,total=0n;
    for(let r=0;r<=n;r++) {
        const factors=new Map<number,bigint>();let rest=coefficient;
        for(const p of primes){let power=1n;while(rest%BigInt(p)===0n){rest/=BigInt(p);power*=BigInt(p);}factors.set(p,power);}
        let smooth=1n;
        for(let bound=1;bound<=n;bound++){smooth*=factors.get(bound)??1n;total=(total+smooth)%modulus;}
        coefficient=coefficient*BigInt(n-r)/BigInt(r+1);
    }
    return total;
}
function solve(n:number,options:InterpreterOptions={}) {
    const runtime=new Interpreter(()=>{}, {...options,args:[`--n=${n}`]});
    try{runtime.execute(source);return answerOf(runtime);}finally{runtime.dispose();}
}
it.each([0,1,2,3,4,5,7,11,16,29,30,31,32,36,37,61,62,63,64,95])('matches explicit B-smooth binomial divisors at N=%s', n=>{
    const expected=direct(n);
    for(const options of backends)expect(solve(n,options)).toBe(expected);
});
// N=991 has cancelling first-power boundaries and a nonzero 31^2 carry.
it.each([960,961,962,991,1921,1922])('matches exact coefficient factorization at the 31-power boundary N=%s', n=>{
    const expected=direct(n);
    for(const options of backends)expect(solve(n,options)).toBe(expected);
},30000);
it.each([{}, {compilation:false}])('retains statement checkpoints with options=%j',options=>{
    expect(solve(1111,options)).toBe(706036312n);
    expect(solve(111111,options)).toBe(22156169n);
},60000);

it('retains both imported tests across changed N on all backends',()=>{
    const fixture=new URL('../../../demos/euler/468_smoothbinomial_test.ra',import.meta.url);
    for(const options of backends){
        const results:{passed:boolean}[]=[];
        const runtime=new Interpreter(()=>{}, {...options,testing:true,sourceId:fixture.pathname,
            loadModule(specifier){expect(specifier).toBe('468_smoothbinomial');return{id:new URL('468_smoothbinomial.ra',fixture).pathname,source};},
            onTestResult:result=>results.push(result)});
        try{runtime.execute(readFileSync(fixture,'utf8'));expect(results.map(x=>x.passed)).toEqual([true,true]);}finally{runtime.dispose();}
    }
},60000);
