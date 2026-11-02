import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {oracle} from './euler328-oracle.mjs';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('../..',import.meta.url));
const {Interpreter}=await import(`${root}/packages/interpreter/out/index.js`);
const limits=[0,1,2,7,8,31,32,99,100,101,102,127,128,255,256,1000];let cases=0;
for(const mode of ['compiled','exact','reference'])for(const variant of ['frontier','compact']){
 const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'});
 try{let source=readFileSync(new URL(`./euler328-${variant}.ra`,import.meta.url),'utf8');r.execute(source.slice(source.indexOf('fun N costs')));
 for(const n of limits){assert.equal(r.execute(`${n} costs`),BigInt(oracle(n).sum),`${mode}/${variant}/${n}`);cases++;}
 // Exercise the conservative fallback even when the table is ordered.
 source=source.replace('  Ordered = true','  Ordered = false');const fallback=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'});try{fallback.execute(source.slice(source.indexOf('fun N costs')));assert.equal(fallback.execute('1000 costs'),3120345n);cases++;}finally{fallback.dispose();}
 }finally{r.dispose()}
}
console.log(JSON.stringify({cases,failures:0}));
