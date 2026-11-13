import {readFileSync} from 'node:fs';
import {Interpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',first='1',count='30',variant='delivered']=process.argv.slice(2);
const file = variant === 'delivered' ? '../demos/euler/411_uphillpaths.ra' : './experiments/euler411-original.ra';
let src=readFileSync(new URL(file, import.meta.url),'utf8');
if(variant==='grow' || variant==='combined')src=src.replace('Tl = array shape Len fill 0','Tl = array shape (Len min 1024) fill 0').replace('      Tl Lo = V','      if Lo equal (Tl len)\n        Tl = concat Tl Tl copy\n      end\n      Tl Lo = V');
if(variant==='combined')src=src.replace('  Len = 2 * N', '  if N3 equal 1\n    Tot += T\n    continue\n  end\n  Len = 2 * N');
if(variant==='append')src=src.replace('      Lo = 0\n      Hi = Ln', '      if Ln greater 0\n        if Tl (Ln - 1) at most V\n          Tl Ln = V\n          Ln += 1\n          continue\n        end\n      end\n      Lo = 0\n      Hi = Ln');
if(variant==='three')src=src.replace('  Len = 2 * N', '  if N3 equal 1\n    Tot += T\n    continue\n  end\n  Len = 2 * N');
if(variant==='axis')src=src.replace('  Len = 2 * N', '  if N2 equal 1 or N3 equal 1\n    Tot += T\n    continue\n  end\n  Len = 2 * N');
if(variant==='phases')src=src.replace('  N = K ** Power','  K print\n  N = K ** Power').replace('  Ks = Ks sort','  Len print\n  Ks = Ks sort\n  Len print').replace('  Tot += Ln','  Ln print\n  Tot += Ln');
const start=performance.now(), cpuStart=process.cpuUsage();
const runtime=new Interpreter(s=>{if(variant==='phases') console.error(JSON.stringify({ms:performance.now()-start,text:s}));},{compilation:mode!=='reference',args:[`--first=${first}`,`--count=${count}`,`--power=${process.env.RANK411_POWER ?? '5'}`]});
const d=new RuntimeDiagnostics();
try {d.run(()=>runtime.execute(src)); console.log(JSON.stringify({mode,first,count,variant,ms:performance.now()-start,cpuMs:(()=>{const c=process.cpuUsage(cpuStart);return(c.user+c.system)/1000;})(),rssMiB:process.resourceUsage().maxRSS/1024,answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),d}));}finally{runtime.dispose();}
