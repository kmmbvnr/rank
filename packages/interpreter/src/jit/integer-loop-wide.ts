import { safeIntegerRange } from './integer-range-facts.js';
import { AstUtils, type AstNode } from 'langium';
import { forIteration, flattenApplication, isApplicationExpression, isAssignmentStatement, isArrayAssignmentStatement, isArrayExpression, isForStatement, isNameExpression, type Expression } from '@arrrank/language';
import type { IntegerLoopPlan } from './integer-loop-plan.js';

/** Keep addresses, iteration bounds and cell stores checked Numbers. Integer
 * scalars consumed by exact scalar results, predicates or formatting can remain BigInts.
 * Propagate numeric requirements backwards through every assignment, including
 * branches and loop-carried dependencies; never rely on one observed value. */
export function wideLoopScalars(plan: IntegerLoopPlan): Set<string> {
    const numeric = new Set(plan.binderNames);
    const nodes = [plan.statement, ...AstUtils.streamAllContents(plan.statement)];
    const assignments = nodes.filter(isAssignmentStatement);
    // Stable bounded definitions need no BigInt registers even when they feed
    // an exact island. Other names may have bounded and unbounded occurrences.
    const defined = new Set(assignments.map(node => node.name));
    for (const node of assignments) if (!safeIntegerRange(plan.integerRanges.definitions.get(node))) defined.delete(node.name);
    for (const slot of plan.required) defined.delete(plan.names[slot]);
    defined.forEach(name => numeric.add(name));
    const read = (node: AstNode | undefined): void => {
        if (!node || plan.exactInputs.has(node as Expression) || plan.integerRanges.narrowing.has(node as Expression)) return;
        if (isNameExpression(node)) {
            if (!numeric.has(node.name) && safeIntegerRange(plan.integerRanges.values.get(node))) return;
            numeric.add(node.name);
        }
        for (const child of AstUtils.streamContents(node)) read(child);
    };
    for (const node of nodes) {
        // Predicate arithmetic can be exact; iteration geometry still needs
        // checked Numbers, including nested range bounds and strides.
        if (isForStatement(node) && forIteration(node.condition)) read(node.condition);
        if (isArrayAssignmentStatement(node)) {
            node.indices.forEach(index => read(index.value));
            read(node.value);
        }
        if (isApplicationExpression(node)) {
            const [head, ...indices] = flattenApplication(node);
            if (isNameExpression(head) && plan.arrays.get(head.name)?.rank === indices.length) {
                indices.forEach(read);
            }
        }
        // Fresh private arrays use checked Number dimensions and fill cells,
        // just like indexed stores. Their inputs cannot become wide registers.
        if (isArrayExpression(node)) read(node);
    }
    for (const [name, type] of plan.localTypes) if (type !== 'integer') numeric.add(name);
    for (let size = -1; size !== numeric.size;) {
        size = numeric.size;
        for (const assignment of assignments) if (numeric.has(assignment.name)) read(assignment.value);
    }
    const candidates = new Set([...plan.writerNames, ...[...plan.required].map(slot => plan.names[slot])]);
    return new Set([...candidates].filter(name => plan.localTypes.get(name) === 'integer' && !numeric.has(name)));
}

/** Prefer exact outputs before widening intermediate arithmetic. An implicit
 * self-read in a compound update is safe: no other expression consumes it.
 * Every other register retains checked Number operations and exact replay. */
export function wideLoopOutputs(plan: IntegerLoopPlan, candidates: ReadonlySet<string>): Set<string> {
    const reads = new Set([plan.statement, ...AstUtils.streamAllContents(plan.statement)]
        .filter(isNameExpression).map(node => node.name));
    return new Set([...candidates].filter(name => !reads.has(name)));
}
