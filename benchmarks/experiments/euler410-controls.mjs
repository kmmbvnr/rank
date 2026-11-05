import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Replay the pre-change compiler without editing the current generated files.
// A prepared control JSON supports isolated snapshots without git metadata.
if (process.env.RANK410_BASELINE === '1') {
    const root = new URL('../../', import.meta.url);
    const modules = ['integer-array-kernel', 'integer-loop-expressions', 'integer-loop-header',
        'integer-loop-plan', 'integer-loop-state', 'integer-loop-statements', 'integer-loop-writes',
        'integer-loop', 'number-arithmetic', 'number-loop-runtime', 'number-loop-scatter', 'number-loop-slice',
        'compiled-callee', 'integer-loop-wide', 'scalar-function-kernel', 'scalar-function-proof']
        .map(name => `jit/${name}`);
    modules.push('fast-paths', 'function-invocation');
    const base = process.env.RANK410_BASE ?? '7f1c799c';
    if (!/^[a-f0-9]{7,40}$/i.test(base)) throw new Error('Invalid control commit');
    const prepared = process.env.RANK410_CONTROL;
    const ts = prepared ? undefined : (await import('typescript')).default;
    const sources = prepared ? JSON.parse(readFileSync(prepared, 'utf8')).sources
        : Object.fromEntries(modules.map(name => {
            const path = `packages/interpreter/src/${name}.ts`;
            const source = execFileSync('git', ['show', `${base}:${path}`], { cwd: root, encoding: 'utf8' });
            return [path.replace('/src/', '/out/').replace(/\.ts$/, '.js'), ts.transpileModule(source, {
                compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
            }).outputText];
        }));
    registerHooks({ load(url, context, next) {
        const result = next(url, context);
        const path = Object.keys(sources).find(path => url.endsWith(`/${path}`));
        return path ? { ...result, source: sources[path] } : result;
    } });
}
