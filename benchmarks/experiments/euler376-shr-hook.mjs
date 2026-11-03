import assert from 'node:assert/strict';
import{registerHooks}from'node:module';
let patched=0;
const lowered=[
"if (numberMode && operation.module === 'bits' && operation.name === 'shr') {",
" const arguments_ = [];",
" for (const operand of operands) { const value = emit(operand, lines, 'integer'); if (value?.type !== 'integer') return undefined; const name = `v${state.serial++}`; lines.push(`const ${name} = ${value.code};`); arguments_.push(name); }",
" builtins.set(operation.name, operation.module); const [left, right] = arguments_; const name = `v${state.serial++}`;",
" lines.push(`if (${right} < 0) throw overflow; const ${name} = ${right} > 52 ? (${left} < 0 ? -1 : 0) : Math.floor(${left} / (2 ** ${right}));`);",
" return {code:name,type:'integer'};",
"}",
].join('\n');
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/out/jit/integer-loop-expressions.js'))return result;const source=String(result.source);if(source.includes("numberMode && !wideInput && operation.module === 'bits' && operation.name === 'shr'")){patched++;return result;}const needle="if (numberMode && operation.module === 'bits' && ['band', 'bor', 'bxor', 'bit', 'shl'].includes(operation.name)) {";assert.ok(source.includes(needle));patched++;return{...result,source:source.replace(needle,lowered+'\n'+needle)};}});
process.on('exit',()=>assert.equal(patched,1));
