import { currentDiagnostics } from './diagnostics.js';
import type { RankArray, SequencePlan } from './value.js';

const completions = new WeakMap<SequencePlan, {
    readonly iterate: SequencePlan['iterate'];
    readonly size: SequencePlan['size'];
    readonly kind: SequencePlan['size']['kind'];
    readonly count?: bigint;
    readonly complete: () => RankArray | undefined;
}>();

/** Constructor-owned finite sources can fill final storage without allocating
 * an object for every yielded row. Size may remain unknown until completion.
 * An overridden iterator or changed size evidence retains normal demand. */
export function registerSequenceCompletion(plan: SequencePlan, complete: () => RankArray | undefined): void {
    if (plan.size.kind !== 'infinite') completions.set(plan, {
        iterate: plan.iterate, size: plan.size, kind: plan.size.kind,
        count: plan.size.kind === 'exact' ? plan.size.value : undefined, complete,
    });
}

export function completeNativeSequence(plan: SequencePlan): RankArray | undefined {
    const proof = completions.get(plan);
    if (!proof || Object.getOwnPropertyDescriptor(plan, 'iterate')?.value !== proof.iterate
        || Object.getOwnPropertyDescriptor(plan, 'size')?.value !== proof.size
        || Object.getOwnPropertyDescriptor(proof.size, 'kind')?.value !== proof.kind
        || Object.getOwnPropertyDescriptor(proof.size, 'value')?.value !== proof.count) return undefined;
    const result = proof.complete();
    const diagnostics = currentDiagnostics();
    if (result && diagnostics) diagnostics.nativeSequenceCopies++;
    return result;
}
