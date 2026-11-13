import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {Interpreter,RuntimeDiagnostics} from '../src/index.js';
import { answerOf } from './support.js';

const source=readFileSync(new URL('../../../demos/euler/391_hopping.ra',import.meta.url),'utf8');

// The first popcount greater than n creates an uncrossable gap.
// Solve the finite reachable game backwards, independently of the DP.
function opening(n:number) {
    const positions=[0];let total=0;
    for(let k=1;;k++) {
        let x=k,bits=0;
        while(x){bits+=x&1;x>>>=1;}
        if(bits>n)break;
        total+=bits;positions.push(total);
    }
    const winning=new Uint8Array(total+1);
    for(let i=positions.length-2;i>=0;i--) {
        const here=positions[i];
        for(let j=i+1;j<positions.length && positions[j]-here<=n;j++) {
            if(!winning[positions[j]]){winning[here]=1;break;}
        }
    }
    let move=0;
    for(let i=1;i<positions.length && positions[i]<=n;i++)
        if(!winning[positions[i]])move=positions[i];
    return move;
}
const moves=Array.from({length:14},(_,i)=>opening(i+1));

describe.each([{}, {numberLoopCompilation:false}, {compilation:false}])('Euler 391 %o',options=>{
    it('matches every opening move against an independent finite game',()=>{
        const output:string[]=[];
        const runtime=new Interpreter(s=>output.push(String(s)),{...options,args:['--limit=14']});
        try {
            runtime.execute(source.replace('Answer += Val ** 3','Val print\n      Answer += Val ** 3'));
            expect(output.slice(0,14).map(Number)).toEqual(moves);
            expect(answerOf(runtime)).toBe(moves.reduce((s,v)=>s+BigInt(v)**3n,0n));
        }finally{runtime.dispose();}
    });
    it.each([[0,0n],[1,0n],[2,8n],[7,90n],[20,8150n]])('matches boundary/statement Limit%s', (limit,answer)=>{
        const runtime=new Interpreter(()=>{},{...options,args:[`--limit=${limit}`]});
        try {runtime.execute(source);expect(answerOf(runtime)).toBe(answer);}
        finally{runtime.dispose();}
    });
});

it('compiles the full Euler 391 search without rotating array snapshots',()=>{
    const runtime=new Interpreter(()=>{}),diagnostics=new RuntimeDiagnostics();
    try {
        diagnostics.run(()=>runtime.execute(source));
        expect(answerOf(runtime)).toBe(61029882288n);
        expect(diagnostics.compiledLoops).toBe(2);
        expect(diagnostics.cowCopies).toBe(0);
        expect(diagnostics.numberLoopOverflows).toBe(0);
    }finally{runtime.dispose();}
},60000);
