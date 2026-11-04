// Delivery control: retain the former broad mixed tier, in memory only.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/out/jit/integer-loop.js')) return result;
    const source = String(result.source), needle = 'const outputs = wideLoopOutputs(plan, wide);';
    assert.equal(source.split(needle).length, 2, 'mixed-tier selector changed');
    return {...result, source: source.replace(needle, 'const outputs = new Set();')};
}});
