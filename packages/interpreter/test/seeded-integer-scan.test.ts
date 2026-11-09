import {describe,expect,it} from 'vitest';
import {Interpreter,RuntimeDiagnostics,isRankArray} from '../src/index.js';
import {typedArray,readArrayItem,integer32Cells} from '../src/array-storage.js';
import {scanInt32Seeded} from '../src/axis-order.js';
import {withDemandBudget,withInterrupt,InterruptedError} from '../src/interrupt.js';

const values=Int32Array.from({length:2048},(_,i)=>[2147483647,1,-2147483647,-1,3,-3][i%6]);
const modes=[false,true];
describe.each(modes)('seeded stored integer scans compilation=%s',compilation=>{
    it.each([0n,1n,-10n,2147483648n,-9007199254740987n,9007199254740987n,9007199254740992n,2n**70n])('matches exact prefixes with seed %s',seed=>{
        const expected=[seed];for(const n of values)expected.push(expected.at(-1)!+BigInt(n));
        const runtime=new Interpreter(undefined,{compilation}),d=new RuntimeDiagnostics();
        try{
            runtime.variables.set('Data',typedArray(values.slice()));runtime.variables.set('Seed',seed);runtime.execute('use sequences');
            const result=d.run(()=>runtime.execute('Data scan + with Seed'));
            if(!result||!isRankArray(result))throw Error('expected prefix array');
            expect(result.shape).toEqual([values.length+1]);
            expect(expected.map((_,i)=>readArrayItem(result,i))).toEqual(expected);
            const safe=expected.every(n=>n>=-9007199254740991n&&n<=9007199254740991n);
            expect(d.storedSeededScans).toBe(safe?1:0);
        }finally{runtime.dispose();}
    });
    it('keeps a zero prefix of unit counts in Int32 storage',()=>{
        const r=new Interpreter(undefined,{compilation});
        try{r.variables.set('Data',typedArray(new Int32Array(4096).fill(1)));r.execute('use sequences');
            const result=r.execute('Data scan + with 0');
            if(!result||!isRankArray(result))throw Error('expected prefixes');
            expect(integer32Cells(result)).toBeDefined();expect(readArrayItem(result,4096)).toBe(4096n);
        }finally{r.dispose();}
    });
});

it('handles empty vectors and retains real seed arithmetic',()=>{
    const r=new Interpreter();
    try{r.execute('use sequences');r.variables.set('Data',typedArray(new Int32Array(0)));
        const empty=r.execute('Data scan + with 7');
        if(!empty||!isRankArray(empty))throw Error('expected seed');
        expect(empty.shape).toEqual([1]);expect(readArrayItem(empty,0)).toBe(7n);
        r.variables.set('Data',typedArray(Int32Array.from([1,2,3])));
        const d=new RuntimeDiagnostics(),real=d.run(()=>r.execute('Data scan + with 0.5'));
        if(!real||!isRankArray(real))throw Error('expected real prefixes');
        expect([0,1,2,3].map(i=>readArrayItem(real,i))).toEqual([0.5,1.5,3.5,6.5]);expect(d.storedSeededScans).toBe(0);
    }finally{r.dispose();}
});
it('keeps input storage unchanged on cancellation and bounded-demand fallback',()=>{
    const cells=new Int32Array(4096).fill(1),before=cells.slice(),source=typedArray(cells);
    expect(withDemandBudget(1,()=>scanInt32Seeded(source,0n))).toBeUndefined();
    expect(()=>withInterrupt(new Int32Array([1]),()=>scanInt32Seeded(source,0n))).toThrow(InterruptedError);
    expect(cells).toEqual(before);
});
