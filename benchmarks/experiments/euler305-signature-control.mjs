import {writeFileSync} from 'node:fs';
const before=await import('/tmp/rank305-before/out/index.js'),after=await import('../../packages/interpreter/out/index.js');
const oldKey=(await import('/tmp/rank305-before/out/return-contract.js')).argumentSignature;
const newKey=(await import('../../packages/interpreter/out/return-contract.js')).argumentSignature;
const source='R = record\n'+Array.from({length:16},(_,i)=>` .field${i} = array 1 2 3`).join('\n')+'\nend';
const runtimes=[new before.Interpreter(()=>{}),new after.Interpreter(()=>{})];
try{
 runtimes.forEach(r=>r.execute(source));const values=runtimes.map(r=>[r.variables.get('R')]),functions=[oldKey,newKey];
 const expected=oldKey(values[0]);if(newKey(values[1])!==expected)throw Error('signature mismatch');
 for(let i=0;i<1000;i++)functions.forEach((fn,k)=>fn(values[k]));
 const records=[];for(let round=0;round<5;round++)for(const k of round%2?[1,0]:[0,1]){const cpu=process.cpuUsage(),t=performance.now();for(let i=0;i<10000;i++)if(functions[k](values[k])!==expected)throw Error('signature changed');const usage=process.cpuUsage(cpu);records.push({round,phase:k?'after':'before',ms:performance.now()-t,cpuMs:(usage.user+usage.system)/1000});}
 writeFileSync('benchmarks/baselines/2026-11-01-euler305-signature-control.json',JSON.stringify({kind:'same process, separate runtime-owned records; 16 flat integer-array fields; 10000 signatures per block',records},null,2)+'\n');
}finally{runtimes.forEach(r=>r.dispose());}
