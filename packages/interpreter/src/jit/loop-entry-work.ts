import { isForStatement } from '@arrrank/language';
import { entryWorkValues, prepareEntryWorkProof } from './entry-work-proof.js';
import type { IntegerLoopPlan, LoopHost } from './integer-loop-plan.js';

/** Prove work in the first entered condition-loop iteration. The shared block
 * proof invalidates written bounds and never reads cells or invokes callbacks. */
export function prepareLoopEntryWork(plan: IntegerLoopPlan, host: LoopHost):
    ((input: unknown[], target: number) => number) | undefined {
    const root = plan.statement;
    if (plan.iteration || !isForStatement(root) || !root.condition
        || plan.hasControl || plan.calls.length || plan.callouts?.length || plan.hasYield) return undefined;
    const proof = prepareEntryWorkProof(plan, host);
    const entered = proof.truth(root.condition), body = proof.block(root.statements);
    if (!body.hasWork) return undefined;
    return (input, target) => {
        const values = entryWorkValues(plan, input);
        return entered(values) === true ? body.run(values, target).work : 0;
    };
}
