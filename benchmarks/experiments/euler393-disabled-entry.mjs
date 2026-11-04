// Research only: immutable disabled capabilities need no scalar selector.
// Definitions made under inspection must still support later compiled calls.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const needle = 'scalarEntrySelector(statement, context, generator, arity) {';
registerHooks({load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/out/function-invocation.js')) return result;
    const source = String(result.source);
    assert.equal(source.split(needle).length, 2, 'entry selector source changed');
    return {...result, source: source.replace(needle, needle +
        '\nif (!inspectionEnabled() && !this.compiler.scalars.entries) return () => undefined;')};
}});
