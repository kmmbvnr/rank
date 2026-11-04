// Research only: skip entry storage proofs when that compiler tier is disabled.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const needle = 'if (inspectionEnabled() || arguments_.length !== arity)';
registerHooks({load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/out/function-invocation.js')) return result;
    const source = String(result.source);
    assert.equal(source.split(needle).length, 2, 'entry guard source changed');
    return {...result, source: source.replace(needle,
        'if (!this.compiler.scalars.entries || inspectionEnabled() || arguments_.length !== arity)')};
}});
