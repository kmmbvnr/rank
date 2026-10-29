// Fresh-process controls use experiments/euler262-original.ra; shipping uses the current demo.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(process.env.RUNTIME ?? 'packages/interpreter/out/index.js')).href);
const [step = '2', mode = 'compiled', variant = 'original'] = process.argv.slice(2);
assert(/^\d+$/.test(step) && Number(step) > 0);
assert(['compiled', 'reference'].includes(mode));
assert(['original', 'stream', 'early', 'blocked', 'precheck', 'shipping'].includes(variant));
let source = readFileSync(new URL(variant === 'shipping' ? '../demos/euler/262_mountainrange.ra'
    : './experiments/euler262-original.ra', import.meta.url), 'utf8')
    .replace('arg Step integer = 2', `arg Step integer = ${step}`);
const begin = source.indexOf('  Tq = (0 till Ms array)'), end = source.indexOf('\nend\nLim =', begin);
if (variant === 'stream' || variant === 'early') {
    source = source.slice(0, begin) + `  Hmax = -1.0e300
  for J in 0 till Ms
    Tq = J / (Ms - 1.0)
    Xq = Bx + (Cx - Bx) * Tq
    Yq = By + (Cy - By) * Tq
    Hq = Xq hgt Yq
    Hmax = Hmax max Hq
${variant === 'early' ? '    if Hmax greater Lim\n      return Hmax\n    end\n' : ''}  end
  return Hmax` + source.slice(end);
} else if (variant === 'blocked') {
    source = source.slice(0, begin) + `  Hmax = -1.0e300
  for J in 0 till Ms by 128
    Stop = (J + 128) min Ms
    Tq = (J till Stop array) / (Ms - 1.0)
    Xq = Bx + (Cx - Bx) * Tq
    Yq = By + (Cy - By) * Tq
    Hq' = Xq hgt Yq
    Hmax = Hmax max (Hq max)
    if Hmax greater Lim
      return Hmax
    end
  end
  return Hmax` + source.slice(end);
} else if (variant === 'precheck') {
    source = source.slice(0, begin) + `  Gap = (Ms // 16) max 1
  Probe = (0 till Ms by Gap array) / (Ms - 1.0)
  Xp = Bx + (Cx - Bx) * Probe
  Yp = By + (Cy - By) * Probe
  Hp' = Xp hgt Yp
  Peak = Hp max
  if Peak greater Lim
    return Peak
  end
` + source.slice(begin);
}
const marks = ['Ord = Hf argsort', 'Par = (0 till', 'F = Hf Cb', 'Ep = new index', 'Seen = array', 'Lid = Ord2', 'Dm = Ap Ap', 'for I in 0 till Bl', 'Ix = 0 till Bl', 'Answer = Best'];
if (process.env.PHASES) marks.forEach((mark, i) => { source = source.replace(mark, `"stage${i}" print\n${mark}`); });
const diagnostics = new RuntimeDiagnostics(), phases = [], output = [];
const runtime = new Interpreter(line => { if (line.startsWith('stage')) phases.push({ stage: line, ms: performance.now() - start }); else output.push(line); }, { compilation: mode === 'compiled' });
const start = performance.now();
try {
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    if (step === '2' || step === '1') assert.equal(String(runtime.variables.get('Answer')), '2531.205');
    if (step === '8') assert.equal(String(runtime.variables.get('Answer')), '2531.2');
    assert.deepEqual(output, [String(runtime.variables.get('Answer'))]);
    const signatures = Object.fromEntries(['Va', 'Vb', 'Da', 'Db'].map(name => [name, createHash('sha256').update(JSON.stringify(Array.from(runtime.variables.get(name).items, Number))).digest('hex')]));
    console.log(JSON.stringify({ step, mode, variant, ms, answer: String(runtime.variables.get('Answer')), best: String(runtime.variables.get('Best')), F: String(runtime.variables.get('F')), Bl: String(runtime.variables.get('Bl')), output, rssMiB: process.resourceUsage().maxRSS / 1024, signatures, phases, diagnostics }));
} finally { runtime.dispose(); }
