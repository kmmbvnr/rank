import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('..', import.meta.url));
const {Interpreter,RuntimeDiagnostics}=await import(`${root}/packages/interpreter/out/index.js`);
let [mode='compiled',top='2011',variant='original']=process.argv.slice(2);
if (!['compiled','reference','exact'].includes(mode) || !['original','bounded','break','stable','bounded-stable','production'].includes(variant) || !/^\d+$/.test(top)) throw Error('mode top variant');
let s=readFileSync(variant==='production' ? new URL('../demos/euler/318_nines.ra',import.meta.url) : new URL('./experiments/euler318-original.ra',import.meta.url),'utf8').replace('arg Top integer = 2011',`arg Top integer = ${top}`);
if(variant==='bounded')s=s.replace('for Q in P + 1 to Top - P','End = (Top - P) min (P + 1 + ((4 * P) isqrt))\n  for Q in P + 1 to End');
if(variant==='stable')s=s.replace('Beta = (Q sqrt) - (P sqrt)','Beta = (Q - P) / ((Q sqrt) + (P sqrt))');
if(variant==='bounded-stable')s=s.replace('for Q in P + 1 to Top - P','End = (Top - P) min (P + 1 + ((4 * P) isqrt))\n  for Q in P + 1 to End').replace('Beta = (Q sqrt) - (P sqrt)','Beta = (Q - P) / ((Q sqrt) + (P sqrt))');
if(variant==='break')s=s.replace('if Beta less 1.0', 'if not (Beta less 1.0)\n      break\n    end\n    if Beta less 1.0');
const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'}),d=new RuntimeDiagnostics();r.execute('');let t=performance.now();
try{if(process.env.DIAGNOSTICS)d.run(()=>r.execute(s));else r.execute(s);console.log(JSON.stringify({mode,top,variant,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(r.variables.get('Answer')),...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));}finally{r.dispose()}
