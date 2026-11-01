// Isolate retained key storage from Map transaction strategy and runtime dispatch.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const [variant,count='1000000']=process.argv.slice(2);
if(!variant){
 const rows=[];
 for(const name of ['current','flat-only','number-only','combined']){
  const r=spawnSync(process.execPath,['--expose-gc',new URL(import.meta.url).pathname,name,count],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr||String(r.error));const row=JSON.parse(r.stdout);rows.push(row);console.log(JSON.stringify(row));
 }
 writeFileSync(new URL('../baselines/2026-11-01-euler309-key-memory.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
}else{
 assert(['current','flat-only','number-only','combined'].includes(variant));assert(/^\d+$/.test(count));
 const size=Number(count),map=new Map(),cpu=process.cpuUsage(),start=performance.now();
 for(let i=0;i<size;i++){
  const values=[i,i%10];let key;
  if(variant==='current')key=`integers:${values.map(value=>BigInt(value)).join(',')}`;
  else{
   const suffix=values.map(value=>variant==='flat-only'?BigInt(value):value).join(',');
   key=variant==='number-only'?`integers:${suffix}`:['integers:',suffix].join('');
  }
  map.set(key,0);
 }
 const ms=performance.now()-start,u=process.cpuUsage(cpu);global.gc();
 assert.equal(map.size,size);assert.equal(map.get('integers:12345,5'),0);
 const mem=process.memoryUsage();console.log(JSON.stringify({variant,count:size,ms,cpuMs:(u.user+u.system)/1000,heapMiB:mem.heapUsed/1048576,rssMiB:mem.rss/1048576,maxRssMiB:process.resourceUsage().maxRSS/1024}));
}
