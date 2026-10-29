import type { CompiledExpression } from '@arrrank/language';
import type { RankValue } from '../value.js';

export type TensorNode =
    | { kind: 'reduction'; operation: 'sum' | 'count' | 'min' | 'max'; source: TensorNode; rows: boolean }
    | { kind: 'input'; name?: string; value?: RankValue }
    | { kind: 'check'; source: TensorNode; validate(cell: RankValue, index: number): RankValue; uniform?: boolean }
    | { kind: 'call'; source: TensorNode; validate(cell: RankValue, index: number): RankValue }
    | { kind: 'shift'; source: TensorNode; fill: TensorNode; amount: number; axis: number }
    | { kind: 'view'; source: TensorNode; shape: readonly number[]; offset(index: number): number }
    | { kind: 'binary'; op: string; native?: 'bxor' | 'band' | 'bor' | 'min' | 'max'; ranks?: readonly [number, number]; left: TensorNode; right: TensorNode }
    | { kind: 'outer'; op: string; left: TensorNode; right: TensorNode }
    | { kind: 'reshape'; source: TensorNode; dimensions: (TensorNode | undefined)[] }
    | { kind: 'unary'; op: string; operand: TensorNode }
    | { kind: 'concat'; sources: TensorNode[]; axis?: number }
    | { kind: 'slice'; source: TensorNode; count: TensorNode; drop: boolean }
    | { kind: 'select'; source: TensorNode; selector: TensorNode };

/** Both source expressions and function-local proofs lower scalar arithmetic
 * here. Frontends adapt their own inputs without expanding shared stages. */
export function tensorExpressionLowerer<D, I>(host: {
    input(expression: CompiledExpression<D, I>): TensorNode | undefined;
    typed(node: TensorNode, expression: CompiledExpression<D, I>): TensorNode;
}) {
    type Expression = CompiledExpression<D, I>;
    const lowered = new Map<Expression, TensorNode>();
    function lower(expression: Expression): TensorNode | undefined {
        const known = lowered.get(expression);
        if (known) return known;
        let result: TensorNode | undefined;
        if (expression.kind === 'group') result = lower(expression.operand);
        else if (expression.kind === 'unary') {
            const operand = lower(expression.operand);
            if (operand) result = host.typed({ kind: 'unary', op: expression.operation.name, operand }, expression);
        } else if (expression.kind === 'binary') {
            const left = lower(expression.left), right = lower(expression.right);
            if (left && right) result = host.typed({ kind: 'binary', op: expression.operation.name, left, right }, expression);
        } else if (expression.kind === 'literal') result = host.typed({ kind: 'input', value: expression.value }, expression);
        else result = host.input(expression);
        if (result) lowered.set(expression, result);
        return result;
    }
    return lower;
}

export function tensorChildren(node: TensorNode): readonly TensorNode[] {
    if (node.kind === 'binary' || node.kind === 'outer') return [node.left, node.right];
    if (node.kind === 'unary') return [node.operand];
    if (node.kind === 'shift') return [node.source, node.fill];
    if (node.kind === 'concat') return node.sources;
    if (node.kind === 'reshape') return [node.source, ...node.dimensions.filter((n): n is TensorNode => !!n)];
    if (node.kind === 'select') return [node.source, node.selector];
    if (node.kind === 'slice') return [node.source, node.count];
    return node.kind === 'input' ? [] : [node.source];
}

/** Reindexed shared producers need per-cell buffers. Pointwise DAGs only need
 * scalar temporaries, regardless of their number of references. */
export function tensorBufferedNodes(root: TensorNode,
    children: (node: TensorNode) => readonly TensorNode[] = tensorChildren,
    reindexes: (node: TensorNode) => boolean = node => ['outer', 'view', 'shift', 'concat'].includes(node.kind)) {
    const references = new Map<TensorNode, number>();
    const remapped = new Set<TensorNode>();
    const visited = new Map<TensorNode, number>();
    function visit(node: TensorNode, mapped: boolean): void {
        const bit = mapped ? 2 : 1, before = visited.get(node) ?? 0;
        if (before & bit) return;
        visited.set(node, before | bit);
        if (mapped) remapped.add(node);
        for (const child of children(node)) {
            if (!before) references.set(child, (references.get(child) ?? 0) + 1);
            visit(child, mapped || reindexes(node));
        }
    }
    visit(root, false);
    return new Set([...references].filter(([node, uses]) => uses > 1 && remapped.has(node)).map(([node]) => node));
}
