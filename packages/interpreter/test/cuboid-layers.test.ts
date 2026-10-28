import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';

const limit = 200;
const source = readFileSync(new URL('../../../demos/euler/126_cuboidlayers.ra',import.meta.url),'utf8')
    .replace('arg Num integer = 1000','Num = 10')
    .replace('arg Limit integer = 20000',`Limit = ${limit}`);
// Check the complete tally, including duplicates, against the direct formula.
const expected: bigint[] = Array(limit+1).fill(0n);
for (let a=1; 6*a*a<=limit; a++) for (let b=a; 2*(2*a*b+b*b)<=limit; b++)
    for (let c=b; 2*(a*b+b*c+c*a)<=limit; c++) for (let n=1; ; n++) {
        const value=2*(a*b+b*c+c*a)+4*(n-1)*(a+b+c+n-2);
        if (value>limit) break;
        expected[value]++;
    }
for (const compilation of [false,true]) it(`matches every cuboid layer frequency (compiled=${compilation})`, () => {
    const runtime=new Interpreter(()=>{}, {compilation});
    try {
        runtime.execute(source);
        const counts=runtime.variables.get('Cnt') as RankArray;
        expect(expected.map((_,i)=>readArrayItem(counts,i))).toEqual(expected);
        expect(runtime.variables.get('Answer')).toBe(154n);
    } finally { runtime.dispose(); }
});
