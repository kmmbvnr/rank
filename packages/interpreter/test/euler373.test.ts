import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {Interpreter,parse} from '../src/index.js';
import { answerOf } from './support.js';

const source=readFileSync(new URL('../../../demos/euler/373_circles.ra',import.meta.url),'utf8');
const program=parse(source);
const helpers={...program,statements:program.statements.filter(s=>s.$type==='UseStatement'||s.$type==='FunctionStatement')};

// Enumerate integer sides with Heron's formula, without prime-factor formulas.
function oracle(limit: number): bigint[] {
    const counts=Array<bigint>(limit+1).fill(0n);
    for(let a=1;a<=2*limit;a++)for(let b=a;b<=2*limit;b++)for(let c=b;c<Math.min(a+b,2*limit+1);c++) {
        const left=a*a*b*b*c*c,right=(a+b+c)*(-a+b+c)*(a-b+c)*(a+b-c);
        if(left%right)continue;
        const square=left/right,r=Math.floor(Math.sqrt(square));
        if(r<=limit&&r*r===square)counts[r]++;
    }
    let sum=0n;
    return counts.map((count,r)=>sum+=BigInt(r)*count);
}

describe.each([{}, {numberLoopCompilation:false}, {compilation:false}])('Euler 373 %o',options=>{
    it('matches exhaustive side triples and both existing fixtures',()=>{
        const runtime=new Interpreter(()=>{},options),expected=oracle(80);
        try {
            runtime.executeProgram(helpers,[]);
            runtime.execute('Pr = primes to 1200 array\nPs = Pr (Pr mod 4 equal 1)');
            for(let n=0;n<=80;n++)expect(runtime.execute(`${n} raysum Ps 0 1 1 1 true`)).toBe(expected[n]);
            expect(runtime.execute('100 raysum Ps 0 1 1 1 true')).toBe(4950n);
            expect(runtime.execute('1200 raysum Ps 0 1 1 1 true')).toBe(1653605n);
        }finally{runtime.dispose();}
    });
});

it('retains the full default and empty prime-selection boundaries',()=>{
    for(const limit of [0,1,4,5,10000000]) {
        const runtime=new Interpreter(()=>{},{args:[`--limit=${limit}`]});
        try {
            runtime.execute(source);
            expect(answerOf(runtime)).toBe(limit===10000000?727227472448913n:limit===5?5n:0n);
        }finally{runtime.dispose();}
    }
});
