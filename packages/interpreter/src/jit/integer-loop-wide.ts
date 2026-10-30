import { AstUtils, type AstNode } from 'langium';
import { flattenApplication, isApplicationExpression, isAssignmentStatement, isArrayAssignmentStatement, isArrayExpression, isForStatement, isIfStatement, isNameExpression, type Expression } from '@arrrank/language';
import type { IntegerLoopPlan } from './integer-loop-plan.js';

/** Keep addresses, numeric control and cell stores checked Numbers. Integer
 * scalars consumed by exact scalar results, predicates or formatting can remain BigInts.
 * Propagate numeric requirements backwards through every assignment, including
 * branches and loop-carried dependencies; never rely on one observed value. */
export function wideLoopScalars(plan: IntegerLoopPlan): Set<string> {
    const numeric = new Set(plan.binderNames);
    const nodes = [plan.statement, ...AstUtils.streamAllContents(plan.statement)];
    const assignments = nodes.filter(isAssignmentStatement);
    const read = (node: AstNode | undefined): void => {
        if (!node || plan.exactInputs.has(node as Expression)) return;
        if (isNameExpression(node)) numeric.add(node.name);
        for (const child of AstUtils.streamContents(node)) read(child);
    };
    for (const node of nodes) {
        if (isForStatement(node)) read(node.condition);
        if (isIfStatement(node)) {
            read(node.condition);
            node.elifClauses.forEach(branch => read(branch.condition));
        }
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
