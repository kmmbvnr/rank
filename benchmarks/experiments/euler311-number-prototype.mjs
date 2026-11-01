// Research-only patch of a copied build. Production source is untouched.
import assert from 'node:assert/strict';
import {cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'rank311-number-'));
// Pass a pre-fix build's out/index.js to reproduce the historical prototype.
const baseline = process.argv[2];
cpSync(baseline ? dirname(baseline) : new URL('../../packages/interpreter/out', import.meta.url), join(root, 'out'), {recursive: true});
symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(root, 'node_modules'));
const file = join(root, 'out/jit/scalar-function-kernel.js');
let source = readFileSync(file, 'utf8');
function replace(before, after) {
    assert(source.includes(before), `Built compiler changed: ${before}`);
    source = source.replace(before, after);
}
replace("proof.nativeReads.some(name => name !== 'len')",
    "proof.nativeReads.some(name => name !== 'len' && name !== 'floor')");
replace("if (compiled.kind === 'call')\n            return undefined;", `if (compiled.kind === 'call') {
            if (compiled.operation.module !== 'numbers' || compiled.operation.name !== 'floor' || compiled.arguments.length !== 1) return undefined;
            const value = lowerNum(compiled.arguments[0], lines);
            if (!value) return undefined;
            const result = 'v' + serial++;
            lines.push('const ' + result + ' = safe(Math.floor(' + value + '));');
            return result;
        }`);
replace('if (input.operation)\n                return undefined;', `if (input.operation === 'integer-power') {
                const base = lowerNum(input.indices[0], lines), exponent = lowerNum(input.indices[1], lines);
                if (!base || !exponent) return undefined;
                let value = '(' + base + ') ** (' + exponent + ')';
                if (input.negative) value = '-(' + value + ')';
                const result = 'v' + serial++;
                lines.push('const ' + result + ' = safe(' + value + ');');
                return result;
            }
            if (input.operation)
                return undefined;`);
writeFileSync(file, source);
console.log(join(root, 'out/index.js'));
