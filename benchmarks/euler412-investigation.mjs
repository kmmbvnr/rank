import {readFileSync} from 'node:fs';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',m='10000',k='5000',variant='delivered']=process.argv.slice(2);
let src=readFileSync(new URL(variant==='delivered'?'../demos/euler/412_gnomonnumbering.ra':'./experiments/euler412-original.ra',import.meta.url),'utf8');
if(variant==='wilson' || variant==='library' || variant==='direct')src=src.replace('Fact = 1\nfor Lo in 1 to Cells by Chunk',`Tail = Cells greater (P - 1) // 2
if Cells at least P
  Tail = false
end
Start = 1
Last = Cells
if Tail
  Start = Cells + 1
  Last = P - 1
end
Fact = 1
for Lo in Start to Last by Chunk`).replace('Hi = Cells min (Lo + Chunk - 1)','Hi = Last min (Lo + Chunk - 1)').replace('\nFc = array',`\nif Tail
  Fact = P - Fact (P - 2) P powmod
end
Fc = array`);
if(variant==='library' || variant==='native-original' || variant==='direct')src=src.replace(/fun V modprod P[\s\S]*?\nend/,`fun V modprod P
  return V reduce * with 1 mod P
end`).replace(/Fc = array shape \(2 \* M\) fill 1[\s\S]*?\nend/,`Fc = 1 to 2 * M - 1
Fc = Fc scan * with 1 mod P`);
if(variant==='direct')src=src.replace('Part = (Lo to Hi) mod P copy', "Part' = Lo to Hi");
if(process.env.RANK412_SCALAR)src=src.replace(/fun V modprod P[\s\S]*?\nend/,`fun V modprod P
  R = 1
  for T in V
    R = R * T mod P
  end
  return R
end`);
const start=performance.now(),cpu=process.cpuUsage();
const r=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--m=${m}`,`--k=${k}`,`--chunk=${process.env.RANK412_CHUNK??4000000}`]});
const d=new RuntimeDiagnostics();
try{d.run(()=>r.execute(src));const c=process.cpuUsage(cpu);console.log(JSON.stringify({mode,m,k,variant,scalar:!!process.env.RANK412_SCALAR,ms:performance.now()-start,cpuMs:(c.user+c.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((r.variables.get('Answer') ?? r.lastResult)),d}));}finally{r.dispose();}
