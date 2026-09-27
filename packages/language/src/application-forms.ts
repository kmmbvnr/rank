import {
    isApplicationExpression, isArrayExpression, isBinaryExpression, isLabelLiteral, isNameExpression,
    type ArrayExpression, type ArrayItem, type Expression,
} from './generated/ast.js';
import { findOperation, type Operation } from './operations.js';
import { flattenApplication } from './expressions.js';

export const REDUCE_OPERATORS = new Set(['+', '-', '*', '**', '/', '//', '%', 'and', 'or', 'xor']);
export const OUTER_OPERATORS = new Set([
    '+', '-', '*', '**', '/', '//', '%',
    'equal', 'notequal', 'less', 'greater', 'atleast', 'atmost',
    'and', 'or', 'xor', 'multipleby',
]);

export interface AxisReductionForm {
    readonly kind: 'axis-reduction';
    readonly source: Expression;
    readonly operation: Operation;
    readonly axes: readonly Expression[];
}

export interface SortDirectionForm {
    readonly kind: 'sort-direction';
    readonly operation: Operation;
    readonly direction: Expression;
}

export interface AxisLengthForm {
    readonly kind: 'axis-length';
    readonly source: Expression;
    readonly axis: Expression;
}

/** Identify `Value len axis N` before either consumer interprets N. */
export function axisLengthForm(
    parts: readonly Expression[], standard: (name: string) => boolean = () => true,
): AxisLengthForm | undefined {
    if (parts.length !== 4 || !isNamed(parts[1], 'len') || !isNamed(parts[2], 'axis')
        || !standard('len') || !standard('axis')) return undefined;
    return { kind: 'axis-length', source: parts[0], axis: parts[3] };
}

/** Recognize a trailing sort direction, including invalid labels for runtime diagnostics. */
export function sortDirectionForm(
    parts: readonly Expression[], standard: (name: string) => boolean = () => true,
): SortDirectionForm | undefined {
    const direction = parts.at(-1);
    if (parts.length <= 2 || !direction || !(isLabelLiteral(direction)
        || isNameExpression(direction) && /^[A-Z]/.test(direction.name))) return undefined;
    const operation = parts.slice(0, -1).find(part => isNameExpression(part)
        && standard(part.name) && findOperation(part.name)?.sortDirection);
    if (!operation || !isNameExpression(operation)) return undefined;
    return { kind: 'sort-direction', operation: findOperation(operation.name)!, direction };
}

/** Recognize a reduction form without evaluating its axes or consulting runtime values. */
export function axisReductionForm(
    parts: readonly Expression[],
    standard: (name: string) => boolean = () => true,
): AxisReductionForm | undefined {
    if (parts.length < 4 || !isNameExpression(parts[1])
        || !isNameExpression(parts[2]) || parts[2].name !== 'axis'
        || !standard(parts[1].name)) return undefined;
    const operation = findOperation(parts[1].name);
    if (!operation?.axisReduction) return undefined;
    return { kind: 'axis-reduction', source: parts[0], operation, axes: parts.slice(3) };
}

function isNamed(expression: Expression | undefined, name: string): boolean {
    return isNameExpression(expression) && expression.name === name;
}

export type SymbolicApplicationForm =
    | { readonly kind: 'outer'; readonly operator: string; readonly operands: readonly Expression[] }
    | { readonly kind: 'segment'; readonly operator: string; readonly source: Expression }
    | { readonly kind: 'scan'; readonly operator: string; readonly source: Expression; readonly seed?: Expression }
    | { readonly kind: 'reduce'; readonly operator: string; readonly source: Expression;
        readonly rank?: Expression; readonly seed?: Expression };

/** Recognize the current symbolic modifier syntax once for runtime and analysis. */
export function symbolicApplicationForm(
    expression: Expression, standard: (name: string) => boolean = () => true,
): SymbolicApplicationForm | undefined {
    if (!isBinaryExpression(expression)) return undefined;
    const parts = isApplicationExpression(expression.right)
        ? flattenApplication(expression.right) : [expression.right];
    if (OUTER_OPERATORS.has(expression.operator) && isNamed(parts[0], 'outer')
        && parts.length === 1 && standard('outer')) {
        return { kind: 'outer', operator: expression.operator,
            operands: flattenApplication(expression.left) };
    }
    if (!REDUCE_OPERATORS.has(expression.operator)) return undefined;
    if (parts.length === 1 && isNamed(parts[0], 'segment') && standard('segment')) {
        return { kind: 'segment', operator: expression.operator, source: expression.left };
    }
    if (isNamed(parts[0], 'scan') && standard('scan')) {
        if (parts.length === 1) return { kind: 'scan', operator: expression.operator,
            source: expression.left };
        if (parts.length === 3 && isNamed(parts[1], 'with')) return {
            kind: 'scan', operator: expression.operator, source: expression.left, seed: parts[2],
        };
    }
    if (isNamed(parts[0], 'reduce') && standard('reduce')) {
        if (parts.length === 1) return { kind: 'reduce', operator: expression.operator,
            source: expression.left };
        if (parts.length === 3 && isNamed(parts[1], 'with')) return {
            kind: 'reduce', operator: expression.operator, source: expression.left, seed: parts[2],
        };
        if ((parts.length === 3 || parts.length === 5) && isNamed(parts[1], 'rank')
            && (parts.length === 3 || isNamed(parts[3], 'with'))) return {
            kind: 'reduce', operator: expression.operator, source: expression.left,
            rank: parts[2], seed: parts[4],
        };
    }
    return undefined;
}

export function explicitLowerBoundApplication(
    parts: Expression[],
): { source: Expression; limit: Expression } | undefined {
    if (parts.length !== 3 || !isNamed(parts[1], 'from')) return undefined;
    return { source: parts[0], limit: parts[2] };
}

export function explicitMaterializePipeline(parts: Expression[]): {
    readonly source: readonly Expression[];
    readonly selector: ArrayExpression;
    readonly steps: readonly ArrayItem[];
} | undefined {
    const position = parts.findIndex((part, index) => index > 0
        && isArrayExpression(part)
        && part.dimensions.length === 0
        && part.items.length > 0
        && part.items.every(item => !item.sign));
    if (position < 0 || position !== parts.length - 1) return undefined;
    const selector = parts[position] as ArrayExpression;
    return { source: parts.slice(0, position), selector, steps: selector.items };
}

export interface NamedOuterApplication {
    readonly left: Expression;
    readonly right: Expression;
    readonly operation: Expression;
}

export function explicitNamedOuterApplication(parts: Expression[]): NamedOuterApplication | undefined {
    if (parts.length !== 4 || !isNamed(parts[3], 'outer')) return undefined;
    return {
        left: parts[0],
        right: parts[1],
        operation: parts[2],
    };
}

export interface NamedSegmentApplication {
    readonly identity?: Expression;
    readonly source: Expression;
    readonly operation: Expression;
}

export interface NamedScanApplication {
    readonly seed?: Expression;
    readonly source: Expression;
    readonly operation: Expression;
}

export function explicitNamedScanApplication(parts: Expression[]): NamedScanApplication | undefined {
    if (parts.length === 5 && isNamed(parts[2], 'scan') && isNamed(parts[3], 'with')) {
        return { source: parts[0], seed: parts[4], operation: parts[1] };
    }
    if (parts.length === 3 && isNamed(parts[2], 'scan')) {
        return { source: parts[0], operation: parts[1] };
    }
    return undefined;
}

export function explicitNamedSegmentApplication(parts: Expression[]): NamedSegmentApplication | undefined {
    if (parts.length === 5 && isNamed(parts[2], 'segment') && isNamed(parts[3], 'with')) {
        return { source: parts[0], identity: parts[4], operation: parts[1] };
    }
    if (parts.length !== 3 || !isNamed(parts[2], 'segment')) return undefined;
    return { source: parts[0], operation: parts[1] };
}

export interface MultisetMethodApplication {
    readonly receiver: Expression[];
    readonly operation: 'floor' | 'ceiling' | 'lowerbound' | 'upperbound';
    readonly argument: Expression[];
}

export interface CollectionMutationApplication {
    readonly receiver: Expression;
    readonly operation: 'add' | 'remove';
    readonly value: Expression;
    readonly arguments?: readonly Expression[];
}

export function explicitCollectionMutation(
    expression: Expression,
): CollectionMutationApplication | undefined {
    if (isBinaryExpression(expression)) {
        const mutation = explicitCollectionMutation(expression.left);
        if (!mutation) return undefined;
        return {
            ...mutation,
            value: { ...expression, left: mutation.value } as Expression,
            arguments: undefined,
        };
    }
    if (!isApplicationExpression(expression)) return undefined;
    const parts = flattenApplication(expression);
    if (explicitNamedScanApplication(parts) || explicitNamedSegmentApplication(parts)) return undefined;
    const receiver = parts[0];
    const operation = parts[1];
    if (!isNameExpression(receiver)
        || !/^[A-Z]/.test(receiver.name)
        || parts.length < 3) return undefined;
    if (!isNameExpression(operation)
        || (operation.name !== 'add' && operation.name !== 'remove')) return undefined;
    const values = parts.slice(2);
    const value = values.length === 1 ? values[0] : {
        $type: 'ApplicationExpression',
        head: values[0],
        arguments: values.slice(1),
    } as Expression;
    return {
        receiver,
        operation: operation.name,
        value,
        arguments: values,
    };
}

export function explicitMultisetMethod(parts: Expression[]): MultisetMethodApplication | undefined {
    const operations = ['floor', 'ceiling', 'lowerbound', 'upperbound'] as const;
    const position = parts.findIndex((part, index) =>
        index > 0 && index < parts.length - 1
        && operations.some(operation => isNamed(part, operation)));
    if (position < 0) return undefined;
    const operation = operations.find(candidate => isNamed(parts[position], candidate))!;
    return {
        receiver: parts.slice(0, position),
        operation,
        argument: parts.slice(position + 1),
    };
}

export interface GraphEdgesApplication {
    readonly receiver: Expression;
    readonly operation: Expression;
    readonly argument: Expression;
}

export interface DsuMethodApplication {
    readonly receiver: Expression;
    readonly operation: 'find' | 'merge' | 'connected';
    readonly operationExpression: Expression;
    readonly arguments: readonly Expression[];
}

export interface FunctionalMethodApplication {
    readonly receiver: Expression;
    readonly operation: 'jump' | 'distance';
    readonly operationExpression: Expression;
    readonly arguments: readonly Expression[];
}

export function explicitFunctionalMethod(
    parts: Expression[],
): FunctionalMethodApplication | undefined {
    if (parts.length !== 4 || !isNameExpression(parts[1])) return undefined;
    const operation = parts[1].name;
    if (operation !== 'jump' && operation !== 'distance') return undefined;
    return {
        receiver: parts[0], operation, operationExpression: parts[1],
        arguments: parts.slice(2),
    };
}

export function explicitDsuMethod(parts: Expression[]): DsuMethodApplication | undefined {
    if (parts.length !== 3 && parts.length !== 4) return undefined;
    const operation = isNameExpression(parts[1]) ? parts[1].name : undefined;
    if (operation === 'find' && parts.length === 3) {
        return {
            receiver: parts[0], operation, operationExpression: parts[1],
            arguments: parts.slice(2),
        };
    }
    if ((operation === 'merge' || operation === 'connected') && parts.length === 4) {
        return {
            receiver: parts[0], operation, operationExpression: parts[1],
            arguments: parts.slice(2),
        };
    }
    return undefined;
}

export function explicitGraphEdges(parts: Expression[]): GraphEdgesApplication | undefined {
    if (parts.length !== 3 || !isNamed(parts[1], 'edges')) return undefined;
    return {
        receiver: parts[0],
        operation: parts[1],
        argument: parts[2],
    };
}
