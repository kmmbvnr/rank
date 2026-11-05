import { readFileSync, writeFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
const [file = 'demos/euler/408_admissiblepaths.ra', limit = '10000000', mode = 'compiled'] = process.argv.slice(2);
const source = readFileSync(file, 'utf8').replace(/arg N integer = \d+/, `arg N integer = ${limit}`), generated = [];
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [],
    onIntegerLoopCompiled: text => generated.push(text) });
const diagnostics = new RuntimeDiagnostics(), start = performance.now(), stages = [];
try {
    if (process.env.STAGES) {
        const bounds = [0, source.indexOf('rem Factorials'), source.indexOf('If = array'), source.indexOf('Bs = array'), source.length];
        for (let i = 0; i < bounds.length - 1; i++) {
            const t = performance.now(), before = { loops: diagnostics.compiledLoops, number: diagnostics.numberLoops, overflows: diagnostics.numberLoopOverflows };
            diagnostics.run(() => runtime.execute(source.slice(bounds[i], bounds[i + 1])));
            stages.push({ name: ['points', 'factorials', 'inverses', 'recurrence'][i], ms: performance.now() - t,
                loops: diagnostics.compiledLoops - before.loops, number: diagnostics.numberLoops - before.number, overflows: diagnostics.numberLoopOverflows - before.overflows });
        }
    } else diagnostics.run(() => runtime.execute(source));
    console.log(JSON.stringify({ file, limit, mode, ms: performance.now() - start, rssMiB: process.resourceUsage().maxRSS / 1024,
        answer: String(runtime.variables.get('Answer')), points: String(runtime.variables.get('M')), stages, diagnostics }));
    if (process.env.GENERATED) writeFileSync(process.env.GENERATED, generated.join('\n\n// NEXT REGION\n\n'));
} finally { runtime.dispose(); }
