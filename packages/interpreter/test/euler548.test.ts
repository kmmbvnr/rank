import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {Interpreter,type InterpreterOptions} from '../src/index.js';
const source=readFileSync(new URL('../../../demos/euler/548_gozintachains.ra',import.meta.url),'utf8');
const chains=Array<bigint>(10001).fill(0n);chains[1]=1n;
for(let d=1;d<chains.length;d++)for(let multiple=2*d;multiple<chains.length;multiple+=d)chains[multiple]+=chains[d];
const sums=Array<bigint>(chains.length).fill(0n);
for(let n=1;n<chains.length;n++)sums[n]=sums[n-1]+(chains[n]===BigInt(n)?BigInt(n):0n);
function solve(limit:number|string,options:InterpreterOptions){const r=new Interpreter(()=>{}, {...options,args:[`--l=${limit}`]});try{r.execute(source);return r.variables.get('Answer');}finally{r.dispose();}}
const modes=[{name:'Number',options:{}},{name:'exact',options:{numberLoopCompilation:false}},{name:'reference',options:{compilation:false}}];
describe.each(modes)('Euler 548 $name',({options})=>{
    it.each([0,1,2,47,48,49,100,120,1279,1280,2495,2496,10000])('matches a direct proper-divisor recurrence through %s',limit=>expect(solve(limit,options)).toBe(sums[limit]));
    it('matches the million-bound fixture',()=>expect(solve(1000000,options)).toBe(516961n));
    it('matches the full exact sum beyond Number precision',()=>expect(solve('10000000000000000',options)).toBe(12144044603581281n),120000);
    it('canonicalizes exponent multisets independently of the search limit',()=>{
        const r=new Interpreter(()=>{},options);
        try{r.execute(source.replace('arg L integer = 10000000000000000','arg L integer = 1'));
            for(const [n,minimum] of [[1n,1n],[48n,48n],[675n,72n],[3n**30n,2n**30n],[5n**13n*7n**4n,2n**13n*3n**4n]])expect(r.execute(`${n} canonical`)).toBe(minimum);
        }finally{r.dispose();}
    });
});
