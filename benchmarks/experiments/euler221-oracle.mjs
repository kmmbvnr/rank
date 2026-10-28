import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {Interpreter} = await import(pathToFileURL(resolve(process.argv[2] ?? 'packages/interpreter/out/index.js')));
const sources = ['original', '../../demos/euler/221_alexandrian.ra', './euler221-stream.ra', './euler221-stream-array.ra', './euler221-eager.ra'];
let checks=0;
for (const limit of [1,2,3,4,5,10,19,31,64,100,127,250]) {
    const expected=[];
    for (let p=1n;p<=BigInt(limit);p++) for(let d=1n;d<=p;d++) {
        if ((p*p+1n)%d===0n) expected.push(p*(p+d)*(p+(p*p+1n)/d));
    }
    expected.sort((a,b)=>a<b?-1:a>b?1:0);
    for(const source of sources) for(const compilation of [false,true]) {
        const text=(source === 'original' ? JSON.parse(readFileSync(new URL('../baselines/2026-10-28-euler221-investigation.json',import.meta.url),'utf8')).originalSource : readFileSync(new URL(source,import.meta.url),'utf8'))
            .replace(/arg Limit integer = \d+/,`arg Limit integer = ${limit}`)
            .replace(/arg N integer = \d+/,`arg N integer = ${expected.length}`);
        const runtime=new Interpreter(()=>{},{compilation});
        try {
            runtime.execute(text);
            assert.equal(runtime.variables.get('Answer'),expected.at(-1));
            const sorted=runtime.variables.get('Sorted');
            assert.deepEqual(Array.from(sorted.items),expected);
            checks++;
        }finally{runtime.dispose();}
    }
}
console.log(JSON.stringify({checks,passed:true,oracle:'direct divisibility over every d <= p; entire sorted output compared'}));
