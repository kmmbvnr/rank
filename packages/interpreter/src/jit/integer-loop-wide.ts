import { safeIntegerRange, integerRange, type IntegerRange } from './integer-range-facts.js';
import { AstUtils, type AstNode } from 'langium';
import { expressionFacts, forIteration, flattenApplication, isApplicationExpression, isAssignmentStatement, isArrayAssignmentStatement, isArrayExpression, isForStatement, isNameExpression, isIfStatement, isUnpackStatement, type Statement, type Expression } from '@arrrank/language';
import type { IntegerLoopPlan } from './integer-loop-plan.js';

/** Keep addresses, iteration bounds and cell stores checked Numbers. Integer
 * scalars consumed by exact scalar results, predicates or formatting can remain BigInts.
 * Propagate numeric requirements backwards through every assignment, including
 * branches and loop-carried dependencies; never rely on one observed value. */
export function wideLoopScalars(plan: IntegerLoopPlan): Set<string> {
    // Private numeric vector stages cannot hold BigInt registers. Their
    // scalar dependencies must stay checked Numbers; exact consumers may
    // still read those completed cells as BigInts.
    const numeric = new Set([...plan.binderNames, ...plan.arrayDefinitions]);
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

/** Widen external exact inputs and their scalar consumers before widening
 * independent intermediates. Every remaining Number operation is checked;
 * overflow retains the broader mixed tier and the exact fallback. */
export function wideLoopBoundary(plan: IntegerLoopPlan, candidates: ReadonlySet<string>, outputs: ReadonlySet<string>): Set<string> {
    const boundary = new Set([...outputs, ...[...plan.required]
        .map(slot => plan.names[slot]).filter(name => candidates.has(name))]);
    const dependencies = [plan.statement, ...AstUtils.streamAllContents(plan.statement)]
        .filter(isAssignmentStatement).filter(node => candidates.has(node.name))
        .map(node => ({ name: node.name, reads: [node.value, ...AstUtils.streamAllContents(node.value)]
            .filter(isNameExpression).map(read => read.name) }));
    for (let size = -1; size !== boundary.size;) {
        size = boundary.size;
        for (const { name, reads } of dependencies) if (reads.some(read => boundary.has(read))) boundary.add(name);
    }
    return boundary;
}

/** Prefer the exact output tier when even the full safe-integer input interval
 * cannot contain a normally completing additive recurrence. This is a source
 * proof, never a sampled value or a permission to bypass mutation/entry guards.
 * Unknown trip counts, resets and control transfers retain speculative entry. */
export function overflowingLoopOutput(plan: IntegerLoopPlan): boolean {
    if (!isForStatement(plan.statement) || plan.hasControl) return false;
    function repeat(range: IntegerRange | undefined, loop: Statement): IntegerRange | undefined {
        if (!range || range[0] === 0n && range[1] === 0n) return range;
        if (!isForStatement(loop)) return undefined;
        const binding = forIteration(loop.condition);
        const count = binding && expressionFacts(binding.iterable, () => undefined).shape?.[0];
        return count !== undefined && count !== null && Number.isSafeInteger(count) && count >= 0
            ? integerRange('*', range, [BigInt(count), BigInt(count)]) : undefined;
    }
    function block(statements: readonly Statement[], name: string): IntegerRange | undefined {
        let total: IntegerRange | undefined = [0n, 0n];
        for (const statement of statements) {
            let change: IntegerRange | undefined = [0n, 0n];
            if (isAssignmentStatement(statement) && statement.name === name) {
                const value = plan.integerRanges.values.get(statement.value);
                change = statement.operator === '+=' ? value : statement.operator === '-=' && value ? [-value[1], -value[0]] : undefined;
            } else if (isUnpackStatement(statement) && statement.names.includes(name)) return undefined;
            else if (isForStatement(statement)) change = repeat(block(statement.statements, name), statement);
            else if (isIfStatement(statement)) {
                const paths = [statement.thenStatements, ...statement.elifClauses.map(branch => branch.statements), statement.elseStatements]
                    .map(statements => block(statements, name));
                if (paths.some(path => !path)) return undefined;
                change = paths.reduce<IntegerRange>((bounds, path) => [bounds[0] < path![0] ? bounds[0] : path![0],
                    bounds[1] > path![1] ? bounds[1] : path![1]], paths[0]!);
            }
            total = integerRange('+', total, change);
            if (!total) return undefined;
        }
        return total;
    }
    const span = 2n * BigInt(Number.MAX_SAFE_INTEGER);
    for (const name of wideLoopOutputs(plan, wideLoopScalars(plan))) {
        const growth = repeat(block(plan.statement.statements, name), plan.statement);
        if (growth && (growth[0] > span || growth[1] < -span)) return true;
    }
    return false;
}

/** A local-storage helper can do substantial work before returning a wide
 * scalar. If only exact outputs consume it, keep that call exact instead of
 * discarding the caller's completed prefix when its result cannot narrow. */
export function localCallLoopOutput(plan: IntegerLoopPlan): boolean {
    const calls = new Set(plan.calls.flatMap(call => call.exactOutput ? [call.exactOutput] : []));
    if (!calls.size) return false;
    const outputs = wideLoopOutputs(plan, wideLoopScalars(plan));
    return [plan.statement, ...AstUtils.streamAllContents(plan.statement)].some(node =>
        isAssignmentStatement(node) && outputs.has(node.name)
        && [node.value, ...AstUtils.streamAllContents(node.value)].some(value => calls.has(value as Expression)));
}
