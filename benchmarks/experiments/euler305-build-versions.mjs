import {cpSync,mkdirSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
for(const phase of ['before','after']){
 const dest=`/tmp/rank305-${phase}`;mkdirSync(dest,{recursive:true});cpSync('packages/interpreter/out',`${dest}/out`,{recursive:true});
 if(!existsSync(`${dest}/node_modules`))symlinkSync(process.cwd()+'/node_modules',`${dest}/node_modules`);writeFileSync(`${dest}/package.json`,'{"type":"module"}');
}
// The old return-contract source is unchanged between 80861730 and 2a43b3bd.
const config=ts.getParsedCommandLineOfConfigFile('packages/interpreter/tsconfig.json',{},ts.sys);
if(!config)throw Error('TypeScript configuration');
for(const file of ['return-contract','record-contract']){
 const source=execFileSync('git',['show',`2a43b3bd:packages/interpreter/src/${file}.ts`],{encoding:'utf8'});
 writeFileSync(`/tmp/rank305-before/out/${file}.js`,ts.transpileModule(source,{compilerOptions:{...config.options,module:ts.ModuleKind.ES2022}}).outputText);
}
