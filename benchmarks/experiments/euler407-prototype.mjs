// Research only: rank-one choose/powmod, fresh expression copies.
// RANK407_LARGE_PROBE deliberately bypasses copy COST admission,
// never integer precision guards. Not a production implementation.
import {registerHooks} from 'node:module';
registerHooks({load(url,ctx,next){const r=next(url,ctx);if(url.endsWith('/out/jit/number-loop-runtime.js') && process.env.RANK407_LARGE_PROBE)return {...r,source:String(r.source).replace('conditionWriteCells > COPY_PROBE_CAP || !feedback','!feedback')};if(!url.endsWith('/out/jit/integer-loop-expressions.js'))return r;let s=String(r.source);
if(s.includes("point.name === 'choose'"))throw Error('Historical Euler 407 prototype requires research base 86719518');
s=s.replace('if (parts.length === 3 && isNameExpression(last)', `if (parts.length === 4 && isNameExpression(last) && ['choose','powmod'].includes(last.name) && !localTypes.has(last.name) && !arrays.has(last.name) && !containers.has(last.name)) {
 return {name:last.name,module:last.name==='choose'?'core':'numbers',operands:parts.slice(0,-1).map(unwrap)};
 }
 if (parts.length === 3 && isNameExpression(last)`);
s=s.replace("if (point.module === 'core' && (point.name === 'min' || point.name === 'max'))",`if(point.name==='choose')return {type:values[1].type,code:values[0].code+' ? '+values[1].code+' : '+values[2].code};
 if (point.module === 'core' && (point.name === 'min' || point.name === 'max'))`);
s=s.replace("const type = point.name === 'min' || point.name === 'max'", "const type = point.name === 'choose' ? types[0] === 'boolean' && types[1] === types[2] ? types[1] : undefined : point.name === 'min' || point.name === 'max'");
s=s.replace("const type = arrayType(e);\n        if (!type || type.element", "if(isApplicationExpression(e) && e.arguments.length===1 && isNameExpression(e.arguments[0]) && e.arguments[0].name==='copy' && !localTypes.has('copy') && !arrays.has('copy') && !containers.has('copy')){builtins.set('copy','sequences');return emitNumberArray(e.head,lines); }\n        const type = arrayType(e);\n        if (!type || type.element");
return {...r,source:s};}});
