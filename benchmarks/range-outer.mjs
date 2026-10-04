// Median time of range, sequence-arithmetic, outer and reduction cases on a built checkout.
// Compare two checkouts: node benchmarks/range-outer.mjs /path/to/checkout   (default: this one)
const root = process.argv[2] ?? new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { createReplSession } = await import(`${root}/packages/common/out/repl-session.js`);
const cases = [
  ['range sum 1e7', 'use sequences', '(1 to 10000000) sum'],
  ['range*2+1 sum 3e6', 'use sequences', '((1 to 3000000) * 2 + 1) sum'],
  ['range zip sum 3e6', 'use sequences', '((1 to 3000000) + (1 to 3000000)) sum'],
  ['range for-loop 3e6', 'use sequences', 'T = 0\nfor I in 1 to 3000000\n T += I * 2\nend\nT'],
  ['outer small 300x300 sum', 'use sequences', 'F = 1 to 300\n(F F outer *) sum'],
  ['outer 900 max', 'use sequences', 'F = 100 to 999\nF F outer * max'],
  ['array 1e6 sum', 'use sequences', '(1 to 1000000) (array 1000000) reshape sum'],
  ['lazy 1.2k^2 sum', 'use sequences', 'F = 1 to 1200\nF F outer * sum rank 2'],
  ['index range 1e6', 'use sequences', 'R = (1 to 1000000) * 3\nR 999999'],
];
const times = (n, f) => { const t = []; for (let i = 0; i < n; i++) { const s = performance.now(); f(); t.push(performance.now() - s); } return t; };
for (const [name, setup, body] of cases) {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const session = createReplSession();
    await session.execute(setup, 1, []);
    const s = performance.now();
    const r = await session.execute(body, 2, []);
    samples.push(performance.now() - s);
    if (i === 0 && r.output.some(l => l.error)) { console.log(name, 'ERR', r.output.map(l => l.text).join('|').slice(0, 60)); break; }
    session.dispose();
  }
  samples.sort((a, b) => a - b);
  console.log(name.padEnd(28), 'median', samples[2].toFixed(1), 'ms');
}
