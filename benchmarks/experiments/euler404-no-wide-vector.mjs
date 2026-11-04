import {registerHooks} from 'node:module';
// Same runtime and demo; restore only the former wide-vector sum admission.
registerHooks({load(url, context, next) {
 const result=next(url,context);
 if(!url.endsWith('/out/jit/integer-loop-expressions.js'))return result;
 const source=String(result.source);
 const needle='if (wide && !state.numberMode || !host.arrayReads || !arrayType(source))';
 if(source.split(needle).length!==2)throw Error('wide-vector control target changed');
 return {...result,source:source.replace(needle,'if (wide || !host.arrayReads || !arrayType(source))')};
}});
