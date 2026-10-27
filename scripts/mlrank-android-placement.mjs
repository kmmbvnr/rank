import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

// Run after the device test. Explicit serial and PID avoid touching another phone.
const [serial, pid] = process.argv.slice(2);
assert.ok(serial && /^\d+$/.test(pid ?? ''), 'Usage: node scripts/mlrank-android-placement.mjs SERIAL APP_PID');
const adb = process.env.ADB ?? `${homedir()}/Library/Android/sdk/platform-tools/adb`;
const logs = execFileSync(adb, ['-s', serial, 'logcat', '-d', `--pid=${pid}`, '-s', 'tflite:V'], { encoding: 'utf8' });
const placements = [...logs.matchAll(/Replacing (\d+) out of (\d+) node\(s\) with delegate \(LITERT_CL\)/g)]
    .map(match => ({ delegated: Number(match[1]), total: Number(match[2]) }));
assert.ok(placements.length, 'No GPU placement evidence; run the test in this app process first');
assert.ok(placements.every(({ delegated, total }) => total > 0 && delegated === total), 'Partial GPU delegation');
console.log(JSON.stringify({ serial, pid, placements }, null, 2));
