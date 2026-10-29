import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(resolve(process.env.RUNTIME ?? 'packages/interpreter/out/index.js')));
const [a='4',b='2',mode='compiled',variant='shipping']=process.argv.slice(2);
if (!['original','shipping'].includes(variant)) throw new Error('variant must be original or shipping');
let source=readFileSync(new URL(variant === 'original' ? './experiments/euler594-original.ra' : '../demos/euler/594_rhombustilings.ra', import.meta.url),'utf8').replace('arg A integer = 4',`arg A integer = ${a}`).replace('arg B integer = 2',`arg B integer = ${b}`);
for(const [i,mark] of ['Tv = array','for Cd in','Od = Rv argsort','for Q in','St = 0','Answer ='].entries()) source=source.replace(mark,`"phase${i}" print\n${mark}`);
const expected = new Map([['1,1','8'],['2,1','76'],['3,2','456572'],['4,2','47067598']]);
const d=new RuntimeDiagnostics();const start=performance.now();
const runtime=new Interpreter(line=>console.error(line,Math.round(performance.now()-start)),{compilation:mode==='compiled'});
try{d.run(()=>runtime.execute(source));if(expected.has(`${a},${b}`) && String(runtime.variables.get('Answer')) !== expected.get(`${a},${b}`)) throw new Error('wrong answer');console.log(JSON.stringify({a,b,mode,variant,ms:performance.now()-start,answer:String(runtime.variables.get('Answer')),Nk:String(runtime.variables.get('Nk')),Nw:String(runtime.variables.get('Nw')),rssMiB:process.resourceUsage().maxRSS/1024,diagnostics:d}));}finally{runtime.dispose()}
