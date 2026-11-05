// Build a baseline-runtime preload snapshot before crossing hosts.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import ts from 'typescript';
const baseline = process.env.RANK411_BASE ?? '4746b95b793587bf1223e2b62e144ac164f0980e';
const sources = {};
for (const file of ['jit/number-loop-runtime', 'jit/integer-loop-expressions', 'diagnostics']) {
    const source = execFileSync('git', ['show', `${baseline}:packages/interpreter/src/${file}.ts`], { encoding: 'utf8' });
    sources[`/packages/interpreter/out/${file}.js`] = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
}
writeFileSync(process.argv[2] ?? '/tmp/rank411-control.json', JSON.stringify(sources));
