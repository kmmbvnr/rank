// Build first. Restore only the changed compiler and signature modules in an isolated
// runtime; every other runtime module is identical on both sides of the control.
import {cpSync,mkdirSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import ts from 'typescript';
const destination=resolve(process.argv[2]??'/tmp/rank302-before');
if(!destination.startsWith('/tmp/')&&!destination.startsWith('/private/tmp/'))throw Error('Use an isolated /tmp destination');
mkdirSync(destination,{recursive:true});cpSync('packages/interpreter/out',destination+'/out',{recursive:true});
writeFileSync(destination+'/package.json','{"type":"module"}\n');
if(!existsSync(destination+'/node_modules'))symlinkSync(resolve('node_modules'),destination+'/node_modules');
const compilerModules=['fast-paths','jit/scalar-function-proof','jit/scalar-function-kernel'];
const modules=process.argv[3]==='signature-only'?['return-contract']:process.argv[3]==='compiler-only'?compilerModules:[...compilerModules,'return-contract'];
for(const module of modules){
 const source=execFileSync('git',['show',`29f6185b:packages/interpreter/src/${module}.ts`],{encoding:'utf8'});
 writeFileSync(`${destination}/out/${module}.js`,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
}
console.log(destination+'/out/index.js');
