import { applicationExpression, attachedSign, flattenApplication } from './expressions.js';
import { AstUtils, type AstNode } from 'langium';
import {
    isBinaryExpression, isLabelLiteral, isNumberLiteral, isUnaryExpression, type Expression,
    isPrimaryTailExpression, isNameExpression, type Program, type ApplicationExpression,
    type KeyedRollingExpression, type KeyedReachExpression, type KeyedJoinExpression,
    type KeyedMergeExpression, type TableWriteExpression,
} from './generated/ast.js';

type Fields<T extends AstNode> = Omit<T, keyof AstNode> & Pick<T, '$type'>;

/** Restore the public AST after sharing the two-operand grammar prefix. */
export function normalizePrimaryApplications(program: Program): void {
    // Keep the node objects: their CST nodes and descendants already refer to them.
    for (const node of AstUtils.streamAst(program).toArray()) {
        if (!isPrimaryTailExpression(node)) continue;
        const operator = node.operator?.replace(/\s+/g, '');
        let properties: Fields<ApplicationExpression> | Fields<KeyedRollingExpression>
            | Fields<KeyedReachExpression> | Fields<KeyedJoinExpression> | Fields<KeyedMergeExpression>
            | Fields<TableWriteExpression>;
        if (isNameExpression(node.argument) && node.argument.name === 'insert'
            && node.arguments.length > 0 && node.arguments.every(isNameExpression) && !node.values.length) {
            properties = {
                $type: 'TableWriteExpression', source: node.head,
                sourceFields: [], values: node.arguments as TableWriteExpression['values'], entries: [],
            };
        } else if (isLabelLiteral(node.argument) && (node.values.length > 0 || node.entries.length > 0 || node.deleteWrite)) {
            properties = {
                $type: 'TableWriteExpression', source: node.head,
                sourceFields: [node.argument], values: node.values, entries: node.entries,
            };
        } else if (node.values.length > 0 || node.entries.length > 0 || node.deleteWrite) {
            properties = {
                $type: 'ApplicationExpression', head: node.head,
                arguments: [node.argument, ...node.values],
            };
        } else if (operator === undefined) {
            properties = {
                $type: 'ApplicationExpression', head: node.head,
                arguments: [node.argument, ...node.arguments],
            };
        } else if (operator === 'rollingby') {
            properties = {
                $type: 'KeyedRollingExpression', source: node.head,
                width: node.argument, operator: node.operator!, field: node.field!,
            };
        } else if (operator === 'reachby') {
            properties = {
                $type: 'KeyedReachExpression', edges: node.head,
                starts: node.argument, operator: node.operator!, from: node.from!, to: node.to!,
            };
        } else if (operator === 'mergeby') {
            properties = {
                $type: 'KeyedMergeExpression', left: node.head, right: node.argument,
                operator: node.operator!, fields: node.fields as KeyedMergeExpression['fields'], key: node.key,
                direction: node.direction,
            };
        } else {
            properties = {
                $type: 'KeyedJoinExpression', left: node.head,
                right: node.argument, operator: node.operator!, fields: node.fields as KeyedJoinExpression['fields'], pairs: node.pairs,
            };
        }
        for (const key of Object.keys(node)) {
            if (!key.startsWith('$')) Reflect.deleteProperty(node, key);
        }
        Object.assign(node, properties);
        AstUtils.linkContentToContainer(node);
    }
    // A glued minus after axis belongs to its literal, including symbolic folds
    // and implicit pipelines. Spaced subtraction keeps its arithmetic meaning.
    for (const node of AstUtils.streamAst(program).toArray().reverse()) {
        if (!isBinaryExpression(node) || !attachedSign(node)) continue;
        const left = isBinaryExpression(node.left) ? node.left.right : node.left;
        const parts = flattenApplication(left);
        const marker = parts.map(part => isNameExpression(part) && part.name === 'axis').lastIndexOf(true);
        if (marker < 0 || !parts.slice(marker + 1).every(part => isNumberLiteral(part)
            || isUnaryExpression(part) && part.operator === '-' && isNumberLiteral(part.operand))) continue;
        const right = flattenApplication(node.right);
        if (!isNumberLiteral(right[0])) continue;
        const signed = { $type: 'UnaryExpression', operator: '-', operand: right[0],
            $cstNode: node.right.$cstNode } as Expression;
        const call = applicationExpression([...parts, signed, ...right.slice(1)], node);
        const replacement = isBinaryExpression(node.left) ? { ...node.left, right: call, $cstNode: node.$cstNode } : call;
        for (const key of Object.keys(node)) if (!key.startsWith('$')) Reflect.deleteProperty(node, key);
        Object.assign(node, replacement);
        AstUtils.linkContentToContainer(node);
    }
}
