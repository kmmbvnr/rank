// Freeze the four changed runtime modules while sharing the remaining build.
import {cpSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
export function copyEuler309Baseline(out){
 cpSync(new URL('../../packages/interpreter/out/',import.meta.url),out,{recursive:true});
 for(const path of ['jit/integer-loop-expressions','jit/number-loop-index','jit/number-loop-runtime','runtime/index-key']){
  const source=execFileSync('git',['show',`241708d2:packages/interpreter/src/${path}.ts`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8'});
  mkdirSync(`${out}/${path.split('/')[0]}`,{recursive:true});
  writeFileSync(`${out}/${path}.js`,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
 }
}
