// Experimental admission relaxation, not a production correctness proof.
// Writes stay private; packed read-only cells are checked when loaded.
// Budget, alias and replay contracts still need dedicated regressions.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
    load(url, context, next) {
        const result = next(url, context);
        if (!url.endsWith('/out/jit/number-loop-runtime.js')) return result;
        let source = String(result.source);
        for (const [before, after] of [
            [' && !locations.some(isForStatement)', ''],
            ['&& !plan.destinations.size && info.type',
                '&& !plan.destinations.has(name) && info.type'],
            ['plan.destinations.size > 0 ? (value) => value',
                "plan.destinations.size > 0 ? (value) => typeof value === 'bigint' ? safe(Number(value)) : value"],
        ]) {
            assert.ok(source.includes(before), `outdated probe: ${before}`);
            source = source.replace(before, after);
        }
        return { ...result, source };
    },
});
