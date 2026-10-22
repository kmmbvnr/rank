import { AstUtils, type AstNode } from 'langium';
import {
    isAssignmentStatement, isFunctionStatement, isNameExpression,
    type AssignmentStatement, type FunctionStatement, type NameExpression, type Program,
} from '../generated/ast.js';
import { functionCallSignature } from '../function-call-signature.js';
import { analyzeBindings } from './bindings.js';
import { bindingMutationSites } from './function-mutations.js';
import { analyzeFunctionScopes, lexicalBinding, type LexicalBinding } from './function-scopes.js';

export interface DeferredBindingDiagnostic {
    readonly node: AstNode;
    /** The plan binding or parameter declaration that prohibited the write. */
    readonly source: AstNode;
    readonly message: string;
}

const references = new WeakMap<Program, ReadonlyMap<AssignmentStatement, readonly NameExpression[]>>();

/** Actual source reads, shared by static diagnostics and runtime scope protection. */
export function deferredBindingReferences(statement: AssignmentStatement): readonly NameExpression[] {
    let root: AstNode = statement;
    while (root.$container) root = root.$container;
    if (root.$type !== 'Program') return [];
    const program = root as Program;
    let known = references.get(program);
    if (!known) {
        const reads = new Set<AstNode>();
        analyzeBindings(program, [], new Map(), node => reads.add(node));
        known = new Map([...AstUtils.streamAllContents(program)].filter(isAssignmentStatement)
            .filter(node => node.deferred).map(node => [node, [...AstUtils.streamAst(node.value)]
                .filter(isNameExpression).filter(read => reads.has(read))]));
        references.set(program, known);
    }
    return known.get(statement) ?? [];
}

export function deferredBindingMessage(name: string, plan?: string): string {
    return plan
        ? `${name} is read-only because plan ${plan} reads it; copy it before mutation.`
        : `${name} is a deferred parameter and is read-only; bind a computed local value before mutation.`;
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
        for (const read of deferredBindingReferences(node)) {
            const scope = analysis.scopes.get(read);
            const binding = lexicalBinding(scope, read.name)
                ?? lexicalBinding(scope, read.name.split('.')[0]);
            protect(binding, node, node.$cstNode ? node.$cstNode.offset + node.$cstNode.length : 0, node.name);
        }
    }
    const diagnostics: DeferredBindingDiagnostic[] = [];
    for (const [node, bindings] of bindingMutationSites(analysis)) for (const binding of bindings) {
        const protection = protectedNames.get(binding);
        if (!protection || (node.$cstNode?.offset ?? 0) <= protection.offset) continue;
        diagnostics.push({ node, source: protection.source,
            message: deferredBindingMessage(binding.name, protection.plan),
        });
    }
    diagnostics.sort((left, right) => (left.node.$cstNode?.offset ?? 0) - (right.node.$cstNode?.offset ?? 0));
    return diagnostics;
}
