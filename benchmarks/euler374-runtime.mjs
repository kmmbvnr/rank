import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const control = process.env.CONTROL || 'production';
let patched = false;
registerHooks({load(url, context, next) {
    const result = next(url, context);
    if (control === 'production' || !url.endsWith('/out/jit/integer-loop-expressions.js')) return result;
    assert.equal(control, 'baseline');
    const source = String(result.source);
    const constant = 'const MAX_SAFE_RESIDUE_MODULUS = Math.floor(Math.sqrt(Number.MAX_SAFE_INTEGER)) + 1;';
    assert.ok(source.includes(constant), 'baseline no longer matches compiler');
    patched = true;
    return {...result, source: source.replace(constant, 'const MAX_SAFE_RESIDUE_MODULUS = Infinity;')};
}});
export const {Interpreter, RuntimeDiagnostics} = await import(new URL(process.env.RUNTIME || '../packages/interpreter/out/index.js', import.meta.url));

export function assertPatched() { if (control === 'baseline') assert.ok(patched); }
export {control};
