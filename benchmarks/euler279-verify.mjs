import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../packages/interpreter/out/index.js';

// Independent side enumeration: rational integral angles can only be
// 60, 90 or 120 degrees. Check the cosine-law identities using integers.
const max=300, counts=new Int32Array(max+1);
for(let a=1;a<=Math.floor(max/3);a++)for(let b=a;b<=Math.floor((max-a)/2);b++)
    for(let c=b;c<a+b&&a+b+c<=max;c++) {
        const squares=[a*a,b*b,c*c], pairs=[b*c,a*c,a*b];
        if(squares.some((s,i)=>[0,pairs[i],-pairs[i]].includes(squares[(i+1)%3]+squares[(i+2)%3]-s)))counts[a+b+c]++;
    }
for(let i=1;i<=max;i++)counts[i]+=counts[i-1];
let checks=0;
for(const mode of ['compiled','reference'])for(const variant of ['original','canonical','scalar','ranked','canonical-plans','shipping']) {
    let source=readFileSync(new URL(variant==='shipping'?'../demos/euler/279_integralangle.ra':`./experiments/euler279-${variant}.ra`,import.meta.url),'utf8');
    source=source.replace('arg Limit integer = 100000000','arg Limit integer = 0');
    for(const limit of [...Array.from({length:51},(_,i)=>i),60,90,99,100,101,120,199,200,201,250,300,5000,1000000]) {
        const runtime=new Interpreter(()=>{}, {compilation:mode==='compiled'});
        try {
            runtime.execute(source.replace('arg Limit integer = 0',`arg Limit integer = ${limit}`));
            assert.equal(String(runtime.variables.get('Answer')),String(counts[limit]??({5000:8891,1000000:3055201})[limit]),`${mode}/${variant}/${limit}`);
            checks++;
        } finally {runtime.dispose()}
    }
}
console.log(JSON.stringify({checks,max,oracle:'integer side enumeration and cosine-law identities',answer100:counts[100],answer200:counts[200]}));
