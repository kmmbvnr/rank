import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter } from '../packages/interpreter/out/index.js';

// blocks changes only the large flat-series products.
const mode = process.argv[2] ?? 'convolve';
assert.ok(['baseline', 'blocks', 'convolve'].includes(mode));
let source = readFileSync(new URL(
    '../demos/euler/696_mahjong.ra', import.meta.url), 'utf8');
if (mode === 'baseline') source = source.replace(
    `      Cv = Xa convolve Xb mod P
      Rr = (Cv take Lf) * Uk
`,
    `      Rr = array shape Lf fill 0
      Nz = (Xa not equal 0) indices
      for Ix in Nz
        Vv = Xa Ix
        Hi = Lf - 1 - Ix
        Pr = Vv * Xb (0 to Hi) mod P
        Ie = Lf - 1
        Pq = Rr (Ix to Ie) + Pr
        Rr (Ix to Ie) = Pq mod P
      end
      Rr = Rr * Uk
`);
if (mode !== 'convolve') source = source.replace(
    `      Cv = Ya convolve Bs mod P
      Zz = Cv take (Tt + 1)
`,
    `      Zz = array shape (Tt + 1) fill 0
      for I in 0 to Tt
        Hh = Tt - I
        Pw = Ya I * Bs (0 to Hh) mod P
        Zs = Zz (I to Tt) + Pw
        Zz (I to Tt) = Zs mod P
      end
`);
const runtime = new Interpreter(() => {});
try {
    if (process.argv.includes('--tail')) {
        const at = source.indexOf(
            'rem Q has u from the pair blocks:');
        runtime.execute(source.slice(0, at));
        const ms = [];
        for (let i = 0; i < 5; i++) {
            const start = performance.now();
            runtime.execute(source.slice(at));
            ms.push(performance.now() - start);
            assert.equal(runtime.variables.get('Answer'),
                436944244n);
        }
        console.log(JSON.stringify({ mode, tailMs: ms,
            answer: '436944244' }));
    } else {
        const start = performance.now();
        const cpu = process.cpuUsage();
        runtime.execute(source);
        const ms = performance.now() - start;
        const used = process.cpuUsage(cpu);
        const answer = String(runtime.variables.get('Answer'));
        assert.equal(answer, '436944244');
        console.log(JSON.stringify({ mode, ms,
            cpuMs: (used.user + used.system) / 1000,
            rssMiB: process.resourceUsage().maxRSS / 1024,
            answer }));
    }
} finally {
    runtime.dispose();
}
