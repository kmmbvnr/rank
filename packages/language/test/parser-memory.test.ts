import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('parses nested calls and the demo corpus within a bounded heap', () => {
    // A separate process gives the parser a real heap ceiling, independent of
    // Vitest's own caches. As with workspace tests, build generated sources first.
    const output = execFileSync(process.execPath, [
        '--expose-gc', '--max-old-space-size=512',
        fileURLToPath(new URL('../../../benchmarks/parser-memory.mjs', import.meta.url)),
    ], { encoding: 'utf8', timeout: 25_000 });
    const [sigmoid, nested, first, second] = JSON.parse(output);
    // The old grammar retained 1.8 GiB for sigmoid alone, and nested calls
    // continued multiplying lookahead paths even after factoring its first operand.
    expect(sigmoid.heapMiB).toBeLessThan(64);
    expect(nested.heapMiB).toBeLessThan(96);
    expect(first.count).toBeGreaterThan(800);
    expect(second.count).toBe(first.count);
    expect(second.heapMiB).toBeLessThan(384);
    expect(second.heapMiB - first.heapMiB).toBeLessThan(16);
}, 30_000);
