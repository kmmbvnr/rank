// Build current out, then restore the three changed runtime modules in a /tmp
// copy. Every other runtime module is identical between the compared sides.
import {cpSync,mkdirSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {resolve} from 'node:path';import ts from 'typescript';
const destination=resolve(process.argv[2]??'/tmp/rank303-before');
if(!destination.startsWith('/tmp/')&&!destination.startsWith('/private/tmp/'))throw Error('Use an isolated /tmp destination');
mkdirSync(destination,{recursive:true});cpSync('packages/interpreter/out',destination+'/out',{recursive:true});writeFileSync(destination+'/package.json','{"type":"module"}\n');
if(!existsSync(destination+'/node_modules'))symlinkSync(resolve('node_modules'),destination+'/node_modules');
for(const module of ['jit/scalar-function-kernel','function-invocation','diagnostics']){
 const source=execFileSync('git',['show',`47cdf712:packages/interpreter/src/${module}.ts`],{encoding:'utf8'});
 writeFileSync(`${destination}/out/${module}.js`,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
}
console.log(destination+'/out/index.js');
