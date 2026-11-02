import { AstUtils } from 'langium';
import { expressionFacts, isAssignmentStatement, isBinaryExpression, isForStatement, isNameExpression,
    type Expression } from '@arrrank/language';
import { loopTraversal } from '../loop-traversal.js';
import type { IntegerLoopPlan, LoopHost } from './integer-loop-plan.js';

/** Complete range passes at the start of the first condition-loop iteration.
 * Only entry scalars are inspected. Never evaluate a callback or array cell to
 * decide whether private copying is worthwhile. Later writes invalidate bounds. */
export function prepareLoopEntryWork(plan: IntegerLoopPlan, host: LoopHost): ((input: unknown[]) => number) | undefined {
    const root = plan.statement;
    if (plan.iteration || !isForStatement(root) || !root.condition || !isBinaryExpression(root.condition)
        || plan.hasControl || plan.calls.length) return undefined;
    const condition = root.condition;
    if (!['less', 'greater', 'atleast', 'atmost', 'equal', 'notequal'].includes(condition.operator)) return undefined;
    const ranges: Expression[] = [];
    const changed = new Set<string>();
    for (const statement of root.statements) {
        if (!isForStatement(statement)) break;
        const binding = host.iteration(statement.condition);
        const traversal = binding && loopTraversal(binding);
        if (!traversal || traversal.slice || !isBinaryExpression(traversal.source)
            || !['to', 'till'].includes(traversal.source.operator)
            || AstUtils.streamAst(traversal.source).some(node => isNameExpression(node) && changed.has(node.name))) break;
        ranges.push(traversal.source);
        for (const node of AstUtils.streamAst(statement)) {
            if (isAssignmentStatement(node)) changed.add(node.name);
            if (isForStatement(node)) host.iteration(node.condition)?.names.forEach(name => changed.add(name));
        }
    }
    if (!ranges.length) return undefined;
    return input => {
        const lookup = (name: string) => {
            const slot = plan.names.indexOf(name), value = input[slot];
            if (!plan.required.has(slot) || plan.localTypes.get(name) !== 'integer') return undefined;
            return typeof value === 'bigint' || typeof value === 'number'
                ? { types: ['integer' as const], rank: 0, shape: [], integer: String(value) } : undefined;
        };
        const left = expressionFacts(condition.left, lookup).integer;
        const right = expressionFacts(condition.right, lookup).integer;
        if (left === undefined || right === undefined) return 0;
        const a = BigInt(left), b = BigInt(right);
        const entered = condition.operator === 'less' ? a < b : condition.operator === 'greater' ? a > b
            : condition.operator === 'atleast' ? a >= b : condition.operator === 'atmost' ? a <= b
            : condition.operator === 'equal' ? a === b : a !== b;
        if (!entered) return 0;
        let work = 0;
        for (const range of ranges) {
            const count = expressionFacts(range, lookup).shape?.[0];
            if (count === undefined || count === null) break;
            work += count;
            if (!Number.isSafeInteger(work)) return 0;
        }
        return work;
    };
}
