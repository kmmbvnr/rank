import { AstUtils, type AstNode } from 'langium';
import {
    isPrimaryTailExpression, type Program, type ApplicationExpression,
    type KeyedRollingExpression, type KeyedReachExpression, type KeyedJoinExpression,
} from './generated/ast.js';

type Fields<T extends AstNode> = Omit<T, keyof AstNode> & Pick<T, '$type'>;

/** Restore the public AST after sharing the two-operand grammar prefix. */
export function normalizePrimaryApplications(program: Program): void {
    // Keep the node objects: their CST nodes and descendants already refer to them.
    for (const node of AstUtils.streamAst(program).toArray()) {
        if (!isPrimaryTailExpression(node)) continue;
        const operator = node.operator?.replace(/\s+/g, '');
        let properties: Fields<ApplicationExpression> | Fields<KeyedRollingExpression>
            | Fields<KeyedReachExpression> | Fields<KeyedJoinExpression>;
        if (operator === undefined) {
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
        } else {
            properties = {
                $type: 'KeyedJoinExpression', left: node.head,
                right: node.argument, operator: node.operator!, fields: node.fields, pairs: node.pairs,
            };
        }
        for (const key of Object.keys(node)) {
            if (!key.startsWith('$')) Reflect.deleteProperty(node, key);
        }
        Object.assign(node, properties);
        AstUtils.linkContentToContainer(node);
    }
}
