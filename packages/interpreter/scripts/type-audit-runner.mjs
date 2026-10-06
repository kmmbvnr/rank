import { VitestTestRunner } from 'vitest/runners';

export default class TypeAuditRunner extends VitestTestRunner {
    async onBeforeTryTask(test) {
        super.onBeforeTryTask(test);
        // A synchronous demo can exceed the task-update RPC's 60-second
        // deadline. Wait for preceding reports before occupying the worker.
        await this.onTaskUpdate([], []);
    }
}
