import { applicationExpression, attachedSign, flattenApplication } from './expressions.js';
import { AstUtils, type AstNode } from 'langium';
import {
    isBinaryExpression, isLabelLiteral, isNumberLiteral, isUnaryExpression, type Expression,
    isPrimaryTailExpression, isNameExpression, type Program, type ApplicationExpression,
    type KeyedGroupExpression, type KeyedSortExpression,
    type KeyedRollingExpression, type KeyedReachExpression, type KeyedJoinExpression,
    type KeyedMergeExpression, type TableWriteExpression,
} from './generated/ast.js';

type Fields<T extends AstNode> = Omit<T, keyof AstNode> & Pick<T, '$type'>;

const SORT_BY_WORDS = new Set(['sort', 'argsort', 'merge']);
const GROUP_BY_WORDS = new Set(['group', 'rollup']);

/** Restore the public AST after sharing the two-operand grammar prefix. */
export function normalizePrimaryApplications(program: Program): void {
    // Keep the node objects: their CST nodes and descendants already refer to them.
    for (const node of AstUtils.streamAst(program).toArray()) {
        if (!isPrimaryTailExpression(node)) continue;
        const tailArguments = [...(node.secondArgument ? [node.secondArgument] : []), ...node.arguments];
        let properties: Fields<ApplicationExpression> | Fields<KeyedGroupExpression>
            | Fields<KeyedSortExpression> | Fields<KeyedRollingExpression>
            | Fields<KeyedReachExpression> | Fields<KeyedJoinExpression> | Fields<KeyedMergeExpression>
            | Fields<TableWriteExpression>;
        if (!node.clause && isNameExpression(node.argument) && node.argument.name === 'insert'
            && tailArguments.length > 0 && tailArguments.every(isNameExpression) && !node.values.length) {
            properties = {
                $type: 'TableWriteExpression', source: node.head,
                sourceFields: [], values: tailArguments as TableWriteExpression['values'], entries: [],
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
        } else if (!node.secondArgument && node.clause === 'by') {
            const word = isNameExpression(node.argument) ? node.argument.name : undefined;
            if (word && GROUP_BY_WORDS.has(word) && node.sortFields.length > 0 && node.sortFields.every(field => !field.direction)) {
                properties = {
                    $type: 'KeyedGroupExpression', source: node.head,
                    operator: `${word} by`, fields: node.sortFields.map(field => field.field),
                };
            } else if (word && SORT_BY_WORDS.has(word)) {
                properties = {
                    $type: 'KeyedSortExpression', source: node.head,
                    operator: `${word} by`, fields: node.sortFields,
                    key: node.sortKey, direction: node.direction,
                };
            } else {
                properties = {
                    $type: 'ApplicationExpression', head: node.head,
                    arguments: [node.argument, ...node.sortFields.map(field => field.field), ...(node.sortKey ? [node.sortKey] : [])],
                };
            }
        } else if (node.secondArgument && (node.clause === 'by' || node.clause === 'on')) {
            const word = isNameExpression(node.secondArgument) ? node.secondArgument.name : undefined;
            if (word === 'rolling' && node.clause === 'by' && node.sortFields.length === 1 && !node.sortFields[0].direction) {
                properties = {
                    $type: 'KeyedRollingExpression', source: node.head,
                    width: node.argument, operator: 'rolling by', field: node.sortFields[0].field,
                };
            } else if (word === 'reach' && node.clause === 'by' && node.sortFields.length === 2
                && node.sortFields.every(field => !field.direction)) {
                properties = {
                    $type: 'KeyedReachExpression', edges: node.head,
                    starts: node.argument, operator: 'reach by',
                    from: node.sortFields[0].field, to: node.sortFields[1].field,
                };
            } else if (word === 'merge' && node.clause === 'by') {
                properties = {
                    $type: 'KeyedMergeExpression', left: node.head, right: node.argument,
                    operator: 'merge by', fields: node.sortFields,
                    key: isNameExpression(node.sortKey) ? node.sortKey : undefined,
                    direction: node.direction,
                };
            } else if ((word === 'leftjoin' || word === 'innerjoin') && node.clause === 'by'
                && node.sortFields.length > 0 && node.sortFields.every(field => !field.direction)) {
                properties = {
                    $type: 'KeyedJoinExpression', left: node.head, right: node.argument,
                    operator: `${word} by`, fields: node.sortFields.map(field => field.field), pairs: [],
                };
            } else if ((word === 'leftjoin' || word === 'innerjoin') && node.clause === 'on') {
                properties = {
                    $type: 'KeyedJoinExpression', left: node.head, right: node.argument,
                    operator: `${word} on`, fields: [], pairs: node.pairs,
                };
            } else {
                properties = {
                    $type: 'ApplicationExpression', head: node.head,
                    arguments: [node.argument, node.secondArgument, ...node.sortFields.map(field => field.field), ...(node.sortKey ? [node.sortKey] : [])],
                };
            }
        } else {
            properties = {
                $type: 'ApplicationExpression', head: node.head,
                arguments: [node.argument, ...tailArguments],
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
