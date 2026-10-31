import {registerHooks} from 'node:module';
// Research only: snapshot writable aliases at an exact-region binding.
registerHooks({load(url,context,nextLoad){
 const result=nextLoad(url,context);let source=String(result.source);
 // The shipped exact binder already supplies its own typed alias helper.
 if(source.includes('aliasValue') && (url.endsWith('/out/jit/integer-loop-statements.js') || url.endsWith('/out/jit/integer-loop-runtime.js')))return result;
 if(url.endsWith('/out/jit/integer-loop-statements.js')){
  const a='`const ${completed} = materializeValue(${value});`';
  const b='`const ${completed} = materializeValue(${aliasSlot === undefined ? value : `arrayValues.alias(${value}, ${JSON.stringify(assignment.name)})`});`';
  if(!source.includes(a))throw new Error('Alias binding anchor changed');source=source.replace(a,b);
 }else if(url.endsWith('/out/jit/integer-loop-runtime.js')){
  const a='host.copySlice, host.arrayValues,';
  const b='host.copySlice, {...host.arrayValues, alias: (value, name) => writable.has(name) ? host.arrayValues.copy(value) : value},';
  if(!source.includes(a))throw new Error('Array runtime anchor changed');source=source.replace(a,b);
 }else return result;
 return {...result,source};
}});
