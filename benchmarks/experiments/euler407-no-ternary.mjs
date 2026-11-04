import { registerHooks } from 'node:module';

// Same-source control: disable only private ternary vector admission.
registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/out/jit/integer-loop-expressions.js')) return result;
    const needle = 'if (parts.length === 4 && isNameExpression(last)';
    const source = String(result.source);
    if (source.split(needle).length !== 2) throw new Error('Euler 407 control target changed');
    return { ...result, source: source.replace(needle, 'if (false && parts.length === 4 && isNameExpression(last)') };
} });
