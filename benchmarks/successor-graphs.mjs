import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { Interpreter } from '../packages/interpreter/out/index.js';

// Same transitions and bounded BFS in both modes. Fresh processes include
// construction in total time; RSS is whole-process peak, not retained graph size.
const cases = {
    grid: { size: 10000, goal: 101, distance: 2, source: `
fun N next
  Row = N // 100
  Col = N mod 100
  if Row greater 0
    yield N - 100
  end
  if Col greater 0
    yield N - 1
  end
  if Col less 99
    yield N + 1
  end
  if Row less 99
    yield N + 100
  end
end` },
    knight: { size: 64, goal: 63, distance: 6, source: `
fun N next
  Row = N // 8
  Col = N mod 8
  for DR in array -2 -1 1 2
    for DC in array -2 -1 1 2
      if (DR abs) + (DC abs) equal 3
        R = Row + DR
        C = Col + DC
        if R at least 0 and R less 8 and C at least 0 and C less 8
          yield R * 8 + C
        end
      end
    end
  end
end` },
    // Four encoded lights; a move toggles one light and its adjacent lights.
    lights: { size: 16, goal: 15, distance: 2, source: `
fun N next
  for Mask in array 3 7 14 12
    yield N bxor Mask
  end
end` },
};

if (process.argv[2] === '--worker') {
    const [name, mode] = process.argv.slice(3);
    const task = cases[name];
    const runtime = new Interpreter();
    try {
        runtime.execute('use graph\nuse sequences\nuse bits\nuse numbers\n' + task.source);
        const begin = performance.now();
        runtime.execute(mode === 'successor' ? 'G = new graph with next .directed' : `
G = new graph (0 till ${task.size}) .directed
for N in 0 till ${task.size}
  for M in N next
    G add N M
  end
end`);
        const built = performance.now();
        const result = runtime.execute(`G 0 ${task.goal} 100000 bfs`);
        const end = performance.now();
        assert.equal(result.entries.get('status').name, 'reached');
        const path = result.entries.get('path').items;
        assert.equal(path.length - 1, task.distance);
        assert.equal(path[0], 0n);
        assert.equal(path.at(-1), BigInt(task.goal));
        const graph = runtime.variables.get('G');
        const storedEdges = mode === 'explicit' ? [...graph.adjacency.values()].reduce((n, edges) => n + edges.length, 0) : 0;
        console.log(JSON.stringify({ name, mode, buildMs: built - begin, searchMs: end - built, totalMs: end - begin,
            generatedEdges: mode === 'explicit' ? storedEdges : Number(result.entries.get('examined')),
            examined: Number(result.entries.get('examined')), storedEdges,
            discovered: result.entries.get('order').items.length, distance: path.length - 1,
            peakRssKiB: process.resourceUsage().maxRSS }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model }));
    for (let round = 0; round < 3; round++) for (const name of Object.keys(cases)) {
        for (const mode of round % 2 ? ['successor', 'explicit'] : ['explicit', 'successor']) {
            const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', name, mode], { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr || result.stdout);
            process.stdout.write(result.stdout);
        }
    }
}
