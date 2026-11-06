import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const { Interpreter } = await import(process.env.RANK424_RUNTIME ?? new URL('../../packages/interpreter/out/index.js', import.meta.url));
const [file = 'demos/euler/424_kakuro.ra', mode = 'compiled', output = '/tmp/rank424-maps.json'] = process.argv.slice(2);
let source = readFileSync(file, 'utf8');
source = source.replace('Tot = 0\nfor Ln', 'Trace = array shape Count fill 0\nPuzzleIndex = 0\nTot = 0\nfor Ln')
    .replace('  Tot += Res', '  Trace PuzzleIndex = Res\n  PuzzleIndex += 1\n  Tot += Res');
assert.ok(source.includes('Trace PuzzleIndex'));
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', io: { read: path => readFileSync(path) } });
let maps;
try {
    runtime.execute(source);
    maps = Array.from(runtime.variables.get('Trace').items, String);
} finally { runtime.dispose(); }
const lines = readFileSync('demos/euler/fixtures/0424_kakuro200.txt', 'utf8').trim().split(/\r?\n/);
let nodes = 0;
function valid(line, encoded) {
    const digits = [...encoded.padStart(10, '0')].map(Number);
    assert.equal([...digits].sort().join(''), '0123456789');
    const pieces = line.match(/\([^)]*\)|[^,]+/g), size = Number(pieces.shift()), grid = pieces;
    const values = grid.map(cell => /^[A-J]$/.test(cell) ? digits[cell.charCodeAt(0) - 65] : 0);
    const runs = [], owners = grid.map(() => []);
    const blanks = [];
    for (let cell = 0; cell < grid.length; cell++) {
        if (grid[cell] === 'O') blanks.push(cell);
        if (/^[A-J]$/.test(grid[cell])) assert.ok(values[cell] > 0);
        if (!grid[cell].startsWith('(')) continue;
        for (const clue of grid[cell].slice(1, -1).split(',')) {
            const letters = clue.slice(1), target = [...letters].reduce((n, c) => 10 * n + digits[c.charCodeAt(0) - 65], 0);
            assert.ok(digits[letters.charCodeAt(0) - 65] > 0);
            const step = clue[0] === 'h' ? 1 : size, cells = [];
            for (let next = cell + step; next < grid.length && (step !== 1 || Math.floor(next / size) === Math.floor(cell / size)); next += step) {
                if (!/^[A-JO]$/.test(grid[next])) break;
                cells.push(next);
            }
            const run = { target, sum: 0, mask: 0, left: 0 };
            for (const at of cells) {
                owners[at].push(runs.length);
                if (grid[at] === 'O') { run.left++; continue; }
                const bit = 1 << values[at];
                assert.equal(run.mask & bit, 0);
                run.mask |= bit;
                run.sum += values[at];
            }
            runs.push(run);
        }
    }
    function fits(run, digit) {
        if (run.mask & (1 << digit)) return false;
        const left = run.left - 1, rest = run.target - run.sum - digit;
        if (!left) return rest === 0;
        const available = [];
        for (let n = 1; n <= 9; n++) if (n !== digit && !(run.mask & (1 << n))) available.push(n);
        if (available.length < left) return false;
        const low = available.slice(0, left).reduce((a, b) => a + b, 0);
        const high = available.slice(-left).reduce((a, b) => a + b, 0);
        return rest >= low && rest <= high;
    }
    function search() {
        nodes++;
        let best = -1, candidates;
        for (const cell of blanks) {
            if (values[cell]) continue;
            const choices = [];
            for (let digit = 1; digit <= 9; digit++) if (owners[cell].every(owner => fits(runs[owner], digit))) choices.push(digit);
            if (!choices.length) return false;
            if (best < 0 || choices.length < candidates.length) { best = cell; candidates = choices; }
            if (choices.length === 1) break;
        }
        if (best < 0) return runs.every(run => run.sum === run.target && run.left === 0);
        for (const digit of candidates) {
            values[best] = digit;
            for (const owner of owners[best]) { const run = runs[owner]; run.sum += digit; run.mask |= 1 << digit; run.left--; }
            if (search()) return true;
            for (const owner of owners[best]) { const run = runs[owner]; run.sum -= digit; run.mask ^= 1 << digit; run.left++; }
        }
        values[best] = 0;
        return false;
    }
    assert.ok(search());
}
assert.equal(maps.length, 200);
for (let i = 0; i < lines.length; i++) {
    try { valid(lines[i], maps[i]); }
    catch (error) { throw new Error(`puzzle ${i + 1}, map ${maps[i]}`, { cause: error }); }
}
assert.equal(maps.reduce((n, x) => n + BigInt(x), 0n), 1059760019628n);
writeFileSync(output, JSON.stringify({ maps, nodes, oracle: 'native parser plus MRV cell completion with independent distinct-digit min/max bounds' }, null, 2) + '\n');
console.log(JSON.stringify({ puzzles: maps.length, nodes, golden: '1059760019628', output }));
