import { describe, expect, it, vi } from 'vitest';

vi.mock('vitest/runners', () => ({
    VitestTestRunner: class { onBeforeTryTask() {} },
}));

// @ts-expect-error The custom runner is a JavaScript entry point.
import TypeAuditRunner from '../scripts/type-audit-runner.mjs';

describe('CPU-bound audit reporting', () => {
    it('waits for earlier reports even when the empty report finishes first', async () => {
        let acknowledge!: () => void;
        const earlier = new Promise<void>(resolve => { acknowledge = resolve; });
        const runner = new TypeAuditRunner();
        runner.onTaskUpdate = vi.fn()
            .mockReturnValueOnce(earlier)
            .mockResolvedValue(undefined);
        runner.onBeforeRunFiles?.();
        const report = runner.onTaskUpdate([], []);
        let started = false;
        const start = runner.onBeforeTryTask({}).then(() => { started = true; });
        await new Promise(resolve => setImmediate(resolve));
        expect(started).toBe(false);
        acknowledge();
        await Promise.all([report, start]);
        expect(started).toBe(true);
    });

    it('preserves reporting failures', async () => {
        const failure = new Error('report failed');
        const runner = new TypeAuditRunner();
        runner.onTaskUpdate = vi.fn()
            .mockRejectedValueOnce(failure)
            .mockResolvedValue(undefined);
        runner.onBeforeRunFiles?.();
        await expect(runner.onTaskUpdate([], [])).rejects.toBe(failure);
        await expect(runner.onBeforeTryTask({})).rejects.toBe(failure);
    });
});
