// Control: same program and runtime, prior implicit-arithmetic admission rule.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/out/jit/tensor-kernel.js')) return result;
    const source = String(result.source);
    const needle = "node.native && bitwise(node.native)\n                || !node.native";
    assert.equal(source.split(needle).length, 2);
    return {...result, source: source.replace(needle, 'false\n                || !node.native')};
}});
