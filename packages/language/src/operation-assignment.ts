import { AstUtils, GrammarUtils, type AstNode } from 'langium';
import { isFunctionBindingStatement, isFunctionStatement, isNameExpression, isUseStatement,
    type Program } from './generated/ast.js';
import type { GroupingOptions } from './expression-grouping.js';
import { findOperation } from './operations.js';

/** Resolve overloaded statement syntax before function preparation adds parameter scopes. */
export function resolveOperationAssignments(program: Program, options: GroupingOptions): void {
    const modules = new Set(options.modules ?? ['core']);
    for (const node of AstUtils.streamAllContents(program)) if (isUseStatement(node) && node.module) modules.add(node.module);
    const visit = (node: AstNode, aliases: Map<string, string>): void => {
        if (isFunctionStatement(node)) {
            const local = new Map(aliases);
            for (const name of node.parameters) local.delete(name);
            for (const statement of node.statements) visit(statement, local);
            return;
        }
        if (isFunctionBindingStatement(node)) {
            const original = aliases.get(node.name);
            const operation = findOperation(original ?? node.name);
            const available = original !== undefined || operation && modules.has(operation.module);
            if (node.parameters.length && operation && available) {
                const positions = GrammarUtils.findNodesForProperty(node.$cstNode, 'parameters');
                const indices = node.parameters.map((name, index) => ({ $type: 'AddressItem',
                    value: { $type: 'NameExpression', name, $cstNode: positions[index] }, $cstNode: positions[index] }));
                const mutable = node as unknown as Record<string, unknown>;
                mutable.$type = 'OperationAssignmentStatement';
                mutable.indices = indices;
                mutable.operator = '=';
                delete mutable.parameters;
                AstUtils.linkContentToContainer(node);
            } else if (!node.parameters.length) {
                const name = isNameExpression(node.value) ? node.value.name : undefined;
                const source = name && (aliases.get(name) ?? name);
                const entry = source ? findOperation(source) : undefined;
                if (entry?.write && (aliases.has(name!) || modules.has(entry.module))) aliases.set(node.name, entry.name);
                else aliases.delete(node.name);
            }
        }
        for (const child of AstUtils.streamContents(node)) visit(child, aliases);
    };
    const aliases = new Map(options.writableOperations);
    for (const statement of program.statements) visit(statement, aliases);
}
