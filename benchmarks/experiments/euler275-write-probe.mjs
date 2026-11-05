import {registerHooks} from 'node:module';
process.on('exit',()=>console.error(JSON.stringify({writeIntegerSelectionCalls:globalThis.rank275SelectionCalls??0})));
registerHooks({load(url,context,nextLoad){const r=nextLoad(url,context);if(!url.endsWith('/runtime/owned-array.js'))return r;const s=String(r.source),a='export function writeIntegerSelection(value, count, offsetAt, operand, operator, linear) {';if(!s.includes(a))throw new Error('Probe anchor changed');return {...r,source:s.replace(a,a+' globalThis.rank275SelectionCalls = (globalThis.rank275SelectionCalls??0)+1;')};}});
