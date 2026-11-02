// Restore only the two changed kernel choices, in memory, for controls.
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
const old=readFileSync(new URL('./experiments/euler644-baseline-order.txt',import.meta.url),'utf8');
registerHooks({load(url,context,next){
 const loaded=next(url,context);if(!url.endsWith('/runtime/axis-order.js'))return loaded;
 let source=String(loaded.source);const a=source.indexOf('function orderRow('),b=source.indexOf('/** Stored buffers',a);
 if(a<0||b<0)throw Error('sort control target changed');
 source=source.slice(0,a)+old+source.slice(b);
 const target='export function scanInt32Axis(op, value, shape, axis) {';
 if(!source.includes(target))throw Error('scan control target changed');
 source=source.replace(target,target+" if(op==='*')return undefined;");
 return {...loaded,source};
}});
