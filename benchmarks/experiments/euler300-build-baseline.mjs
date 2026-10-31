// Build the current project first; restore the only modified loop backend module
// from the investigation base into an isolated copy. The new optional frontend
// substitution hook is unused by that restored module.
import {cpSync,mkdirSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import ts from 'typescript';
const destination=resolve(process.argv[2]??'/tmp/rank300-before');
if(destination===process.cwd()||!destination.startsWith('/private/tmp/')&&!destination.startsWith('/tmp/'))throw Error('Use an isolated /tmp destination');
mkdirSync(destination,{recursive:true});cpSync('packages/interpreter/out',destination+'/out',{recursive:true});
writeFileSync(destination+'/package.json','{"type":"module"}\n');
if(!existsSync(destination+'/node_modules'))symlinkSync(resolve('node_modules'),destination+'/node_modules');
const source=execFileSync('git',['show','89931868:packages/interpreter/src/jit/integer-loop-expressions.ts'],{encoding:'utf8'});
writeFileSync(destination+'/out/jit/integer-loop-expressions.js',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
console.log(destination+'/out/index.js');
