import { isAssignmentStatement, isArrayAssignmentStatement, isForStatement, isIfStatement, isBreakStatement, isContinueStatement, isReturnStatement, isNameExpression, isBinaryExpression } from '@arrrank/language';
import { entryWorkValues, prepareEntryWorkProof } from './entry-work-proof.js';
import { hasNativeArrayHeader, integer32Cells, integer64Cells } from '../array-storage.js';
import { ownedStorage } from '../array-storage-state.js';
import { loopTraversal, primeLoopBounds } from '../loop-traversal.js';
import type { IntegerLoopPlan, LoopHost } from './integer-loop-plan.js';

/** Lower bound on complete passes in a vector or finite-range loop. Inspect
 * a bounded set of entry positions, never callbacks or body array cells. Later
 * iterations are usable only without an escaping jump or mutable entry bounds.
 * This decides copy cost only; Number guards and exact replay remain mandatory. */
export function prepareVectorEntryWork(plan: IntegerLoopPlan, host: LoopHost):
    ((input: unknown[], target: number) => number) | undefined {
    const root = plan.statement, binding = plan.iteration;
    if (!binding || !isForStatement(root) || !plan.destinations.size && ![...plan.containers.values()].some(info => info.kind === 'fenwick')
        || plan.calls.some(call => !call.privateStateSafe || !call.numberSafe || !plan.builtins.has(call.name))
        || plan.callouts?.length || plan.hasYield) return undefined;
    const traversal = loopTraversal(binding);
    if (!traversal || traversal.slice) return undefined;
    const source = traversal.source;
    const primes = primeLoopBounds(source);
    const range = !primes && isBinaryExpression(source) && ['to', 'till'].includes(source.operator) ? source : undefined;
    if (!range && !primes && !isNameExpression(source)) return undefined;
    // Locations include every lowered statement, including nested branches.
    if (plan.locations.some(node => !isAssignmentStatement(node) && !isArrayAssignmentStatement(node)
        && !isForStatement(node) && !isIfStatement(node) && !isBreakStatement(node)
        && !isContinueStatement(node) && !isReturnStatement(node))) return undefined;
    const name = isNameExpression(source) ? source.name : undefined;
    const proof = prepareEntryWorkProof(plan, host), body = proof.block(root.statements);
    if (!body.hasWork || name && (body.writes.has(name) || binding.names.includes(name) || plan.destinations.has(name))) return undefined;
    const changed = new Set([...body.writes, ...binding.names]);
    const rangeCount = range && proof.range(range), rangeStart = range && proof.integer(range.left);
    const rangeStep = range?.step ? proof.integer(range.step) : () => 1n;
    const primeBounds = primes?.map(bound => ({ ...bound, read: proof.integer(bound.value) }));
    return (input, target) => {
        const base = entryWorkValues(plan, input, changed);
        if (primes) {
            let lower = 2n, upper: bigint | undefined;
            for (const bound of primeBounds!) {
                const value = bound.read(base);
                if (value === undefined) return 0;
                if (bound.upper) upper = value - (bound.inclusive ? 0n : 1n);
                else lower = value + (bound.inclusive ? 0n : 1n);
            }
            // These are static mathematical facts, not execution of the
            // deferred prime plan. Other starts retain conservative admission.
            if (upper === undefined || lower >= PRIME_PREFIX_LIMIT || traversal.reverse && upper >= PRIME_PREFIX_LIMIT) return 0;
            const entries = smallPrimes.filter(prime => prime >= lower && prime <= upper!);
            if (traversal.reverse) entries.reverse();
            let work = 0;
            for (let ordinal = 0; ordinal < entries.length; ordinal++) {
                if (body.escapes && ordinal) break;
                const values = new Map(base);
                if (binding.names[0] !== '#') values.set(binding.names[0], entries[ordinal]);
                if (binding.names[1] && binding.names[1] !== '#') values.set(binding.names[1], BigInt(ordinal));
                const result = body.run(values, target - work);
                work += result.work;
                if (work >= target || result.flow === 'break' || result.flow === 'unknown') break;
            }
            return work;
        }
        if (range) {
            const count = rangeCount!(base), first = rangeStart!(base);
            const step = rangeStep(base);
            if (!count || first === undefined || step === undefined || step === 0n) return 0;
            let work = 0;
            // With every back-edge write and induction name removed, a
            // complete invariant body proves work in every range iteration.
            if (!body.exits) {
                const uniform = body.run(new Map(base), target);
                if (uniform.flow === 'next' && uniform.work > 0) {
                    const perIteration = 1 + uniform.work;
                    work = count >= target / perIteration ? target : count * perIteration;
                    if (work >= target) return work;
                    // Boundary sampling below must not count these cells again.
                    work = 0;
                }
            }
            // Boundary passes can amortize a large snapshot.
            // Only guarded entry facts are inspected, never body arrays.
            const ordinals = entryOrdinals(count, body.escapes);
            for (const ordinal of ordinals) {
                const values = new Map(base);
                if (binding.names[0] !== '#') values.set(binding.names[0], first + BigInt(ordinal) * step);
                if (binding.names[1] && binding.names[1] !== '#') values.set(binding.names[1], BigInt(ordinal));
                const result = body.run(values, target - work);
                work += result.work;
                if (work >= target || result.flow === 'break' || result.flow === 'unknown') break;
            }
            return work;
        }
        if (!name) return 0;
        const value = host.read(name);
        if (!value || !hasNativeArrayHeader(value) || value.shape.length !== 1) return 0;
        const cells = integer32Cells(value) ?? integer64Cells(value);
        if (!cells || !cells.length || cells.length !== value.shape[0]) return 0;
        for (const destination of plan.destinations.keys()) {
            if (plan.arrayDefinitions.has(destination) && !plan.arrayInputs.has(destination)) continue;
            const other = host.read(destination);
            if (!other || !hasNativeArrayHeader(other)) return 0;
            const buffer = ownedStorage.get(other)?.typed;
            if (other === value || buffer?.buffer === cells.buffer) return 0;
        }
        let work = 0;
        // Count distinct boundary passes; a descending sieve may have
        // its largest passes at the end. Do not inspect later entries
        // after a possible escaping jump.
        const ordinals = entryOrdinals(cells.length, body.escapes);
        for (const ordinal of ordinals) {
            const values = new Map(base), at = traversal.reverse ? cells.length - 1 - ordinal : ordinal;
            if (binding.names[0] !== '#') values.set(binding.names[0], BigInt(cells[at]));
            if (binding.names[1] && binding.names[1] !== '#') values.set(binding.names[1], BigInt(ordinal));
            const result = body.run(values, target - work);
            work += result.work;
            const flow = result.flow;
            if (work >= target || flow === 'break' || flow === 'unknown') return work;
        }
        return work;
    };
}

// Use the existing 256-position proof scale. Derive only small, immutable
// prime facts here: no sequence plan, callback, global sieve or user cell runs.
const PRIME_PREFIX_LIMIT = 256n;
const smallPrimes = (() => {
    const composite = new Uint8Array(Number(PRIME_PREFIX_LIMIT)), values: bigint[] = [];
    for (let prime = 2; prime < composite.length; prime++) {
        if (composite[prime]) continue;
        values.push(BigInt(prime));
        for (let multiple = prime * prime; multiple < composite.length; multiple += prime) composite[multiple] = 1;
    }
    return values;
})();

/** Inspect actual distinct boundary entries, never extrapolated values. A
 * descending harmonic pass can be tiny at its start and large at its end.
 * This bounds proof effort, without changing the snapshot or Number limits. */
function entryOrdinals(count: number, escapes: boolean): number[] {
    if (escapes) return [0];
    const width = Math.min(256, count);
    return [...new Set([...Array.from({ length: width }, (_, i) => i),
        ...Array.from({ length: width }, (_, i) => count - 1 - i)])];
}
