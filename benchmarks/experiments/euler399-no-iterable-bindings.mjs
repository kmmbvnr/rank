// Control: keep named finite recipes on the original fallback path.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
 const result=next(url,context);
 if(!url.endsWith('/out/jit/scalar-function-proof.js'))return result;
 const source=String(result.source),needle='const iterable = loopIterable(command.value, env);';
 assert.equal(source.split(needle).length,2);
 return {...result,source:source.replace(needle,'const iterable = undefined;')};
}});
