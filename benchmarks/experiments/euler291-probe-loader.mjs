// Research only. Preserve the production sources; transpile in a child so
// TypeScript's retained heap does not influence workload GC or peak RSS.
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
const build = `
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const baseline=name=>execFileSync('git',['show','b37b1740:packages/interpreter/src/'+name+'.ts'],{encoding:'utf8'});
import {transpileModule, ModuleKind, ScriptTarget} from 'typescript';
const modules=[['jit/number-loop-slice',transpileModule(baseline('jit/number-loop-slice'),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText]];
function patch(name, before, after){let source=baseline(name);assert(source.includes(before),name);source=source.replace(before,after);modules.push([name,transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText]);}
if(process.env.RANK291_PROBE!=='powmod') patch('eval/assignments',
 'if (count > 0 && host.options().compilation !== false && !inspectionEnabled()\\n            && (statement.operator',
 'if (count > 0 && !inspectionEnabled()\\n            && (statement.operator');
if(process.env.RANK291_PROBE!=='bulk') {
 let source=baseline('modules/numbers');
 source=source.replace("powmod: () => native('powmod', 3, args =>", "powmod: () => withNumberCalls(native('powmod', 3, args =>");
 const before='    ))),\\n    convolve:';
 assert(source.includes(before));
 source=source.replace(before,\`    ))), probePowmodCalls, probePowmodCalls),
    convolve:\`);
 source=source.replace('export const numbersModule', \`const probePowmodCalls = {'integer,integer,integer': (base: number, exponent: number, modulus: number) =>
        exponent >= 0 && modulus > 0 && modulus <= 1073741824
            ? safeIntegerModularPower(base, exponent, modulus)
            : Number(checkedModularPower(BigInt(base), BigInt(exponent), BigInt(modulus))) };
export const numbersModule\`);
 modules.push(['modules/numbers',transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022}}).outputText]);
}
console.log(JSON.stringify(modules));
`;
const modules=new Map(JSON.parse(execFileSync(process.execPath,['--input-type=module','--eval',build],{encoding:'utf8'})));
registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);for(const [name,source] of modules)if(url.endsWith(`/packages/interpreter/out/${name}.js`))return {...result,source};return result;}});
