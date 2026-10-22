import { AstUtils, type AstNode } from 'langium';
import {
    isArrayAssignmentStatement, isOperationAssignmentStatement, isPushStatement,
    isOptionStatement, isArgumentStatement, isFlagStatement,
    isAssignmentStatement, isFunctionBindingStatement, isFunctionStatement, isForStatement,
    isIfStatement, isNameExpression, isTestStatement, isTryStatement, isUnpackStatement,
    type FunctionStatement, type Program, type Statement,
} from '../generated/ast.js';
import { analyzeBindings } from './bindings.js';
import { flattenApplication, forIteration } from '../expressions.js';
import { functionBindingPlan } from '../function-binding.js';
import { functionCallSignature } from '../function-call-signature.js';
import { findOperation } from '../operations.js';
import { programExternalBindings, programFunctionDeclarations } from '../expression-grouping.js';

/** Identity is the binding object, not its spelling or source position. */
export interface LexicalBinding {
    readonly name: string;
    readonly scope: LexicalScope;
    readonly declaration: AstNode;
    readonly kind: 'data' | 'parameter' | 'function';
    readonly function?: FunctionStatement;
}

export interface LexicalScope {
    readonly parent?: LexicalScope;
    /** Blocks retain their enclosing function owner; tests start a fresh owner. */
    readonly owner: AstNode;
    readonly bindings: ReadonlyMap<string, LexicalBinding>;
}

export interface FunctionScope {
    readonly scope: LexicalScope;
    readonly reads: ReadonlyMap<AstNode, LexicalBinding>;
    readonly captures: ReadonlySet<LexicalBinding>;
    readonly callees: ReadonlySet<FunctionStatement>;
    readonly externalEffects: ReadonlySet<string>;
}

export interface FunctionScopeAnalysis {
    readonly functions: ReadonlyMap<FunctionStatement, FunctionScope>;
    readonly scopes: ReadonlyMap<AstNode, LexicalScope>;
    readonly diagnostics: readonly { node: AstNode; message: string }[];
}

/** Resolve a spelling in its lexical environment, including later declarations. */
export function lexicalBinding(scope: LexicalScope | undefined, name: string): LexicalBinding | undefined {
    for (let current = scope; current; current = current.parent) {
        const binding = current.bindings.get(name);
        if (binding) return binding;
    }
    return undefined;
}

/**
 * Function dependency identities shared by scope diagnostics and lazy snapshots.
 * Block availability remains the responsibility of blockScopeDiagnostics. This
 * pass retains separate block bindings even when their spellings are equal.
 */
export function analyzeFunctionScopes(program: Program): FunctionScopeAnalysis {
    const cached = analyses.get(program);
    if (cached) return cached;
    const scopes = new Map<AstNode, LexicalScope>();
    const functions = new Map<FunctionStatement, {
        scope: LexicalScope; reads: Map<AstNode, LexicalBinding>;
        captures: Set<LexicalBinding>; callees: Set<FunctionStatement>; externalEffects: Set<string>;
    }>();
    const diagnostics: { node: AstNode; message: string }[] = [];
    const scope = (owner: AstNode, parent?: LexicalScope): LexicalScope => ({ owner, parent, bindings: new Map() });
    const root = scope(program);
    const bind = (target: LexicalScope, name: string, declaration: AstNode,
        kind: LexicalBinding['kind'] = 'data', definition?: FunctionStatement): void => {
        if (name === '#' || target.bindings.has(name) && target.bindings.get(name)!.declaration !== program) return;
        (target.bindings as Map<string, LexicalBinding>).set(name,
            { name, scope: target, declaration, kind, function: definition });
    };
    for (const name of programExternalBindings(program)) bind(root, name, program);
    const local = (target: LexicalScope, name: string, node: AstNode): void => {
        // A block updates an existing binding in its own function. It never
        // turns an enclosing function's binding into a writable local.
        const existing = lexicalBinding(target, name);
        if (existing?.scope.owner === target.owner) return;
        bind(target, name, node);
        if (isFunctionStatement(target.owner) && existing && isFunctionStatement(existing.scope.owner)) {
            diagnostics.push({ node, message: `${name} is bound in an enclosing function; pass it as a parameter or use a different local name.` });
        }
    };
    const mark = (node: AstNode, target: LexicalScope): void => {
        scopes.set(node, target);
        for (const child of AstUtils.streamContents(node)) mark(child, target);
    };
    const body = (statements: readonly Statement[], target: LexicalScope): void => {
        // Direct assignments and functions are visible to nested declarations
        // regardless of source order. Sequential availability is checked elsewhere.
        for (const node of statements) {
            if (isFunctionStatement(node)) bind(target, node.name, node, 'function', node);
            else if (isAssignmentStatement(node) && node.operator === '=' && !node.name.includes('.')) local(target, node.name, node);
            else if (isUnpackStatement(node)) node.names.forEach(name => local(target, name, node));
            else if (isFunctionBindingStatement(node)) local(target, node.name, node);
            else if (isOptionStatement(node) || isArgumentStatement(node) || isFlagStatement(node)) local(target, node.name, node);
        }
        for (const node of statements) {
            mark(node, target);
            if (isFunctionStatement(node)) {
                const inner = scope(node, target);
                for (const parameter of functionCallSignature(node).parameters) bind(inner, parameter.name, node, 'parameter');
                functions.set(node, { scope: inner, reads: new Map(), captures: new Set(), callees: new Set(), externalEffects: new Set() });
                body(node.statements, inner);
            } else if (isFunctionBindingStatement(node)) {
                for (const definition of functionBindingPlan(node).definitions) {
                    const inner = scope(definition, target);
                    for (const parameter of functionCallSignature(definition).parameters) bind(inner, parameter.name, definition, 'parameter');
                    functions.set(definition, { scope: inner, reads: new Map(), captures: new Set(), callees: new Set(), externalEffects: new Set() });
                    body(definition.statements, inner);
                }
            } else if (isTestStatement(node)) {
                body(node.statements, scope(node, root));
            } else if (isForStatement(node)) {
                const inner = scope(target.owner, target);
                for (const name of forIteration(node.condition)?.names ?? []) local(inner, name, node);
                body(node.statements, inner);
            } else if (isIfStatement(node)) {
                body(node.thenStatements, scope(target.owner, target));
                for (const clause of node.elifClauses) body(clause.statements, scope(target.owner, target));
                body(node.elseStatements, scope(target.owner, target));
            } else if (isTryStatement(node)) {
                body(node.statements, scope(target.owner, target));
                for (const clause of node.catches) {
                    const inner = scope(target.owner, target);
                    local(inner, clause.errorName, clause);
                    body(clause.statements, inner);
                }
                body(node.finallyStatements, scope(target.owner, target));
            }
        }
    };
    scopes.set(program, root);
    body(program.statements, root);
    // Imported and earlier notebook declarations retain their original lexical
    // identities. Include their bodies so callback escape and mutation proofs
    // inspect the actual helper rather than trusting its signature alone.
    const importedPrograms = new Set<Program>();
    for (const [name, definition] of programFunctionDeclarations(program)) {
        bind(root, name, definition, 'function', definition);
        let owner: AstNode = definition;
        while (owner.$container) owner = owner.$container;
        if (owner === program || owner.$type !== 'Program') continue;
        const importedProgram = owner as Program;
        if (importedPrograms.has(importedProgram)) continue;
        importedPrograms.add(importedProgram);
        const imported = analyzeFunctionScopes(importedProgram);
        for (const [node, lexical] of imported.scopes) if (!scopes.has(node)) scopes.set(node, lexical);
        for (const [fn, info] of imported.functions) if (!functions.has(fn)) functions.set(fn, {
            scope: info.scope, reads: new Map(info.reads), captures: new Set(info.captures),
            callees: new Set(info.callees), externalEffects: new Set(info.externalEffects),
        });
    }
    // The existing binding walk distinguishes actual reads from receiver
    // methods, loop binders, modifier words, labels and builtin syntax.
    const readNodes: AstNode[] = [];
    const bindingFacts = analyzeBindings(program, [], new Map(), node => readNodes.push(node));
    const externalNames = new Set(bindingFacts.words.map(word => word.name));
    readNodes.forEach(node => {
        const target = scopes.get(node);
        if (!target || !isFunctionStatement(target.owner)) return;
        const info = functions.get(target.owner)!;
        const name = isNameExpression(node) ? node.name
            : isAssignmentStatement(node) || isArrayAssignmentStatement(node) || isOperationAssignmentStatement(node) ? node.name : undefined;
        if (!name) return;
        let binding = lexicalBinding(target, name);
        if (!binding) {
            const operation = findOperation(name);
            if (operation?.effects?.some(effect => effect === 'io' || effect === 'random')) info.externalEffects.add(name);
            if (operation || !externalNames.has(name)) return;
            bind(root, name, node);
            binding = root.bindings.get(name)!;
        }
        info.reads.set(node, binding);
        if (binding.function) info.callees.add(binding.function);
        else if (binding.scope.owner !== target.owner) info.captures.add(binding);
    });
    // Recursion and mutually recursive helpers converge on binding identities.
    // A callee's own locals are never dependencies of its caller.
    let changed = true;
    while (changed) {
        changed = false;
        for (const [definition, info] of functions) {
            for (const callee of info.callees) {
                const called = functions.get(callee);
                for (const captured of called?.captures ?? []) {
                    if (captured.scope.owner === definition || info.captures.has(captured)) continue;
                    info.captures.add(captured);
                    changed = true;
                }
                for (const effect of called?.externalEffects ?? []) {
                    if (info.externalEffects.has(effect)) continue;
                    info.externalEffects.add(effect);
                    changed = true;
                }
            }
        }
    }
    for (const [node, target] of scopes) {
        if (!isFunctionStatement(target.owner)) continue;
        let name: string | undefined;
        if (isArrayAssignmentStatement(node) || isOperationAssignmentStatement(node)
            || isAssignmentStatement(node) && node.operator !== '=') name = node.name;
        else if (isPushStatement(node)) {
            const receiver = flattenApplication(node.receiver)[0];
            if (isNameExpression(receiver)) name = receiver.name;
        }
        const binding = name && lexicalBinding(target, name);
        if (binding && binding.scope.owner !== target.owner) diagnostics.push({ node,
            message: `${name} is read-only in ${target.owner.name}; pass mutable state explicitly as a parameter.` });
    }
    for (const [definition, info] of functions) {
        if (!definition.memo) continue;
        for (const binding of info.captures) diagnostics.push({ node: definition,
            message: `memo ${definition.name} depends on external data ${binding.name}; pass it as a parameter.` });
        for (const effect of info.externalEffects) diagnostics.push({ node: definition,
            message: `memo ${definition.name} uses ${effect}, which has external effects.` });
    }
    const result = { functions, scopes, diagnostics };
    analyses.set(program, result);
    return result;
}

const analyses = new WeakMap<Program, FunctionScopeAnalysis>();

/** Parsed declaration trees are immutable during execution. */
export function functionScope(definition: FunctionStatement): FunctionScope | undefined {
    let root: AstNode = definition;
    while (root.$container) root = root.$container;
    if (root.$type !== 'Program') return undefined;
    const program = root as Program;
    let analysis = analyses.get(program);
    if (!analysis) {
        analysis = analyzeFunctionScopes(program);
        analyses.set(program, analysis);
    }
    return analysis.functions.get(definition);
}
