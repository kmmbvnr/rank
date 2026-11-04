// Research only: unchanged snapshots/COW, scan only the span with dirty cells.
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const r=next(url,context);if(url.endsWith('/runtime/owned-array.js')) {
 let source=String(r.source);const begin=source.indexOf('export function writeInteger32Cells('),end=source.indexOf('\nexport function ',begin+1);
 const part=source.slice(begin,end).replace('for (let index = 0; index < dirty.length; index++)', 'const first = dirty.indexOf(1), last = dirty.lastIndexOf(1);\n    for (let index = first; index <= last; index++)').replace('for (let index = 0; index < dirty.length; index++)', 'for (let index = first; index <= last; index++)');
 if(begin<0 || part===source.slice(begin,end))throw new Error('probe source mismatch');
 r.source=source.slice(0,begin)+part+source.slice(end);
 }return r;}});
