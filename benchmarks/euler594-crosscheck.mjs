import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { Interpreter } = await import(pathToFileURL(resolve(process.env.RUNTIME ?? 'packages/interpreter/out/index.js')));
const root=new URL('../', import.meta.url);
const original=readFileSync(new URL('benchmarks/experiments/euler594-original.ra', root),'utf8');
const shipping=readFileSync(new URL('demos/euler/594_rhombustilings.ra', root),'utf8');
const rows=[];
for(const [a,b] of [[0,0],[0,1],[1,0],[1,1],[2,1],[1,2],[2,2],[3,1],[3,2],[4,2]]) {
 const runtimes=[];
 try {
  for(const source of [original,shipping]) {
   const rt=new Interpreter(()=>{});runtimes.push(rt);
   rt.execute(source.replace('arg A integer = 4',`arg A integer = ${a}`).replace('arg B integer = 2',`arg B integer = ${b}`));
  }
  const [old,cur]=runtimes.map(rt=>rt.variables);
  assert.equal(cur.get('Answer'),old.get('Answer'));
  assert.equal(cur.get('Nw'),old.get('Nw'));
  const codes=old.get('Vc').items, actual=cur.get('Vc').items;
  for(let i=0;i<codes.length;i++) {
   assert.equal(actual[i],codes[i]);
   const at=Number(codes[i]);
   assert.equal(cur.get('Tv').items[at],old.get('Tv').items[at],`DP mismatch A=${a} B=${b} code=${at}`);
  }
  const row={a,b,states:codes.length,answer:String(cur.get('Answer'))};rows.push(row);console.log(row);
 } finally {runtimes.forEach(rt=>rt.dispose())}
}
if (process.env.RESULTS) writeFileSync(process.env.RESULTS,JSON.stringify(rows,null,2)+'\n');
