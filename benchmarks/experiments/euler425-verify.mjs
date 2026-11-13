import { readFileSync } from 'node:fs';
import { relativePrefix } from './euler425-oracle.mjs';
const { Interpreter } = await import(process.env.RANK425_RUNTIME ?? new URL('../../packages/interpreter/out/index.js', import.meta.url));
const source = readFileSync('demos/euler/425_primeconnection.ra', 'utf8'), prefix = relativePrefix(20000);
const cases = [0,1,2,3,5,10,11,12,13,20,99,100,101,103,109,113,199,200,431,1000,10000,20000];
let checked = 0;
for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) for (const n of cases) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try {
        runtime.execute(source);
        if ((runtime.variables.get('Answer') ?? runtime.lastResult) !== prefix[n]) throw Error(JSON.stringify({ options, n, answer: String((runtime.variables.get('Answer') ?? runtime.lastResult)), expected: String(prefix[n]) }));
        checked++;
    } finally { runtime.dispose(); }
}
console.log(JSON.stringify({ checked, oracle: 'string edits plus minimax Dijkstra', cases: cases.map(n => [n, String(prefix[n])]) }));
