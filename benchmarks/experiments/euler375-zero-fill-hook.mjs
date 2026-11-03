import assert from 'node:assert/strict';
import {registerHooks}from'node:module';
let patched=0;
registerHooks({load(url,ctx,next){const r=next(url,ctx);if(!url.endsWith('/out/jit/number-loop-runtime.js'))return r;
const s=String(r.source),needle='new Int32Array(size).fill(fill)';assert.ok(s.includes(needle));patched++;return{...r,source:s.replaceAll(needle,'(fill === 0 ? new Int32Array(size) : new Int32Array(size).fill(fill))')};}});
process.on('exit',()=>assert.equal(patched,1));
