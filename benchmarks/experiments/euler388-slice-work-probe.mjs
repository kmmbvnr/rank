// Research only: count slice work in a bounded prefix of a packed vector.
import {registerHooks} from 'node:module';
let replacements=0;
registerHooks({load(url,context,next){const result=next(url,context);if(url.endsWith('/jit/vector-entry-work.js')){
 let source=String(result.source);
 const old=source;
 source=source.replace('const ordinals = escapes || cells.length === 1 ? [0] : [0, cells.length - 1];',
 'const ordinals = escapes ? [0] : [...new Set([0, Math.min(1, cells.length - 1), cells.length - 1])];');
 source=source.replace('else if (isBreakStatement(statement))',`else if (isArrayAssignmentStatement(statement)) {
 const selection = statement.indices.at(-1)?.value;
 const count = selection ? expressionFacts(selection, lookup).shape?.[0] : undefined;
 if (count !== undefined && count !== null && Number.isSafeInteger(count)) work += Math.min(count, target - work);
 } else if (isBreakStatement(statement))`);
 if(source===old || !source.includes('const selection = statement.indices'))throw new Error('work probe patch failed');
 replacements++;return {...result,source};}return result;}});
process.on('exit',()=>{if(replacements!==1)throw new Error(`expected one patched module, got ${replacements}`);});
