import {registerHooks} from 'node:module';
// Research only: apply the existing budget to nested ranges as well.
registerHooks({load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.endsWith('/out/jit/number-loop-runtime.js')) return result;
    const source = String(result.source);
    const begin = source.indexOf('const copyAdmission =');
    const end = source.indexOf(';', begin);
    if (begin < 0 || end < begin) throw new Error('Number admission anchor changed');
    return {...result, source: source.slice(0, begin) + 'const copyAdmission = true' + source.slice(end)};
}});
