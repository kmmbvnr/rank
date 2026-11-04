import {registerHooks} from 'node:module';
// Research only: a copied progression already produces fresh private storage.
registerHooks({load(url, context, next) {
 const result=next(url,context);
 if(!url.endsWith('/out/jit/integer-loop-expressions.js')) return result;
 const needle='function emitNumberArray(source, lines) {';
 const patch=`function emitNumberArray(source, lines) {
        let copied = source;
        while (isParenthesizedExpression(copied)) copied = copied.value;
        if (host.nativeCalls && isApplicationExpression(copied) && copied.arguments.length === 1
            && isNameExpression(copied.arguments[0]) && copied.arguments[0].name === 'copy'
            && !localTypes.has('copy') && !arrays.has('copy') && !containers.has('copy')) {
            let range = copied.head;
            while (isParenthesizedExpression(range)) range = range.value;
            if (isBinaryExpression(range) && ['to', 'till'].includes(range.operator)) {
                builtins.set('copy', 'sequences');
                return emitNumberArray(range, lines);
            }
        }`;
 const s=String(result.source);
 if(s.includes('if (wide && !state.numberMode'))throw Error('Historical Euler 404 prototype requires research base be4dce18');
 if(s.split(needle).length!==2)throw Error('prototype target changed');
 return {...result,source:s.replace(needle,patch).replace('function vectorOperation(e) {', `function vectorOperation(e) {
        if (isApplicationExpression(e)) {
            e = groupedUnaryDyadicChain(e, name => !localTypes.has(name) && !arrays.has(name) && !containers.has(name)) ?? e;
        }`).replace('return emit(e, body);', 'return point.module ? emitBuiltinCall(findOperation(point.name), compiledCallSignatures(findOperation(point.name))[0], point.operands, body) : emit(e, body);').replace("from '@arrrank/language';", "from '@arrrank/language';\nimport {groupedUnaryDyadicChain} from '@arrrank/language';")};
}});
