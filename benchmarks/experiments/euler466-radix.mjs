// Reproduce digit-width and admission controls without changing product source.
// Generated variants live only beside ignored build output.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [rootArg,output,mode,beforeArg]=process.argv.slice(2);
if(!rootArg||!output||!beforeArg||!['widths','random','adaptive','prefix'].includes(mode))
 throw Error('Usage: ROOT OUTPUT widths|random|adaptive|prefix BEFORE_BUILD_ROOT');
const root=resolve(rootArg),before=resolve(beforeArg);
const path=root+'/packages/interpreter/out/runtime/';
const original=readFileSync(before+'/packages/interpreter/out/runtime/numeric-collections.js','utf8');
const start=original.indexOf('function wideIntegerOrder('),end=original.indexOf('\n/** Axis sorting',start);
if(start<0||end<0)throw Error('Expected the frozen 8616ec6b build');
const body=original.slice(start,end);
if(!body.includes('pass < 4'))throw Error('Expected the four-pass baseline');
for(const bits of [8,11,16]) {
 const passes=Math.ceil(32/bits),mask=(1<<bits)-1;
 const modified=body.replace('new Uint32Array(65536)',`new Uint32Array(${1<<bits})`)
  .replace('pass < 4',`pass < ${2*passes}`).replace('pass === 2',`pass === ${passes}`)
  .replace('const shift = (pass & 1) * 16;',`const shift = (pass % ${passes}) * ${bits};`)
  .replaceAll('& 65535',`& ${mask}`);
 writeFileSync(path+`numeric-collections-radix${bits}.js`,original.slice(0,start)+modified+original.slice(end));
}
const {typedArray,integer32Cells}=await import(root+'/packages/interpreter/out/array-storage.js');
const choices=['adaptive','prefix'].includes(mode)?[0,16]:[8,11,16];
const variants=await Promise.all(choices.map(async bits=>({bits,sort:(await import(path+(bits?`numeric-collections-radix${bits}.js`:'numeric-collections.js'))).numericSort})));
const sizes=mode==='widths'?[8,32,128,512,2048,8192,32768,131072]
 :mode==='random'?[512,2048,8192,32768,131072,524288,1048576]:[512,8192,32768,131072,524288];
for(const size of sizes) {
 const cells=BigInt64Array.from({length:size},(_,i)=>mode==='prefix'
  ?i===size-1?9007199254740993n:BigInt(i)
  :BigInt((i*7919)%131071)*(1n<<35n)+9007199254740993n+(mode==='widths'?0n:BigInt(Math.imul(i,0x9e3779b1)>>>0)));
 const value=typedArray(cells);
 const expected=Array.from({length:size},(_,i)=>i).sort((a,b)=>cells[a]<cells[b]?-1:cells[a]>cells[b]?1:a-b);
 for(const variant of variants) {
  const actual=integer32Cells(variant.sort(value,false,'indexes')?.indexes);
  if(!actual||actual.some((x,i)=>x!==expected[i]))throw Error('Wrong sort '+variant.bits);
  for(let i=0;i<3;i++)variant.sort(value,false,'indexes');
 }
 const repeat=Math.max(3,Math.min(512,Math.ceil(250000/size)));
 for(let round=0;round<3;round++)for(let offset=0;offset<variants.length;offset++) {
  const variant=variants[(round+offset)%variants.length],start=performance.now();let checksum=0;
  for(let i=0;i<repeat;i++)checksum+=integer32Cells(variant.sort(value,false,'indexes').indexes)[size-1];
  const ms=performance.now()-start;
  appendFileSync(output,JSON.stringify({size,round,bits:variant.bits,repeat,ms,perSortMs:ms/repeat,checksum})+'\n');
 }
}
