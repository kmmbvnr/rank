// Reproduce the old entry selector on the delivered runtime, in memory only.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const needle = /if \(!inspectionEnabled\(\) && !this.compiler.scalars.entries\)\s+return \(\) => undefined;/g;
registerHooks({load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/out/function-invocation.js')) return result;
    const source = String(result.source);
    assert.equal([...source.matchAll(needle)].length, 1, 'disabled selector guard changed');
    return {...result, source: source.replace(needle, '')};
}});
