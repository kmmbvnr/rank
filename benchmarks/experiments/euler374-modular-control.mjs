import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

// Experimental policy: for bounded positive moduli, always use exact imul
// reduction. Larger moduli retain the original safe-product / replay policy.
registerHooks({load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/out/jit/integer-loop-expressions.js')) return result;
    let source = String(result.source);
    const first = "lines.push(`if (Number.isSafeInteger(${full})) { if (${m} === 0) throw ${vectorCellDepth ? 'overflow' : 'zero()'};`);";
    const last = 'lines.push(`} else { ${result} = mulmod(${a}, ${b}, ${m}); }`);';
    assert.ok(source.includes(first) && source.includes(last), 'modular control does not match compiler');
    const lower = process.env.MOD_POLICY === 'large' ? '94906266' : '0';
    source = source.replace(first,
        'lines.push(`if (${m} > ' + lower + ' && ${m} <= 1073741824) { ${result} = mulmod(${a}, ${b}, ${m}); } else {`);\n' + first);
    source = source.replace(last, last + '\nlines.push(`}`);');
    return {...result, source};
}});
