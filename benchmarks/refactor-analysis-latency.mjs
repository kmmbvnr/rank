import { performance } from 'node:perf_hooks';
import { EmptyFileSystem } from 'langium';
import { analyzeValues, createRankServices } from '../packages/language/out/index.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const sources = new Map([
  ['short incomplete', 'Value = 1\nResult = Value +'],
  ['large incomplete', `${Array.from({ length: 200 }, (_, index) =>
    `Value${index} = ${index} + 1`).join('\n')}\nResult = Value199 +`],
]);

for (const [name, source] of sources) {
  const samples = [];
  for (let index = 0; index < 25; index++) {
    const start = performance.now();
    const parsed = parser.parse(source);
    analyzeValues(parsed.value);
    if (index >= 5) samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  console.log(`${name}: median ${samples[9].toFixed(2)} ms, p95 ${samples[18].toFixed(2)} ms`);
}
