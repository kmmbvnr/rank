import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {Interpreter, RuntimeDiagnostics, type InterpreterOptions} from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/545_faulhaberformulas.ra', import.meta.url), 'utf8');
function prime(n: number) {if (n < 2) return false; for (let d=2;d*d<=n;d++) if (n%d===0) return false; return true;}
function denominator(n: number) {
    let value=1n;
    for (let d=1;d*d<=n;d++) if(n%d===0) {
        if(prime(d+1)) value*=BigInt(d+1);
        const other=n/d;
        if(other!==d&&prime(other+1)) value*=BigInt(other+1);
    }
    return value;
}
const expected: bigint[]=[];
for(let n=308;expected.length<100;n+=308) if(denominator(n)===20010n) expected.push(BigInt(n));
function solve(q: number, options: InterpreterOptions, text=source) {
    const runtime=new Interpreter(()=>{}, {...options,args:[`--q=${q}`]});
    const diagnostics=new RuntimeDiagnostics();
    try {diagnostics.run(()=>runtime.execute(text));return {answer:runtime.variables.get('Answer'),diagnostics};}
    finally {runtime.dispose();}
}
const modes=[{name:'Number',options:{}},{name:'exact',options:{numberLoopCompilation:false}},{name:'reference',options:{compilation:false}}];
describe.each(modes)('Euler 545 $name',({options,name})=>{
    it.each([1,2,3,5,10,15,25,50,100])('matches a direct denominator search for Q=%s',q=>expect(solve(q,options).answer).toBe(expected[q-1]));
    it('doubles an insufficient initial bound until enough terms exist',()=>{
        const text=source.replace('Initial = Count * 32 max 1024','Initial = 16');
        expect(solve(10,options,text).answer).toBe(96404n);
    });
    it('matches the complete result and compiles the marking loop when enabled',()=>{
        const result=solve(100000,options);
        expect(result.answer).toBe(921107572n);
        if(name==='Number') expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
    },120000);
});
it('reuses a solver without retaining the previous target or marks',()=>{
    const runtime=new Interpreter(()=>{});
    try {runtime.execute(source.replace('arg Q integer = 100000','arg Q integer = 10'));
        expect(runtime.execute('50 solve')).toBe(expected[49]);
        expect(runtime.execute('1 solve')).toBe(308n);
        expect(runtime.execute('2 solve')).toBe(21868n);
    }finally{runtime.dispose();}
});
