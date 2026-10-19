import { AstUtils, type AstNode } from 'langium';
import { isApplicationExpression, isAssignmentStatement, isDeclaredCallExpression, isForStatement, isNameExpression, isParenthesizedExpression,
    isProgram, type AssignmentStatement, type Program } from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { analyzeFunctionScopes, lexicalBinding, type LexicalBinding } from './function-scopes.js';

const candidates = new WeakMap<Program, ReadonlySet<AssignmentStatement>>();

/** Retention candidates, not a type or purity proof. Runtime capabilities decide
 * whether a candidate value can be reused. Names are resolved by lexical identity;
 * straight aliases contribute consumers to the same value's origin. */
export function sequenceRetentionCandidate(statement: AssignmentStatement): boolean {
    let root: AstNode = statement;
    while (root.$container) root = root.$container;
    if (!isProgram(root)) return false;
    let selected = candidates.get(root);
    if (!selected) {
        const analysis = analyzeFunctionScopes(root);
        const parent = new Map<LexicalBinding, LexicalBinding>();
        const aliasReads = new Set<AstNode>();
        const assignments = new Map<AssignmentStatement, LexicalBinding>();
        const representative = (binding: LexicalBinding): LexicalBinding => {
            const next = parent.get(binding);
            if (!next) return binding;
            const result = representative(next);
            parent.set(binding, result);
            return result;
        };
        for (const [node, scope] of analysis.scopes) {
            if (!isAssignmentStatement(node) || node.operator !== '=') continue;
            const target = lexicalBinding(scope, node.name);
            if (!target) continue;
            assignments.set(node, target);
            let expression = node.value;
            while (isParenthesizedExpression(expression)) expression = expression.value;
            if (!isNameExpression(expression)) continue;
            const source = lexicalBinding(scope, expression.name);
            if (!source || source.kind === 'function') continue;
            const a = representative(target), b = representative(source);
            if (a !== b) parent.set(a, b);
            aliasReads.add(expression);
        }
        const reads = new Map<AstNode, { binding: LexicalBinding; weight: number }>();
        for (const node of AstUtils.streamAllContents(root)) {
            if (!isNameExpression(node) || aliasReads.has(node)) continue;
            const binding = lexicalBinding(analysis.scopes.get(node), node.name);
            if (!binding || binding.kind === 'function') continue;
            const key = representative(binding);
            // A loop repeats consumption only when the value originates outside
            // that loop. A fresh one-consumer pipeline per iteration stays streaming.
            let repeated = false;
            for (let owner: AstNode | undefined = node.$container; owner && owner !== binding.scope.owner; owner = owner.$container) {
                if (!isForStatement(owner)) continue;
                let producer: AstNode | undefined = key.declaration;
                while (producer && producer !== owner) producer = producer.$container;
                if (!producer) repeated = true;
            }
            reads.set(node, { binding: key, weight: repeated ? 2 : 1 });
        }
        // A single syntactic argument may be traversed twice inside its helper.
        // Propagate that demand by lexical parameter identity, including helper
        // chains. Saturation at two makes recursive call graphs converge.
        const forwarded: { read: AstNode; parameter: LexicalBinding }[] = [];
        for (const node of AstUtils.streamAllContents(root)) {
            const parts = isApplicationExpression(node) ? flattenApplication(node) : undefined;
            const callee = isDeclaredCallExpression(node) ? node.callee : parts?.at(-1);
            const args = isDeclaredCallExpression(node) ? node.arguments : parts?.slice(0, -1);
            if (!callee || !args || !isNameExpression(callee)) continue;
            const binding = lexicalBinding(analysis.scopes.get(callee), callee.name);
            const definition = binding?.function;
            const scope = definition && analysis.functions.get(definition)?.scope;
            if (!definition || !scope || args.length !== definition.parameters.length) continue;
            args.forEach((argument, index) => {
                const parameter = lexicalBinding(scope, definition.parameters[index]);
                if (!parameter) return;
                // Only a passed value/alias retains the parameter's demand.
                // An expression producing a new value is a separate stage.
                while (isParenthesizedExpression(argument)) argument = argument.value;
                if (isNameExpression(argument) && reads.has(argument)) {
                    forwarded.push({ read: argument, parameter: representative(parameter) });
                }
            });
        }
        let uses = new Map<LexicalBinding, number>();
        let changed = true;
        while (changed) {
            const next = new Map<LexicalBinding, number>();
            const weights = new Map([...reads].map(([node, read]) => [node, read.weight]));
            for (const { read, parameter } of forwarded) weights.set(read, Math.max(weights.get(read)!, uses.get(parameter) ?? 1));
            for (const [node, { binding }] of reads) next.set(binding, Math.min(2, (next.get(binding) ?? 0) + weights.get(node)!));
            changed = [...next].some(([binding, count]) => uses.get(binding) !== count);
            uses = next;
        }
        selected = new Set([...assignments].filter(([, binding]) => (uses.get(representative(binding)) ?? 0) > 1)
            .map(([node]) => node));
        candidates.set(root, selected);
    }
    return selected.has(statement);
}
