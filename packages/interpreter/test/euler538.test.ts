import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {Interpreter, isRankArray, type InterpreterOptions} from '../src/index.js';
import {readArrayItem} from '../src/array-storage.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/538_maxquadrilaterals.ra', import.meta.url), 'utf8');
// Publish only the observation needed by the independent prefix oracle.
const observed = source.replace('Answer = 0\nif', 'Snapshot = tuple (array 0) (array 0) 0\nAnswer = 0\nif')
    .replace('end\nreturn Answer', '  Snapshot = tuple Times Perimeters Best\nend\nreturn Answer');
const bits = (n: number) => [...n.toString(2)].filter(digit => digit === '1').length;
function brute(limit: number) {
    const terms: bigint[] = [], best: bigint[] = []; let area = 0n, perimeter = 0n, sum = 0n;
    for (let n = 1; n <= limit; n++) {
        const side = BigInt(2 ** bits(3*n) + 3 ** bits(2*n) + bits(n+1));
        // Every newly available quartet contains the new side; no sorting
        // or consecutive-window theorem is used by this independent oracle.
        for (let i = 0; i < terms.length; i++) for (let j = i+1; j < terms.length; j++) for (let k = j+1; k < terms.length; k++) {
            const sides = [side, terms[i], terms[j], terms[k]], total = sides.reduce((a,b)=>a+b,0n);
            if (sides.some(s => 2n*s >= total)) continue;
            const candidate = sides.reduce((product,s)=>product*(total-2n*s),1n);
            if (candidate > area || candidate === area && total > perimeter) {area=candidate;perimeter=total;}
        }
        terms.push(side);best.push(perimeter);sum += perimeter;
    }
    return {best, sum};
}
const small = brute(35);
const modes = [{name:'Number',options:{}}, {name:'exact',options:{numberLoopCompilation:false}}, {name:'reference',options:{compilation:false}}];
function execute(n:number, options:InterpreterOptions, check:(runtime:Interpreter)=>void) {
    const runtime = new Interpreter(()=>{}, {...options,args:[`--n=${n}`]});
    try {runtime.execute(observed);check(runtime);} finally {runtime.dispose();}
}
describe.each(modes)('Euler 538 $name', ({options})=>{
    it.each([0,1,2,3,4,5,10,20,35])('matches exhaustive distinct-position quadrilaterals through %s', n=>{
        execute(n,options,r=>{
            expect(answerOf(r)).toBe(small.best.slice(0,n).reduce((a,b)=>a+b,0n));
            if(n<4)return;
            const snapshot=r.variables.get('Snapshot');
            if(!snapshot||typeof snapshot!=='object'||snapshot.kind!=='tuple')throw Error('missing snapshot');
            const [times,perimeters]=snapshot.items;
            if(!times||!perimeters||!isRankArray(times)||!isRankArray(perimeters))throw Error('missing event arrays');
            let event=0;
            for(let prefix=1;prefix<=n;prefix++){
                while(event+1<times.shape[0] && (readArrayItem(times,event+1) as bigint) <= BigInt(prefix))event++;
                expect(readArrayItem(perimeters,event)).toBe(small.best[prefix-1]);
            }
        });
    });
    it.each([[120,138648n],[150,234761n],[3000,397768273n]])('matches the prefix sum at %s', (n,total)=>{
        execute(n,options,r=>expect(answerOf(r)).toBe(total));
    });
    it('matches the full exact result',()=>{
        execute(3000000,options,r=>{
            expect(answerOf(r)).toBe(22472871503401097n);
            const snapshot=r.variables.get('Snapshot');
            if(!snapshot||typeof snapshot!=='object'||snapshot.kind!=='tuple')throw Error('missing snapshot');
            expect(typeof snapshot.items[2]).toBe('bigint');
            expect(snapshot.items[2] as bigint).toBeGreaterThan(2n**63n);
        });
    },60000);
});
