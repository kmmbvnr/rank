import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions, type RankArray, type RankTuple } from '../src/index.js';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { tuple } from '../src/value.js';
const fixture = new URL('../../../demos/euler/486_palindromestrings_test.ra', import.meta.url);
const source = readFileSync(new URL('486_palindromestrings.ra', fixture), 'utf8');
const prefix = source.split('Mods =')[0];
const backends: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
const mod = (x: bigint, m: bigint) => (x % m + m) % m;
function gcd(a: bigint, b: bigint): bigint { while (b) [a,b]=[b,a%b]; return a; }
function inverse(a: bigint,m: bigint): bigint {
    let b=m, x=1n, y=0n;
    while(b) { const q=a/b; [a,b]=[b,a-q*b]; [x,y]=[y,x-q*y]; }
    return mod(x,m);
}
function explicit(a: bigint[],ma: bigint,b: bigint[],mb: bigint,limit: bigint): bigint {
    const g=gcd(ma,mb), width=mb/g, back=inverse(ma/g,width), period=ma*width;
    let count=0n;
    for(const left of a) for(const right of b) if((right-left)%g===0n) {
        const x=left+ma*mod((right-left)/g*back,width);
        if(x<=limit) count+=(limit-x)/period+1n;
    }
    return count;
}
// Actual binary automaton: retain five bits and reject a new palindrome.
function automaton(limit: number) {
    const modulus=87654321n, cumulative=[0n];
    const snapshots=new Map<number,bigint[]>();
    let counts=Array<bigint>(32).fill(0n), power=1n; counts[0]=1n;
    const palindrome=(word: number,width: number) => {
        for(let i=0;i<Math.floor(width/2);i++) if(((word>>i)&1)!==((word>>(width-1-i))&1)) return false;
        return true;
    };
    for(let n=1;n<=limit;n++) {
        const next=Array<bigint>(32).fill(0n);
        for(let state=0;state<32;state++) for(let bit=0;bit<2;bit++) {
            const word=state*2+bit;
            if(n>=5 && palindrome(word&31,5) || n>=6 && palindrome(word,6)) continue;
            next[word&31]+=counts[state];
        }
        counts=next;power=power*2n%modulus;
        if(n===9 || n===15) snapshots.set(n,[...counts]);
        cumulative[n]=mod(cumulative[n-1]+power-counts.reduce((a,b)=>a+b,0n),modulus);
    }
    return { totals:cumulative, snapshots };
}
const { totals, snapshots }=automaton(5000);
for(const options of backends) describe(`Euler 486 ${JSON.stringify(options)}`,()=>{
    it('matches explicit CRT pairs, cyclic boundaries, duplicates and wide integers',()=>{
        const r=new Interpreter(()=>{},options);
        try {
            r.execute(prefix);
            const check=(a:bigint[],ma:bigint,b:bigint[],mb:bigint,limit:bigint)=>{
                r.variables.set('LeftState',tuple([ownedArray(a),ma]));
                r.variables.set('RightState',tuple([ownedArray(b),mb]));
                r.variables.set('Cap',limit);
                expect(r.execute('LeftState count_join RightState Cap')).toBe(explicit(a,ma,b,mb,limit));
            };
            for(let seed=1;seed<=30;seed++) {
                const ma=BigInt(seed%11+1),mb=BigInt(seed%13+1),period=ma*mb/gcd(ma,mb);
                const a=Array.from({length:seed%7},(_,i)=>BigInt(i*i+seed)%ma);
                const b=Array.from({length:seed%9},(_,i)=>BigInt(3*i+seed)%mb);
                for(const limit of [-1n,0n,period-1n,period,period+3n,10n**30n+7n]) check(a,ma,b,mb,limit);
            }
            const wide=2n**70n+3n;
            check([0n,wide-2n],wide,[0n,1n,4n],9n,10n**40n);
        } finally {r.dispose();}
    },30000);
    it('matches the binary automaton modulo all three factors',()=>{
        // Identical states prove that the six-step avoider cycle continues.
        expect(snapshots.get(15)).toEqual(snapshots.get(9));
        expect([totals[4],totals[5],totals[6],totals[11]]).toEqual([0n,8n,42n,3844n]);
        const r=new Interpreter(()=>{},options);
        try {
            r.execute(source);
            for(let table=0;table<3;table++) for(let u=0;u<6;u++) {
                const state=r.execute(`Tables ${table} residues ${u}`) as RankTuple;
                const values=state.items[0] as RankArray,period=state.items[1] as bigint;
                const residues=new Set(Array.from({length:values.shape[0]},(_,i)=>readArrayItem(values,i)));
                const modulus=BigInt([9,1997,4877][table]);
                for(let n=9+u;n<=5000;n+=6) expect(residues.has(BigInt((n-9-u)/6)%period)).toBe(totals[n]%modulus===0n);
            }
            expect(r.variables.get('Answer')).toBe(11408450515n);
        } finally {r.dispose();}
    },30000);
    it('counts the first exact events, full periods and an arbitrary-precision limit',()=>{
        const first = [95440424, 101714738, 204995229, 238948971, 318731749, 373915105, 478919156, 576834685, 604567122, 879562681, 1009360915, 1155177015, 1220169056, 1312942470, 1325507676, 1424736691, 1428145441, 1433492683, 1549519224, 1646490281];
        const r=new Interpreter(()=>{},options);
        try {
            r.execute(source);
            const count=(limit:bigint)=>{ r.variables.set('L',limit); return r.execute('Offsets subtotal rank 0 sum'); };
            for(let i=0;i<first.length;i++) {
                expect(count(BigInt(first[i])-1n)).toBe(BigInt(i));
                expect(count(BigInt(first[i]))).toBe(BigInt(i+1));
                expect(count(BigInt(first[i])+1n)).toBe(BigInt(i+1));
            }
            const period=639821496386412n;
            expect(count(period+BigInt(first[0])-1n)).toBe(7299372n);
            expect(count(period+BigInt(first[0]))).toBe(7299373n);
            expect(count(10000000000000000000000000000000000000123n)).toBe(114084507026185280700537284409048n);
        } finally {r.dispose();}
    },30000);
    it('retains the statement fixture',()=>{
        const results:boolean[]=[];
        const r=new Interpreter(()=>{}, {...options,testing:true,sourceId:fixture.pathname,
            loadModule:()=>({id:new URL('486_palindromestrings.ra',fixture).pathname,source}),
            onTestResult:x=>results.push(x.passed)});
        try {r.execute(readFileSync(fixture,'utf8'));expect(results).toEqual([true]);}
        finally {r.dispose();}
    });
    it.each([0,4,5,8,9,10000000])('has no solution below first known event at %s',limit=>{
        const r=new Interpreter(()=>{}, {...options,args:[`--l=${limit}`]});
        try {r.execute(source);expect(r.variables.get('Answer')).toBe(0n);}
        finally {r.dispose();}
    });
});
