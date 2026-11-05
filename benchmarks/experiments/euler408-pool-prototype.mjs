import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/out/jit/number-loop-runtime.js'))return result;let source=String(result.source);
if(source.includes('const capacity = previous'))throw Error('Historical Euler 408 pool prototype requires research base fbc76219');
const needle='const buffer = { cells: real ? new Float64Array(size) : new Int32Array(size) };';
if(source.split(needle).length!==2)throw Error('vector pool target changed');
source=source.replace(needle,`const capacity = size > 0 && size <= 1048576 ? 2 ** Math.ceil(Math.log2(size)) : size;
 const buffer = { cells: real ? new Float64Array(capacity) : new Int32Array(capacity) };`);
return {...result,source};}});
