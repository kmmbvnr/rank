import { currentDiagnostics } from './diagnostics.js';
import type { RankArray, SequencePlan } from './value.js';

const completions = new WeakMap<SequencePlan, {
    readonly iterate: SequencePlan['iterate'];
    readonly size: SequencePlan['size'];
    readonly count: bigint;
    readonly complete: () => RankArray;
}>();

/** Constructor-owned finite sources can fill final storage without allocating
 * an object for every yielded row. An overridden iterator retains normal demand. */
export function registerSequenceCompletion(plan: SequencePlan, complete: () => RankArray): void {
    if (plan.size.kind === 'exact') completions.set(plan, {
        iterate: plan.iterate, size: plan.size, count: plan.size.value, complete,
    });
}

export function completeNativeSequence(plan: SequencePlan): RankArray | undefined {
    const proof = completions.get(plan);
    if (!proof || Object.getOwnPropertyDescriptor(plan, 'iterate')?.value !== proof.iterate
        || Object.getOwnPropertyDescriptor(plan, 'size')?.value !== proof.size
        || Object.getOwnPropertyDescriptor(proof.size, 'kind')?.value !== 'exact'
        || Object.getOwnPropertyDescriptor(proof.size, 'value')?.value !== proof.count) return undefined;
    const result = proof.complete();
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.nativeSequenceCopies++;
    return result;
}
