// Research only: bounded text iteration and unary binary in the Number tier.
// The exact kernel still supplies native binding guards and overflow replay.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
 const result=next(url,context);
 if(!url.endsWith('/out/jit/scalar-function-kernel.js'))return result;
 let source=String(result.source);
 const replace=(a,b)=>{assert.ok(source.includes(a),a);source=source.replace(a,b);};
 replace("!['len', 'floor', 'ceil', 'abs', 'choose', 'min', 'max', 'isqrt'].includes(name)","!['len', 'floor', 'ceil', 'abs', 'choose', 'min', 'max', 'isqrt', 'binary'].includes(name)");
 replace("if (typeof compiled.value === 'boolean')", "if (typeof compiled.value === 'string') return JSON.stringify(compiled.value);\n            if (typeof compiled.value === 'boolean')");
 replace("const name = compiled.operation.name;",`const name = compiled.operation.name;
            if (compiled.operation.module === 'bits' && name === 'binary' && compiled.arguments.length === 1) {
                const value = lowerNum(compiled.arguments[0], lines);
                if (!value) return undefined;
                const result = 'v' + serial++;
                lines.push('if (' + value + ' < 0) throw overflow; const ' + result + ' = (' + value + ').toString(2);');
                return result;
            }`);
 replace("const range = rangeSliceOperands(rangeExpr);",`if (proof.expressions.get(rangeExpr)?.type === 'text') {
                        const text = emitNum(rangeExpr, lines);
                        if (!text) return false;
                        lines.push('for (const ' + slot(binding.names[0]) + ' of ' + text + ') { location = ' + loc + '; checkpoint();');
                        if (!lowerCommands(cmd.statements, lines)) return false;
                        lines.push('}');
                        continue;
                    }
                    const range = rangeSliceOperands(rangeExpr);`);
 return {...result,source};
}});
