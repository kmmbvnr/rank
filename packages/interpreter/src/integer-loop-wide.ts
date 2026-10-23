import { AstUtils, type AstNode } from 'langium';
import { isAssignmentStatement, isArrayAssignmentStatement, isForStatement, isIfStatement, isNameExpression } from '@arrrank/language';
import type { IntegerLoopPlan } from './integer-loop-plan.js';

/** Keep control, addresses and numeric cell stores checked Numbers. Integer
 * scalars that only feed other scalar results can instead remain exact BigInts.
 * Propagate numeric requirements backwards through every assignment, including
 * branches and loop-carried dependencies; never rely on one observed value. */
export function wideLoopScalars(plan: IntegerLoopPlan): Set<string> {
    const numeric = new Set(plan.binderNames);
    const nodes = [plan.statement, ...AstUtils.streamAllContents(plan.statement)];
    const assignments = nodes.filter(isAssignmentStatement);
    const read = (node: AstNode | undefined) => {
        if (!node) return;
        for (const part of [node, ...AstUtils.streamAllContents(node)]) {
            if (isNameExpression(part)) numeric.add(part.name);
        }
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
    }
    for (const [name, type] of plan.localTypes) if (type !== 'integer') numeric.add(name);
    for (let size = -1; size !== numeric.size;) {
        size = numeric.size;
        for (const assignment of assignments) if (numeric.has(assignment.name)) read(assignment.value);
    }
    return new Set(plan.writerNames.filter(name => plan.localTypes.get(name) === 'integer' && !numeric.has(name)));
}
