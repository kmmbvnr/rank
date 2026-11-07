import { expect, it } from 'vitest';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/integer-array-kernel.js';

it.each([1, 17, 4097])('widens a completed narrow prefix at cell %s without losing signs', position => {
    const values = Int32Array.from({length: position + 9}, (_, i) => i % 2 ? -i : i);
    values[position] = -2147483648;
    const source = typedArray(values);
    const product = mapStoredIntegers(source, 65537n, '*')!;
    expect(product.shape).toEqual([values.length]);
    const last=readArrayItem(product,values.length-1);
    for (let i=0;i<values.length;i++)expect(readArrayItem(product,i)).toBe(BigInt(values[i])*65537n);
    expect(Array.from(values)).toEqual(Array.from({length:values.length},(_,i)=>i===position?-2147483648:i%2?-i:i));
    source.items[values.length-1]=123n;
    expect(readArrayItem(product,values.length-1)).toBe(last);
});

it.each(['+', '-', '*', '//', 'mod', 'min', 'max', 'gcd'] as const)('preserves exact safe-width arithmetic for %s', operation => {
    const values = [-(2n**53n)+1n,-4294967297n,-2147483649n,-1n,0n,2147483648n,4294967297n,2n**53n-1n];
    const input = typedArray(BigInt64Array.from(values));
    const divisor = 3n;
    const gcd=(a:bigint,b:bigint):bigint=>{a=a<0n?-a:a;while(b)[a,b]=[b,a%b];return a;};
    const expected=(x:bigint)=>operation==='+'?x+divisor:operation==='-'?x-divisor:operation==='*'?x*divisor
        :operation==='mod'?(x%divisor+divisor)%divisor:operation==='//'?(x-(x%divisor+divisor)%divisor)/divisor
        :operation==='min'?(x<divisor?x:divisor):operation==='max'?(x>divisor?x:divisor):gcd(x,divisor);
    const result = mapStoredIntegers(input,divisor,operation)!;
    expect(values.map((_,i)=>readArrayItem(result,i))).toEqual(values.map(expected));
    expect(values.map((_,i)=>readArrayItem(input,i))).toEqual(values);
});

it('keeps broadcasts exact when only a later row widens',()=>{
    const left=typedArray(Int32Array.from([1,-2,2147483647]),[3,1]);
    const right=typedArray(Int32Array.from([1,3,65537]),[1,3]);
    const result=mapStoredIntegers(left,right,'*')!;
    expect(result.shape).toEqual([3,3]);
    expect(Array.from({length:9},(_,i)=>readArrayItem(result,i))).toEqual([1n,-2n,2147483647n].flatMap(a=>[1n,3n,65537n].map(b=>a*b)));
});
