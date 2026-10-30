import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Independent direct sieve of how many distinct primes below Under divide n.
function oracle(under, limit, least) {
    const counts = new Uint8Array(limit);
    for(let p=2;p<under;p++) {
        let prime=true;
        for(let d=2;d*d<=p;d++) if(p%d===0){prime=false;break;}
        if(prime) for(let n=p;n<limit;n+=p) counts[n]++;
    }
    let total=0;
    for(let n=1;n<limit;n++) if(counts[n]>=least) total++;
    return String(total);
}
const cases = [
    [2,100,1], [3,10,1], [13,1000,2], [14,1000,3],
    [10,500,5], [20,2311,5], [30,100000,4,'3705'],
    [30,1000000,4,'37268'], [30,1000000000000,4,'37351446090'],
    [50,1000000,3,'210062'],
];
for(const [under,limit,least,golden] of cases) {
    const expected=limit<=1000000 ? oracle(under,limit,least) : golden;
    if(golden) assert.equal(expected,golden);
    for(const mode of ['compiled','reference']) for(const variant of (process.env.VARIANTS?.split(',') ?? ['original','eager','sorted-q','sorted-eager','sorted-cached','recursive'])) {
        const d=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./euler268-investigation.mjs',import.meta.url)),mode,variant,String(under),String(limit),String(least)],{encoding:'utf8',timeout:30000}));
        assert.equal(d.answer,expected,JSON.stringify({under,limit,least,mode,variant}));
        console.log(JSON.stringify({under,limit,least,mode,variant,answer:d.answer,oracle:limit<=1000000?'direct sieve':'existing fixture golden'}));
    }
}
