// Research only: widen outputs not read inside the compiled region.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
 const result=next(url,context);
 if(!url.endsWith('/out/jit/integer-loop-wide.js'))return result;
 const source=String(result.source),needle='return new Set([...candidates].filter(name =>';
 assert(source.includes(needle));
 return {...result,source:source.replace(needle,"const reads = new Set(nodes.filter(isNameExpression).map(node => node.name));\nreturn new Set([...candidates].filter(name => !reads.has(name) &&")};
}});
