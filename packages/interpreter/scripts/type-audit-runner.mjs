import { VitestTestRunner } from 'vitest/runners';

export default class TypeAuditRunner extends VitestTestRunner {
    pendingUpdates = new Set();

    onBeforeRunFiles() {
        // Vitest installs its RPC wrapper after constructing the runner.
        const report = this.onTaskUpdate.bind(this);
        this.onTaskUpdate = (...args) => {
            const pending = report(...args);
            this.pendingUpdates.add(pending);
            pending.then(() => this.pendingUpdates.delete(pending), () => {});
            return pending;
        };
    }

    async onBeforeTryTask(test) {
        super.onBeforeTryTask(test);
        // A synchronous demo can exceed the task-update RPC's 60-second
        // deadline. An empty report alone does not wait for earlier reports.
        // Audit callbacks must yield only after execution, so a throttled
        // report cannot start between this wait and the synchronous work.
        await this.onTaskUpdate([], []);
        await Promise.all(this.pendingUpdates);
    }
}
