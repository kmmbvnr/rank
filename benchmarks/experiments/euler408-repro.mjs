import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics, formatValue } from '../../packages/interpreter/out/index.js';
const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
try {
 const value=diagnostics.run(()=>runtime.execute(readFileSync(new URL('./euler408-modular-repro.ra',import.meta.url),'utf8')));
 console.log(JSON.stringify({result:formatValue(value),number:diagnostics.numberLoops,overflows:diagnostics.numberLoopOverflows}));
}finally{runtime.dispose();}
