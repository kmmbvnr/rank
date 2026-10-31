import {registerHooks} from 'node:module';
// Research only: conservatively reject writes through exact-region aliases.
registerHooks({load(url,context,nextLoad){
 const result=nextLoad(url,context);if(!url.endsWith('/out/jit/integer-loop.js'))return result;
 const source=String(result.source),anchor=': destinations.has(source)))';
 if(!source.includes(anchor))throw new Error('Alias guard anchor changed');
 return {...result,source:source.replace(anchor,': writable.has(target) || writable.has(source)))')};
}});
