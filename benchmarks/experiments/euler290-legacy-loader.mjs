// Restore the pre-change JIT modules in memory. Transpile in a child process:
// retaining TypeScript's compiler heap would bias GC and RSS in timed workloads.
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
const build = `
import {execFileSync} from 'node:child_process';
import {transpileModule, ModuleKind, ScriptTarget} from 'typescript';
const names = ['jit/integer-loop', 'jit/integer-loop-state', 'jit/integer-loop-writes', 'jit/number-loop-runtime'];
console.log(JSON.stringify(names.map(name => {
    const source = execFileSync('git', ['show', '2d1028e1:packages/interpreter/src/' + name + '.ts'], {encoding: 'utf8'});
    return [name, transpileModule(source, {compilerOptions: {module: ModuleKind.ESNext, target: ScriptTarget.ES2022}}).outputText];
})));
`;
const modules = new Map(JSON.parse(execFileSync(process.execPath,
    ['--input-type=module', '--eval', build], {encoding: 'utf8'})));
registerHooks({load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    for (const [name, source] of modules) {
        if (url.endsWith(`/packages/interpreter/out/${name}.js`)) return {...result, source};
    }
    return result;
}});
