import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const [mode = 'compiled', variant = 'original', limit = '150'] = process.argv.slice(2);
assert(['compiled', 'reference'].includes(mode));
assert(/^\d+$/.test(limit));
let source = readFileSync(new URL('./experiments/euler273-original.ra', import.meta.url), 'utf8')
    .replace('arg Limit integer = 150', `arg Limit integer = ${limit}`);
if (variant === 'deferred') source = source.replace('Lo = Re abs', "Lo' = Re abs").replace('Hi = Im abs', "Hi' = Im abs");
if (variant === 'arithmetic-abs') source = source.replace('Lo = Re abs', "Lo' = Re max (0 - Re)").replace('Hi = Im abs', "Hi' = Im max (0 - Im)");
if (variant === 'scalar' || variant === 'rows') source = source.replace(/  Re' = Xr[\s\S]*?  Total \+= \(Lo min Hi\) sum/, `${variant === 'rows' ? '  Row = 0\n' : ''}  for J in 0 till (Br len)
    Yr = Br J
    Yi = Bi J
    Re = Xr * Yr - Xi * Yi
    Im = Xr * Yi + Xi * Yr
    Lo = Re abs
    Hi = Im abs
    ${variant === 'rows' ? 'Row' : 'Total'} += Lo min Hi
  end${variant === 'rows' ? '\n  Total += Row' : ''}`);
if (variant === 'prefix') source = source.replace('Total = 0', `rem Canonicalize each factor into the first octant.
AbsR = Ar abs
AbsI = Ai abs
Ar = AbsR max AbsI
Ai = AbsR min AbsI
AbsR = Br abs
AbsI = Bi abs
Br = AbsR max AbsI
Bi = AbsR min AbsI
rem Integer slope keys preserve exact order: denominators <= MaxR.
MaxR = Br max
Scale = MaxR * MaxR
Keys = Bi * Scale // Br
Order = Keys argsort
Br = Br Order
Bi = Bi Order
Pr = concat (array 0) (Br scan +)
Pi = concat (array 0) (Bi scan +)
N = Br len
SumR = Pr N
SumI = Pi N
Total = 0`).replace(/  Re' = Xr[\s\S]*?  Total \+= \(Lo min Hi\) sum/, `  for Mode in 0 to 1
    A = Xr
    B = Xi
    if Mode equal 1
      A = Xr + Xi
      B = Xr - Xi
    end
    Left = 0
    Right = N
    for Left less Right
      Mid = (Left + Right) // 2
      if A * (Bi Mid) at most B * (Br Mid)
        Left = Mid + 1
      else
        Right = Mid
      end
    end
    R = Pr Left
    S = Pi Left
    if Mode equal 0
      Total += Xi * (2 * R - SumR) + Xr * (SumI - 2 * S)
    else
      Total += Xr * (S + SumR - R) + Xi * (R + S - SumI)
    end
  end`).replace('Answer = Total // 2', 'Answer = Total // 4');
if (variant === 'shipping') source = readFileSync(new URL('../demos/euler/273_sumofsquares.ra', import.meta.url), 'utf8')
    .replace('arg Limit integer = 150', `arg Limit integer = ${limit}`);
assert(['original', 'deferred', 'arithmetic-abs', 'scalar', 'rows', 'prefix', 'shipping'].includes(variant));
if (process.env.DUMP_SOURCE) { process.stdout.write(source); process.exit(0); }
const stages = [];
if (process.env.STAGES) source = source.replace('Total = 0', '"generated" print\nTotal = 0');
let previous = performance.now();
const runtime = new Interpreter(value => {
    const now = performance.now();
    stages.push({label: String(value), ms: now - previous});
    previous = now;
}, {compilation: mode === 'compiled'});
const diagnostics = new RuntimeDiagnostics();
const start = performance.now();
try {
    if (process.env.DIAGNOSTICS) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    const golden = {'20': '80', '40': '12006', '60': '2579619', '150': '2032447591196869022'}[limit];
    if (golden) assert.equal(answer, golden);
    console.log(JSON.stringify({mode, variant, limit, ms: performance.now() - start, answer,
        rssMiB: process.resourceUsage().maxRSS / 1024, stages,
        ...(process.env.DIAGNOSTICS ? {diagnostics} : {})}));
} finally { runtime.dispose(); }
