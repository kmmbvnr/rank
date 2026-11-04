import { isAssignmentStatement, isArrayAssignmentStatement, isForStatement, isIfStatement, isBreakStatement, isContinueStatement, isReturnStatement, isNameExpression, isBinaryExpression } from '@arrrank/language';
import { entryWorkValues, prepareEntryWorkProof } from './entry-work-proof.js';
import { hasNativeArrayHeader, integer32Cells, integer64Cells } from '../array-storage.js';
import { ownedStorage } from '../array-storage-state.js';
import { loopTraversal } from '../loop-traversal.js';
import type { IntegerLoopPlan, LoopHost } from './integer-loop-plan.js';

/** Lower bound on complete passes in a vector or finite-range loop. Inspect
 * a bounded set of entry positions, never callbacks or body array cells. Later
 * iterations are usable only without an escaping jump or mutable entry bounds.
 * This decides copy cost only; Number guards and exact replay remain mandatory. */
export function prepareVectorEntryWork(plan: IntegerLoopPlan, host: LoopHost):
    ((input: unknown[], target: number) => number) | undefined {
    const root = plan.statement, binding = plan.iteration;
    if (!binding || !isForStatement(root) || !plan.destinations.size
        || plan.calls.some(call => !call.privateStateSafe || !call.numberSafe || !plan.builtins.has(call.name))
        || plan.callouts?.length || plan.hasYield) return undefined;
    const traversal = loopTraversal(binding);
    if (!traversal || traversal.slice) return undefined;
    const source = traversal.source;
    const range = isBinaryExpression(source) && ['to', 'till'].includes(source.operator) ? source : undefined;
    if (!range && !isNameExpression(source)) return undefined;
    // Locations include every lowered statement, including nested branches.
    if (plan.locations.some(node => !isAssignmentStatement(node) && !isArrayAssignmentStatement(node)
        && !isForStatement(node) && !isIfStatement(node) && !isBreakStatement(node)
        && !isContinueStatement(node) && !isReturnStatement(node))) return undefined;
    const name = isNameExpression(source) ? source.name : undefined;
    const proof = prepareEntryWorkProof(plan, host), body = proof.block(root.statements);
    if (!body.hasWork || name && (body.writes.has(name) || binding.names.includes(name) || plan.destinations.has(name))) return undefined;
    const changed = new Set([...body.writes, ...binding.names]);
    return (input, target) => {
        const base = entryWorkValues(plan, input, changed);
        if (range) {
            const count = proof.range(range)(base), first = proof.integer(range.left)(base);
            const step = range.step ? proof.integer(range.step)(base) : 1n;
            if (!count || first === undefined || step === undefined || step === 0n) return 0;
            let work = 0;
            // Three leading harmonic passes can amortize a large snapshot.
            // Only arithmetic entry facts are inspected, never body arrays.
            const ordinals = body.escapes ? [0] : [...new Set([0, Math.min(1, count - 1), Math.min(2, count - 1), count - 1])];
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
        // Two leading sieve passes can pay for the copy even when the last
        // pass is tiny. Deduplicate short vectors; keep the same bounded proof
        // and do not inspect later entries after a possible escaping jump.
        const ordinals = body.escapes ? [0] : [...new Set([0, Math.min(1, cells.length - 1), cells.length - 1])];
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
