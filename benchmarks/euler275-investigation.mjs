import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter as OriginalInterpreter,RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled',n='12',variant='original']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
assert(/^\d+$/.test(n)&&Number(n)>=1&&Number(n)<=18);
assert(['original','instrument','early','early-break','cache','early-break-cache','native-cache','early-break-native-cache','lean','lean-native-cache','shipping'].includes(variant));
let Interpreter=OriginalInterpreter;
assert(!process.env.RUNTIME || process.env.RUNTIME==='uncached');
// Controlled comparison: retain the shipping runtime, restoring only the old
// per-step resolution and the missing FastPaths callback.
if(process.env.RUNTIME==='uncached'){
 const base=new URL('../packages/interpreter/out/',import.meta.url);
 let code=readFileSync(new URL('interpreter.js',base),'utf8');
 assert(code.includes('return this.options === this.referenceOptions ? this.referenceCompiler : this.baseCompiler;'));
 code=code.replace('return this.options === this.referenceOptions ? this.referenceCompiler : this.baseCompiler;', 'return resolveUncachedCompiler(this.options);').replace('compiler: () => this.compiler,','');
 code=`import { resolveCompilerCapabilities as resolveUncachedCompiler } from '${new URL('interpreter-options.js',base)}';\n`+code;
 code=code.replace(/from '([^']+)'/g,(_,path)=>`from '${path.startsWith('.')?new URL(path,base):import.meta.resolve(path)}'`);
 Interpreter=(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).Interpreter;
}
// Research-only snapshot of compiler capabilities. Production must define
// how changes to published options/hooks interact with this cache.
if(variant.includes('native-cache')) {
 const base=new URL('../packages/interpreter/out/',import.meta.url);
 let code=readFileSync(new URL('interpreter.js',base),'utf8');
 if(!code.includes('this.baseCompiler = fixedCompilerCapabilities(this.baseOptions);')){
 code=code.replace('return resolveCompilerCapabilities(this.options);','return this.options === this.referenceOptions ? this.referenceCompiler : this.baseCompiler;').replace('this.referenceOptions = referenceCompilerOptions(this.baseOptions);','this.referenceOptions = referenceCompilerOptions(this.baseOptions);\nthis.referenceCompiler = resolveCompilerCapabilities(this.referenceOptions);\nthis.baseCompiler = resolveCompilerCapabilities(this.baseOptions);').replace('this.fastPaths = new FastPaths({', 'this.fastPaths = new FastPaths({ compiler: () => this.compiler,').replace(/from '([^']+)'/g,(_,path)=>`from '${path.startsWith('.')?new URL(path,base):import.meta.resolve(path)}'`);
 assert(code.includes('this.referenceCompiler = resolveCompilerCapabilities(this.referenceOptions);'));
 assert(code.includes('new FastPaths({ compiler: () => this.compiler,'));
 Interpreter=(await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).Interpreter;
 }
}

let src=readFileSync(new URL('./experiments/euler275-original.ra',import.meta.url),'utf8').replace('arg N integer = 18',`arg N integer = ${n}`);
if(variant.startsWith('early')){
 src=src.replace('  Pd D = C\n  Occ C = 1\n  Ns = Fx D + Cx','  Ns = Fx D + Cx\n  Rm = N - D - 1\n  if Ns abs greater Mc Rm\n    continue\n  end\n  Pd D = C\n  Occ C = 1');
 src=src.replace('  if Ns abs greater Mc Rm\n    Ok = 0\n  end\n','');
}
if(variant.startsWith('early-break'))src=src.replace('          Sy = 0','          Sy = 0\n          break');
if(variant.startsWith('lean')){
 src=src.replace('  Pd D = C\n  Occ C = 1\n','').replace('  Nl = Fl D','  Rm = N - D - 1\n  if Ns abs greater Mc Rm\n    continue\n  end\n  Nl = Fl D');
 src=src.replace('  Ok = 1\n  if Ns abs greater Mc Rm\n    Ok = 0\n  end\n','').replaceAll('    Ok = 0','    continue');
 src=src.replace('  if Ok equal 1 and Rm equal 0','  Pd D = C\n  Occ C = 1\n  if Rm equal 0').replace('  if Ok equal 0\n    Occ C = 0\n    continue\n  end\n','').replace('          Sy = 0','          Sy = 0\n          break');
 src=src.replace('  Fs (D + 1) = Fi D\n','').replace('  Rm = N - D - 1\n  Tr =','  Tr =');
}
if(variant==='shipping')src=readFileSync(new URL('../demos/euler/275_balancedsculptures.ra',import.meta.url),'utf8').replace('arg N integer = 18',`arg N integer = ${n}`);
if(variant==='instrument')src=src.replace('D = 0\nfor','D = 0\nVisits = 0\nLeaves = 0\nPruned = 0\nfor').replace('  C = G (Fi D)','  Visits += 1\n  C = G (Fi D)').replace('      CountA += 1','      Leaves += 1\n      CountA += 1').replace('  if Ok equal 0\n','  if Ok equal 0\n    Pruned += 1\n');
if(variant.startsWith('lean')){assert(!/\bOk\b/.test(src));assert(src.includes('if Ns + Rm * Nr + Tr less 0\n    continue'));assert(src.includes('if Ns + Rm * Nl - Tr greater 0\n    continue'));}
const r=new Interpreter(()=>{}, {compilation:mode==='compiled'}),d=new RuntimeDiagnostics();
if(variant.includes('cache')&&!variant.includes('native-cache')){const cache=new WeakMap();Object.defineProperty(r,'compiler',{get(){const opts=r.options;let c=cache.get(opts);if(!c){c=Object.getOwnPropertyDescriptor(Interpreter.prototype,'compiler').get.call(r);cache.set(opts,c)}return c}})}
if(process.env.DUMP_SOURCE){process.stdout.write(src);process.exit(0)}
const t=performance.now();
try{if(process.env.DIAGNOSTICS)d.run(()=>r.execute(src));else r.execute(src);const expected={6:'18',10:'964',12:'9657',15:'360505',18:'15030564'}[n];if(expected)assert.equal(String(r.variables.get('Answer')),expected);console.log(JSON.stringify({mode,n,variant,runtime:process.env.RUNTIME??'shipping',ms:performance.now()-t,answer:String(r.variables.get('Answer')),rssMiB:process.resourceUsage().maxRSS/1024,...(variant==='instrument'?Object.fromEntries(['Visits','Leaves','Pruned'].map(k=>[k,String(r.variables.get(k))])):{}),...(process.env.DIAGNOSTICS?{diagnostics:d}:{})}));}finally{r.dispose()}
