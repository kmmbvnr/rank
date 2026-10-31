// Restore the pre-experiment compiler modules. Transpile in a child so its
// TypeScript heap cannot bias the timed process's GC or memory high-water mark.
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
const build=`
import {execFileSync} from 'node:child_process';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
const names=['jit/integer-loop','jit/integer-loop-state','jit/number-loop-runtime','jit/number-loop-slice'];
console.log(JSON.stringify(names.map(name=>[name,transpileModule(execFileSync('git',['show','220d12bc:packages/interpreter/src/'+name+'.ts'],{encoding:'utf8'}),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText])));
`;
const modules=new Map(JSON.parse(execFileSync(process.execPath,['--input-type=module','--eval',build],{encoding:'utf8'})));
registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);for(const[name,source]of modules)if(url.endsWith(`/packages/interpreter/out/${name}.js`))return {...result,source};return result;}});
