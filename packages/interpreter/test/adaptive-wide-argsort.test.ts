import { expect, it } from 'vitest';
import { typedArray, integer32Cells } from '../src/array-storage.js';
import { numericSort } from '../src/numeric-collections.js';
it.each([2,31,511,1023,1024,2049,65535,65536,65537])('keeps exact stable permutations across digit widths at %s cells', size=>{
    const values = Array.from({length:size},(_,i)=>{
        if(i%11===0)return -(1n<<63n);
        if(i%17===0)return (1n<<63n)-1n;
        const value=9007199254740992n+BigInt(((i%127)*7919)%131071)*(1n<<20n)+BigInt(i%3);
        return i%5===0?-value:value;
    });
    const raw=BigInt64Array.from(values),source=typedArray(raw);
    for(const descending of [false,true]) {
        const expected=Array.from({length:size},(_,i)=>i).sort((a,b)=>
            (values[a]<values[b]?(descending?1:-1):values[a]>values[b]?(descending?-1:1):0)||a-b);
        const result=numericSort(source,descending,'indexes')!;
        expect(Array.from(integer32Cells(result.indexes!)!)).toEqual(expected);
        expect(Array.from(raw)).toEqual(values);
    }
});
it('still proves every cell when middle and last fit Int32',()=>{
    const raw=BigInt64Array.from({length:1025},(_,i)=>BigInt(i%7));
    raw[19]=9007199254740993n;raw[23]=9007199254740992n;raw[29]=-2147483649n;
    const expected=Array.from(raw,(_,i)=>i).sort((a,b)=>raw[a]<raw[b]?-1:raw[a]>raw[b]?1:a-b);
    expect(Array.from(integer32Cells(numericSort(typedArray(raw),false,'indexes')!.indexes!)!)).toEqual(expected);
});
