import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Interpreter } from '../packages/interpreter/out/index.js';
import { PredicateGraph } from '../packages/interpreter/out/graph.js';

const demo = readFileSync(new URL('../demos/euler/060_primepairs.ra', import.meta.url), 'utf8');
const definitions = 'use graph\nuse sequences\nuse io\n' + demo.slice(demo.indexOf('\nfun '));
// Retain the explicit builder's residue and large-endpoint exclusions. The
// recursive search, sum bounds and candidate order are identical in both modes.
const implicit = definitions.replace(/  Graph = new graph Vals \.undirected[\s\S]*?(?=  return record)/,
    '  Graph = new graph Vals with edge .undirected\n\n') + `
fun P Q edge
  if P equal Q
    return false
  end
  if P not equal 3 and Q not equal 3
    if P mod 3 not equal Q mod 3
      return false
    end
    if P at least 10000 and Q at least 10000
      return false
    end
  end
  return P Q compatible
end
`;

assert.ok(!implicit.includes('Graph add'), 'Euler builder changed: update the predicate fixture');

if (process.argv[2] === '--worker') {
    const mode = process.argv[3];
    const counting = process.argv.includes('--count');
    const materializedCandidates = process.argv.includes('--materialize');
    let predicateCalls = 0, compatibilityCalls = 0;
    const original = PredicateGraph.prototype.adjacent;
    if (counting) PredicateGraph.prototype.adjacent = function(...args) {
        predicateCalls++;
        return original.apply(this, args);
    };
    let source = mode === 'explicit' ? definitions : implicit;
    if (materializedCandidates) source = source.replace('Next = Later filter in Neighbors', 'Next = Later filter in Neighbors array');
    if (counting) source = source.replace('fun P Q compatible\n', 'fun P Q compatible\n  "pair" print\n');
    const runtime = new Interpreter(() => { compatibilityCalls++; });
    try {
        runtime.execute(source);
        const phases = {};
        const time = (phase, program) => {
            const start = performance.now();
            const result = runtime.execute(program);
            phases[phase] = performance.now() - start;
            return result;
        };
        time('seedBuild', 'Seed = 10000 build');
        assert.equal(time('seedSearch', 'Upper = Seed 50000 min_five\nUpper'), 26033n);
        time('fullBuild', 'Full = Upper build');
        assert.equal(time('fullSearch', 'Answer = Full Upper min_five\nAnswer'), 26033n);
        const graphs = ['Seed', 'Full'].map(name => runtime.variables.get(name).entries.get('graph'));
        const domainVertices = graphs.map(graph => graph.size);
        const storedAdjacencyEntries = graphs.map(graph => graph instanceof PredicateGraph ? 0
            : [...graph.adjacency.values()].reduce((sum, edges) => sum + edges.length, 0));
        console.log(JSON.stringify({ mode, counting, materializedCandidates, phases, totalMs: Object.values(phases).reduce((a, b) => a + b),
            domainVertices, storedAdjacencyEntries, cacheEntries: 0,
            ...(counting ? { predicateCalls, compatibilityCalls } : {}),
            // Whole-process peak RSS includes interpreter startup and search allocations.
            peakRssKiB: process.resourceUsage().maxRSS, answer: '26033' }));
    } finally { runtime.dispose(); PredicateGraph.prototype.adjacent = original; }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model }));
    // Count runs are separate: printing changes compilation and must not be used
    // as performance measurements. Timed samples use uninstrumented callbacks.
    const rounds = process.argv.includes('--count') ? 1 : 3;
    for (let round = 0; round < rounds; round++) {
        for (const mode of round % 2 ? ['predicate', 'explicit'] : ['explicit', 'predicate']) {
            const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--worker', mode,
                ...(process.argv.includes('--count') ? ['--count'] : []),
                ...(process.argv.includes('--materialize') ? ['--materialize'] : [])], { encoding: 'utf8' });
            if (child.status !== 0) throw new Error(child.stderr || child.stdout);
            process.stdout.write(child.stdout);
        }
    }
}
