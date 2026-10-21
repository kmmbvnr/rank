import { AstUtils, type AstNode } from 'langium';
import {
    isArrayAssignmentStatement, isAssignmentStatement, isFunctionStatement,
    isNameExpression, isOperationAssignmentStatement,
    type AssignmentStatement, type FunctionStatement, type Program,
} from '../generated/ast.js';
import { functionCallSignature } from '../function-call-signature.js';
import { analyzeBindings } from './bindings.js';
import { analyzeFunctionScopes, lexicalBinding, type LexicalBinding } from './function-scopes.js';

export interface DeferredBindingDiagnostic {
    readonly node: AstNode;
    /** The plan binding or parameter declaration that prohibited the write. */
    readonly source: AstNode;
    readonly message: string;
}

/** A deferred binding protects the names it reads, independently of plan lifetime.
 * Use lexical identities from the existing scope pass; rebinding never creates
 * a fresh writable identity, while a shadowing parameter does. */
export function deferredBindingDiagnostics(program: Program): DeferredBindingDiagnostic[] {
    const plans: AssignmentStatement[] = [];
    const parameters: { definition: FunctionStatement; name: string; source: AstNode }[] = [];
    for (const node of AstUtils.streamAllContents(program)) {
        if (isAssignmentStatement(node) && node.deferred) plans.push(node);
        if (isFunctionStatement(node)) {
            const bindings = [...node.leftBindings, ...node.rightBindings, ...node.groups];
            for (const parameter of functionCallSignature(node).parameters) {
                if (parameter.deferred) parameters.push({ definition: node, name: parameter.name,
                    source: bindings[parameter.index] });
            }
        }
    }
    if (!plans.length && !parameters.length) return [];
    const analysis = analyzeFunctionScopes(program);
    const reads = new Set<AstNode>();
    if (plans.length) analyzeBindings(program, [], new Map(), node => reads.add(node));
    const protectedNames = new Map<LexicalBinding, { source: AstNode; offset: number; plan?: string }>();
    const protect = (binding: LexicalBinding | undefined, source: AstNode, offset: number, plan?: string) => {
        if (!binding) return;
        const previous = protectedNames.get(binding);
        if (!previous || offset < previous.offset) protectedNames.set(binding, { source, offset, plan });
    };
    for (const { definition, name, source } of parameters) {
        protect(lexicalBinding(analysis.functions.get(definition)?.scope, name), source, -Infinity);
    }
    for (const node of plans) {
        for (const read of AstUtils.streamAst(node.value)) {
            if (!isNameExpression(read) || !reads.has(read)) continue;
            const scope = analysis.scopes.get(read);
            const binding = lexicalBinding(scope, read.name)
                ?? lexicalBinding(scope, read.name.split('.')[0]);
            protect(binding, node, node.$cstNode?.offset ?? 0, node.name);
        }
    }
    const diagnostics: DeferredBindingDiagnostic[] = [];
    for (const node of AstUtils.streamAllContents(program)) {
        if (!(isArrayAssignmentStatement(node) || isOperationAssignmentStatement(node)
            || isAssignmentStatement(node) && node.operator !== '=')) continue;
        const binding = lexicalBinding(analysis.scopes.get(node), node.name);
        const protection = binding && protectedNames.get(binding);
        if (!protection || (node.$cstNode?.offset ?? 0) <= protection.offset) continue;
        diagnostics.push({ node, source: protection.source,
            message: protection.plan
                ? `${node.name} is read-only because plan ${protection.plan} reads it; copy it before mutation.`
                : `${node.name} is a deferred parameter and is read-only; bind a computed local value before mutation.`,
        });
    }
    return diagnostics;
}
