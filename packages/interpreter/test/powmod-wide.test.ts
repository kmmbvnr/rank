import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { integer32Cells, ownedArray, readArrayItem } from '../src/array-storage.js';
import { safeIntegerModularPower } from '../src/modular-power.js';
import { modularPower } from '../src/primality.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

it('matches exact powers throughout the signed-31-bit residue domain',()=>{
    for(const m of [2**30+1,2000000011,2**31-1,2**31]) {
        for(const b of [0,1,m-1,m,m+1,-1,-m-1,Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER]) {
            for(const e of [0,1,2,31,32,2**31-1,2**32-1,2**32,2**32+1,Number.MAX_SAFE_INTEGER])
                expect(safeIntegerModularPower(b,e,m)).toBe(Number(modularPower(BigInt(b),BigInt(e),BigInt(m))));
        }
    }
    let state=487;
    const next=()=>state=(Math.imul(state,1664525)+1013904223)>>>0;
    for(let i=0;i<4096;i++) {
        const m=2**30+1+next()%(2**30),b=next()-2**31,e=next();
        expect(safeIntegerModularPower(b,e,m)).toBe(Number(modularPower(BigInt(b),BigInt(e),BigInt(m))));
    }
    // Entering the wider path must not corrupt the old squaring cache.
    for(const m of [7,2000000011,7,2**31,7]) for(const e of [123,124])
        expect(safeIntegerModularPower(3,e,m)).toBe(Number(modularPower(3n,BigInt(e),BigInt(m))));
});
it.each([2**30+1,2000000011,2**31-1,2**31])('packs wide-modulus powers, remainders and broadcast operands: %s',m=>{
    const r=new Interpreter(()=>{});
    try {
        const inputs=Array.from({length:1031},(_,i)=>BigInt(i<1024?i:i-1028));
        r.variables.set('Input',ownedArray(inputs));
        for(const exponent of [0n,10000n,4294967295n,4294967296n]) {
            const result=r.execute(`use numbers\nInput ${exponent} ${m} powmod`) as RankArray;
            expect(integer32Cells(result)).toBeDefined();
            expect(Array.from({length:inputs.length},(_,i)=>readArrayItem(result,i)))
                .toEqual(inputs.map(x=>modularPower(x,exponent,BigInt(m))));
        }
        r.variables.set('Bases',ownedArray([1n,-3n,2n**53n-1n],[3,1]));
        r.variables.set('Exponents',ownedArray([0n,7n,2n**40n]));
        const out=r.execute(`Bases Exponents ${m} powmod`) as RankArray;
        expect(out.shape).toEqual([3,3]);
        expect(Array.from({length:9},(_,i)=>readArrayItem(out,i))).toEqual(
            [1n,-3n,2n**53n-1n].flatMap(b=>[0n,7n,2n**40n].map(e=>modularPower(b,e,BigInt(m)))));
    } finally {r.dispose();}
});
it('admits wide powmod helpers into the Number function compiler',()=>{
    const r=new Interpreter(()=>{}, {scalarEntryCompilation:false}),d=new RuntimeDiagnostics();
    try {
        d.run(()=>r.execute(`use numbers
fun Base Exponent raised Mod
 return Base Exponent Mod powmod
end
Total = 0
for I in 1 to 3
 Total += I 4294967297 raised 2000000011
end`));
        expect(d.numberFunctions).toBeGreaterThan(0);
        const sum=[1n,2n,3n].reduce((a,b)=>a+modularPower(b,4294967297n,2000000011n),0n);
        expect(r.variables.get('Total')).toBe(sum);
    } finally {r.dispose();}
});
it('retains wide fallback, errors, budgets and opaque cancellation',()=>{
    const observe=(compilation:boolean,budget:number)=>{
        const r=new Interpreter(()=>{}, {compilation,scalarEntryCompilation:false});
        try {
            r.execute(`use numbers
fun Base Exponent raised Mod
 return Base Exponent Mod powmod
end
Counter = 0
Total = 0
2 10000 raised 2000000011`);
            let error:string|undefined;
            try {withDemandBudget(budget,()=>r.execute(`for I in 1 to 3
 Counter += 1
 Total += I 10000 raised 2000000011
end`));}
            catch(x) {error=(x as Error).constructor.name;}
            return {error,counter:r.variables.get('Counter'),total:r.variables.get('Total')};
        } finally {r.dispose();}
    };
    for(const budget of [5120,20000,40000,1000000]) expect(observe(true,budget)).toEqual(observe(false,budget));

    for(const compilation of [false,true]) {
        const r=new Interpreter(()=>{}, {compilation});
        try {
            r.execute('use numbers\nuse sequences\nInput = (0 to 127) copy');
            for(const m of [2147483649n,2n**70n+13n]) {
                const out=r.execute(`Input 33 ${m} powmod`) as RankArray;
                expect(Array.from({length:128},(_,i)=>readArrayItem(out,i))).toEqual(
                    Array.from({length:128},(_,i)=>modularPower(BigInt(i),33n,m)));
            }
            expect(()=>r.execute('Bad = Input (-1) 2000000011 powmod')).toThrow('exponent must be nonnegative');
            expect(()=>r.execute('2 10 0 powmod')).toThrow('modulus must be positive');
            expect(()=>withDemandBudget(100,()=>r.execute('Answer = Input 10000 2000000011 powmod'))).toThrow();
            expect(r.variables.has('Answer')).toBe(false);
            let polls=0;
            expect(()=>withInterrupt({length:1,load:()=>0,store(){},wait(){},exchange:()=>++polls>1?1:0},
                ()=>r.execute('Answer = Input 10000 2000000011 powmod'))).toThrow('Interrupted');
            expect(r.variables.has('Answer')).toBe(false);
        } finally {r.dispose();}
    }
});
