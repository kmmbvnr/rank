// Research only: resolve the actual write scope before using the existing
// scalar writer cache. A loop block may write an enclosing or global binding.
// Keep the existing constant, plan, value-type and frame-store checks.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
let patched = false;
registerHooks({load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.endsWith('/packages/interpreter/out/binding-environment.js')) return result;
    let source = String(result.source);
    const start = source.indexOf('    compileAssign(name) {');
    const end = source.indexOf('    /** Protection belongs', start);
    assert(start >= 0 && end > start);
    let body = source.slice(start, end);
    // The delivery incorporates this repair; retain the historical control
    // while allowing verification on a build that already has it.
    if (body.includes('const frame = scope === this.globals ? undefined : scope;')) {
        patched = true;
        return result;
    }
    const before = 'if (this.isConstant(name, this.assignmentScope(name)))';
    assert.equal(body.split(before).length, 2);
    assert.equal(body.split('const frame = this.current;').length, 2);
    body = body.replace(before, 'const scope = this.assignmentScope(name);\n            if (this.isConstant(name, scope))')
        .replace('const frame = this.current;', 'const frame = scope === this.globals ? undefined : scope;');
    source = source.slice(0, start) + body + source.slice(end);
    patched = true;
    return {...result, source};
}});
process.on('exit', code => { if (!code && !patched) { console.error('Research binding patch not loaded'); process.exitCode = 1; } });
