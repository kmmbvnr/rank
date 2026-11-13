import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {Interpreter,isRankArray,type InterpreterOptions} from '../src/index.js';
import {readArrayItem} from '../src/array-storage.js';
import { answerOf } from './support.js';
const source=readFileSync(new URL('../../../demos/euler/540_primitivetriples.ra',import.meta.url),'utf8');
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
function brute(limit:number){let count=0;for(let m=2;m*m+1<=limit;m++)for(let n=1;n<m&&m*m+n*n<=limit;n++)if((m-n)%2&&gcd(m,n)===1)count++;return BigInt(count);}
function mobius(n:number){let value=1;for(let p=2;p*p<=n;p++)if(n%p===0){n/=p;value=-value;if(n%p===0)return 0;while(n%p===0)n/=p;}return n>1?-value:value;}
function answer(n:number,options:InterpreterOptions,table=1000000,batch=250000){
    const runtime=new Interpreter(()=>{}, {...options,args:[`--n=${n}`,`--table=${table}`,`--batch=${batch}`]});
    try{runtime.execute(source);return answerOf(runtime);}finally{runtime.dispose();}
}
const modes=[{name:'Number',options:{}},{name:'exact',options:{numberLoopCompilation:false}},{name:'reference',options:{compilation:false}}];
describe.each(modes)('Euler 540 $name',({options})=>{
    it.each([0,1,2,3,4,5,10,13,20,25,45,65,100,101,250,999,1000,10000])('matches direct coprime pairs through %s',n=>expect(answer(n,options)).toBe(brute(n)));
    it.each([[5,1],[31,7],[500,13],[-3,0],[1000000,250000]])('preserves table and batch boundaries, table=%s batch=%s',(table,batch)=>{
        expect(answer(1000,options,table,batch)).toBe(brute(1000));
    });
    it('matches the million-bound regression',()=>expect(answer(1000000,options)).toBe(159139n));
    it.each([1,2,3,9,45,1000])('matches all odd Möbius coefficients through %s',limit=>{
        const runtime=new Interpreter(()=>{},options);
        try{runtime.execute(source.slice(0,source.indexOf('fun Limit solve')));const result=runtime.execute(`${limit} mobius`);
            if(!result||!isRankArray(result))throw Error('expected Möbius array');
            expect(result.shape).toEqual([Math.floor((limit+1)/2)]);
            for(let i=0;i<result.shape[0];i++)expect(readArrayItem(result,i)).toBe(BigInt(mobius(2*i+1)));
        }finally{runtime.dispose();}
    });
    it('matches the full exact result',()=>expect(answer(3141592653589793,options)).toBe(500000000002845n),120000);
});
it('reuses the same solver across different geometry and table sizes',()=>{
    const runtime=new Interpreter(()=>{});
    const local=source.replace('arg N integer = 3141592653589793','arg N integer = 20').replace('arg Table integer = 1000000','arg Table integer = 7').replace('arg Batch integer = 250000','arg Batch integer = 3');
    try{runtime.execute(local);expect(runtime.execute('10000 solve')).toBe(brute(10000));expect(runtime.execute('5 solve')).toBe(1n);expect(runtime.execute('0 solve')).toBe(0n);}
    finally{runtime.dispose();}
});
