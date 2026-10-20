import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const program = readFileSync(new URL('../../../demos/euler/311_biclinic.ra', import.meta.url), 'utf8');
const block = program.slice(program.indexOf('fun Low High biclinic_block'));
function oracle(low: number, high: number) {
    const counts = new Uint32Array(high - low + 1);
    for (let y = 1; y * y * 2 <= high; y++) {
        for (let x = y + 1; x * x + y * y <= high; x++) {
            const t = x * x + y * y;
            if (t >= low) counts[t - low]++;
        }
    }
    let answer = 0;
    counts.forEach((r, i) => {
        if (r < 2) return;
        answer += r * (r - 1) * (r - 2) / 6;
        const n = low + i;
        if (n % 2 === 0 && Number.isInteger(Math.sqrt(n / 2))) answer += r * (r - 1) / 2;
    });
    return BigInt(answer);
}

describe('dense sum-of-squares blocks', () => {
    it.each([[1, 4096], [1001, 1096], [99991, 100000]])('matches an independent count over %s..%s', (low, high) => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute(`use numbers\n${block}\nAnswer = ${low} ${high} biclinic_block`));
            expect(runtime.variables.get('Answer')).toBe(oracle(low, high));
            expect(diagnostics.numberLoops).toBe(2);
            expect(diagnostics.numberLoopOverflows).toBe(0);
            expect(diagnostics.typedUnpacks).toBe(0);
        } finally { runtime.dispose(); }
    });

    it.each([[10000, 4000, 49n], [1000000, 400000, 38239n]])('preserves published B(%s) with block %s', (limit, size, answer) => {
        const runtime = new Interpreter(() => {});
        try {
            runtime.execute(program.replace('option Limit integer = 10 ** 10', `option Limit integer = ${limit}`)
                .replace('option Block integer = 4000000', `option Block integer = ${size}`));
            expect(runtime.variables.get('Answer')).toBe(answer);
        } finally { runtime.dispose(); }
    });
});
