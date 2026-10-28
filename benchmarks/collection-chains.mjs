// Run after npx tsc -b tsconfig.build.json. Parsing is outside timed demands.
import assert from 'node:assert/strict';
import { Interpreter, parse, formatValue } from '../packages/interpreter/out/index.js';
const cases = [
    ['sort unique', 'T = V sort\nT unique'],
    ['sort take 20 sum', 'T = V sort\nU = T take 20\nU sum'],
    ['unique sort take 20 sum', 'T = V unique\nS = T sort\nU = S take 20\nU sum'],
    ['unique sum', 'T = V unique\nT sum'],
];
for (const [chain, separate] of cases) {
    const results = [];
    for (const body of [separate, `V ${chain}`]) {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nV = (1 to 100000 array) mod 10007 copy');
            const program = parse(body);
            let answer;
            const start = performance.now();
            for (let i = 0; i < 5; i++) answer = runtime.executeProgram(program);
            const ms = (performance.now() - start) / 5;
            results.push({ ms, answer: formatValue(answer) });
        } finally { runtime.dispose(); }
    }
    assert.equal(results[0].answer, results[1].answer);
    console.log(JSON.stringify({ chain, separate: results[0].ms, fused: results[1].ms }));
}
