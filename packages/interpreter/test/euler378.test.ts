import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {Interpreter} from '../src/index.js';
import { answerOf } from './support.js';
const source=readFileSync(new URL('../../../demos/euler/378_triangles.ra',import.meta.url),'utf8');

function oracle(n: number): bigint {
    const divisors=(value: number)=>{let count=0;for(let d=1;d*d<=value;d++)if(value%d===0)count+=d*d===value?1:2;return count;};
    const counts=Array.from({length:n},(_,i)=>divisors((i+1)*(i+2)/2));
    let total=0n;
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)for(let k=j+1;k<n;k++)if(counts[i]>counts[j]&&counts[j]>counts[k])total++;
    return total;
}
describe.each([true,false])('Euler 378 Fenwick passes %s',compilation=>{
    it('matches direct divisor/triple enumeration',()=>{
        for(const limit of [0,1,2,3,10,20,40,80,100]) {
            const runtime=new Interpreter(()=>{},{compilation,args:[`--limit=${limit}`]});
            try{runtime.execute(source);expect(answerOf(runtime)).toBe(oracle(limit));}
            finally{runtime.dispose();}
        }
    });
});
it('retains the full sixty-million-element answer',()=>{
    const runtime=new Interpreter(()=>{});
    try{runtime.execute(source);expect(answerOf(runtime)).toBe(147534623725724718n);}
    finally{runtime.dispose();}
},120000);
