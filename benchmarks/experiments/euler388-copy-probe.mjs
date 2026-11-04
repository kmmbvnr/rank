// Research only: bypass the copy/work cost guard to measure a rejected kernel.
// This is not a proposed global threshold change.
import {registerHooks} from 'node:module';
let replacements=0;
registerHooks({load(url,context,next){const result=next(url,context);if(url.endsWith('/jit/number-loop-runtime.js')){
 const before=String(result.source), after=before.replace('const probe = conditionWriteCells > SMALL_COPY_CELLS;', 'const probe = false;');
 if(after===before)throw new Error('copy-work guard not found');replacements++;
 return {...result,source:after};}return result;}});
process.on('exit',()=>{if(replacements!==1)throw new Error(`expected one patched module, got ${replacements}`);});
