import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const source=readFileSync(new URL('../../../demos/euler/466_distinctproducts.ra',import.meta.url),'utf8');
const backends: InterpreterOptions[]=[{}, {compilation:false}, {numberLoopCompilation:false}];
function gcd(a:bigint,b:bigint):bigint { while(b)[a,b]=[b,a%b];return a; }
// Independent inclusion-exclusion over table rows, without blocker sets,
// state merging, row ownership, bit masks, or memoization.
function rowSubsets(rows:number,columns:bigint) {
    let result=0n;
    for(let mask=1;mask<2**rows;mask++) {
        let multiple=1n,minimum=rows+1,count=0;
        for(let row=1;row<=rows;row++)if(mask&2**(row-1)) {
            multiple=multiple/gcd(multiple,BigInt(row))*BigInt(row);
            minimum=Math.min(minimum,row);count++;
        }
        const intersection=columns*BigInt(minimum)/multiple;
        result+=count%2?intersection:-intersection;
    }
    return result;
}
function brute(rows:number,columns:number) {
    const values=new Set<number>();
    for(let a=1;a<=rows;a++)for(let b=1;b<=columns;b++)values.add(a*b);
    return BigInt(values.size);
}
function solve(rows:number|bigint,columns:number|bigint,options:InterpreterOptions={}) {
    const runtime=new Interpreter(()=>{}, {...options,args:[`--m=${rows}`,`--n=${columns}`]});
    const diagnostics=new RuntimeDiagnostics();
    try { diagnostics.run(()=>runtime.execute(source));return {answer:answerOf(runtime),diagnostics}; }
    finally {runtime.dispose();}
}
it.each([[0,0],[0,7],[7,0],[1,1],[1,19],[3,4],[2,11],[5,12],[12,5],[7,17],[11,23],[12,345],[64,64]])('matches distinct product enumeration for %s by %s',(rows,columns)=>{
    const expected=brute(rows,columns);
    for(const options of backends)expect(solve(rows,columns,options).answer).toBe(expected);
});
it.each([9007199254740991n,9007199254740992n,9007199254740993n,10000000000000000n,10000000000000001n,(1n<<80n)+3n])('matches unmerged row subsets with exact wide columns=%s',columns=>{
    for(const rows of [2,3,5,8,10]) {
        const expected=rowSubsets(rows,columns);
        for(const options of backends)expect(solve(rows,columns,options).answer).toBe(expected);
    }
});
it('memoizes scalar sets above bit 63 without capturing the global width or limit',()=>{
    for(const options of backends) {
        const runtime=new Interpreter(()=>{},options),diagnostics=new RuntimeDiagnostics();
        try {
            runtime.execute(source.split('\nRows = M min N\n')[0]);
            const mask=1n<<79n;
            expect(diagnostics.run(()=>runtime.execute(`1000 avoiding ${mask}`))).toBe(988n);
            expect(diagnostics.run(()=>runtime.execute(`1000 avoiding ${mask}`))).toBe(988n);
            expect(diagnostics.run(()=>runtime.execute(`129 avoiding ${mask}`))).toBe(128n);
            expect(diagnostics.memoHits).toBe(1);expect(diagnostics.memoMisses).toBe(2);
        }finally{runtime.dispose();}
    }
});
it('retains the imported multi-run fixture on every backend',()=>{
    const fixture=new URL('../../../demos/euler/466_distinctproducts_test.ra',import.meta.url);
    for(const options of backends) {
        const results:{passed:boolean}[]=[];
        const runtime=new Interpreter(()=>{}, {...options,testing:true,sourceId:fixture.pathname,
            loadModule(specifier){expect(specifier).toBe('466_distinctproducts');return{id:new URL('466_distinctproducts.ra',fixture).pathname,source};},
            onTestResult: result=>results.push(result)});
        try{runtime.execute(readFileSync(fixture,'utf8'));expect(results.map(x=>x.passed)).toEqual([true,true]);}
        finally{runtime.dispose();}
    }
});
it('preserves the full answer in both engines and in the swapped table',()=>{
    for(const options of [{},{compilation:false}]) {
        const result=solve(64,10000000000000000n,options);
        expect(result.answer).toBe(258381958195474745n);
        expect(result.diagnostics.memoHits).toBeGreaterThanOrEqual(20);
        expect(result.diagnostics.memoMisses).toBeLessThan(64);
    }
    expect(solve(10000000000000000n,64).answer).toBe(258381958195474745n);
},120000);
