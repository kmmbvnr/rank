// Freeze the production baseline, without retaining TypeScript's heap in the
// timed process. Shared unchanged modules still come from the current build.
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
const build = `
import {execFileSync} from 'node:child_process';
import {transpileModule, ModuleKind, ScriptTarget} from 'typescript';
const names=['eval/assignments','jit/number-loop-slice','modules/numbers'];
console.log(JSON.stringify(names.map(name=>[name,transpileModule(
 execFileSync('git',['show','4a7cb2ae:packages/interpreter/src/'+name+'.ts'],{encoding:'utf8'}),
 {compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText])));
`;
const modules=new Map(JSON.parse(execFileSync(process.execPath,['--input-type=module','--eval',build],{encoding:'utf8'})));
registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);for(const [name,source] of modules)if(url.endsWith(`/packages/interpreter/out/${name}.js`))return {...result,source};return result;}});
