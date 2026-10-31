import {registerHooks} from 'node:module';
import {writeFileSync} from 'node:fs';
// Observe rejected speculative lowering without changing the selected backend.
registerHooks({load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.endsWith('/out/jit/integer-loop-state.js')) {
        return {...result, source: String(result.source).replace(
            "failed(compilerRejection('loop', node, detail));",
            "if (numberMode) console.error('NUMBER NODE:', detail, node.$cstNode?.text); failed(compilerRejection('loop', node, detail));")};
    }
    if (!url.endsWith('/out/jit/integer-loop.js')) return result;
    return {...result, source: String(result.source).replaceAll(
        '() => { }, true', '(reason) => console.error("NUMBER LOWERING:", reason), true')};
}});
const {Interpreter, RuntimeDiagnostics} = await import('../../packages/interpreter/out/index.js');
const {readFileSync} = await import('node:fs');
const sources = [];
const interpreter = new Interpreter(() => {}, {
    onIntegerLoopCompiled: source => sources.push(source),
});
const diagnostics = new RuntimeDiagnostics();
try {
    diagnostics.run(() => interpreter.execute(readFileSync(new URL('./euler294-original.ra', import.meta.url), 'utf8')));
    writeFileSync('/tmp/rank294-generated.js', sources.join('\n\n'));
    console.log(JSON.stringify({answer: String(interpreter.variables.get('Answer')), diagnostics}, null, 2));
} finally {interpreter.dispose();}
