import {cpSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,existsSync}from'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const config=ts.getParsedCommandLineOfConfigFile('packages/interpreter/tsconfig.json',{},ts.sys);
if(!config)throw Error('TypeScript configuration');
for(const phase of ['baseline','contract']){const dest=`/tmp/rank305-${phase}`;mkdirSync(dest,{recursive:true});cpSync('packages/interpreter/out',`${dest}/out`,{recursive:true});if(!existsSync(`${dest}/node_modules`))symlinkSync(process.cwd()+'/node_modules',`${dest}/node_modules`);writeFileSync(`${dest}/package.json`,'{"type":"module"}');
for(const file of ['record-contract','return-contract']){
const source=execFileSync('git',['show',`2a43b3bd:packages/interpreter/src/${file}.ts`],{encoding:'utf8'});
writeFileSync(`${dest}/out/${file}.js`,ts.transpileModule(source,{compilerOptions:{...config.options,module:ts.ModuleKind.ES2022}}).outputText);
}}

const path='/tmp/rank305-contract/out/record-contract.js';let source=readFileSync(path,'utf8');const old='const fields = value.fieldContracts ?? (value.fieldContracts = new Map());';if(!source.includes(old))throw Error('needle');source=source.replace(old,'if (value.fieldContracts === contract.fields) return;\n    '+old);writeFileSync(path,source);
