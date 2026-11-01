import {cpSync,mkdirSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const destination='/tmp/rank304-before';mkdirSync(destination,{recursive:true});
cpSync('packages/interpreter/out',`${destination}/out`,{recursive:true});
if(!existsSync(`${destination}/node_modules`))symlinkSync(`${process.cwd()}/node_modules`,`${destination}/node_modules`);
writeFileSync(`${destination}/package.json`,'{"type":"module"}\n');
for(const file of ['runtime/prime-sieve','runtime/prime-sequence']){
 const source=execFileSync('git',['show',`51362d77:packages/interpreter/src/${file}.ts`],{encoding:'utf8'});
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 writeFileSync(`${destination}/out/${file}.js`,output);
}
console.log(`${destination}/out/index.js`);
