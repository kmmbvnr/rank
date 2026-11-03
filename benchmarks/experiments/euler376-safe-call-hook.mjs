import assert from 'node:assert/strict';
import{registerHooks}from'node:module';
let patched=0;
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/out/jit/number-loop-runtime.js'))return result;const source=String(result.source),needle='reboundInputs && (plan.calls.length > 0 || plan.wideScalars.size > 0';assert.ok(source.includes(needle));patched++;return{...result,source:source.replace(needle,'reboundInputs && (plan.calls.some(call => !call.privateIndexSafe) || plan.wideScalars.size > 0')};}});
process.on('exit',()=>assert.equal(patched,1));
