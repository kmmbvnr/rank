import { registerHooks } from 'node:module';

// Same-build controls: select only with the experiment-specific environment flags.
registerHooks({ load(url, context, next) {
    const result = next(url, context);
    const product = url.endsWith('/out/jit/integer-loop-expressions.js') && process.env.RANK408_NO_PRODUCT === '1';
    const pool = url.endsWith('/out/jit/number-loop-runtime.js') && process.env.RANK408_EXACT_POOL === '1';
    if (!product && !pool) return result;
    let source = String(result.source);
    if (product) {
        const needle = "if (isBinaryExpression(e) && e.operator === 'mod' && !e.step) {";
        if (source.split(needle).length !== 2) throw Error('modular vector control target changed');
        source = source.replace(needle, "if (false && isBinaryExpression(e) && e.operator === 'mod' && !e.step) {");
    }
    if (pool) {
        const needle = /const capacity = previous > 0[^;]+;/g;
        if ([...source.matchAll(needle)].length !== 1) throw Error('vector pool control target changed');
        source = source.replace(needle, 'const capacity = size;');
    }
    return source === result.source ? result : { ...result, source };
} });
