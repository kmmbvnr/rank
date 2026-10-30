// Timing control: roll back only this task's two runtime changes in memory.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,nextLoad){
 const result=nextLoad(url,context);let source=String(result.source);
 if(url.endsWith('/packages/interpreter/out/binding-environment.js')){
  assert(source.includes('const frame = scope === this.globals ? undefined : scope;'));
  source=source.replace('const scope = this.assignmentScope(name);\n            if (this.isConstant(name, scope))','if (this.isConstant(name, this.assignmentScope(name)))').replace('const frame = scope === this.globals ? undefined : scope;','const frame = this.current;');
 }else if(url.endsWith('/packages/interpreter/out/jit/integer-loop-expressions.js')){
  const start=source.indexOf('const code = numberMode');const end=source.indexOf(';',start);assert(start>=0&&end>start);
  source=source.slice(0,start)+'const code = `(${a}) % (${b})`'+source.slice(end);
 }else return result;
 return {...result,source};
}});
