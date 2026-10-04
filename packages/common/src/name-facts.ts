import { AstUtils, CstUtils, GrammarUtils, type AstNode, type LeafCstNode } from 'langium';
import {
    analyzeValues, applicationForm, formatTypeSignature, signatureType, describeTypes, findOperation, functionSignature, operationSignature, operatorSignature, flattenApplication, isApplicationExpression, isArrayAssignmentStatement, isAssignmentStatement, isBinaryExpression, isForStatement,
    isExpression, isFunctionStatement, isNameExpression, isUnaryExpression, isUnpackStatement,
    type Expression, type ForStatement, type FunctionStatement, type ImportedFunction, type Program, type ValueFacts,
} from '@arrrank/language';
import { parse } from '@arrrank/interpreter';
import { cellWidth } from './display-width.js';

export interface NameFacts {
    readonly name: string;
    readonly facts: ValueFacts;
    readonly source: 'runtime' | 'static';
    readonly signature?: string;
}

/** A function the live preview calls with example arguments, so its parameters have facts. */
export interface NameFactsExample {
    readonly name: string;
    readonly arguments: readonly ValueFacts[];
}

const UNKNOWN: ValueFacts = { types: [] };
const FUNCTION: ValueFacts = { types: ['function'] };

/**
 * The cells before an unexecuted draft: what they bind, and which functions they declare. A draft
 * has not run, so a name it writes never takes the run's facts for an earlier value.
 */
export interface NameFactsScope {
    readonly bindings: ReadonlyMap<string, ValueFacts>;
    readonly functions: ReadonlyMap<string, FunctionStatement>;
    readonly imports?: ReadonlyMap<string, ImportedFunction>;
}

/**
 * Analyzes `source` once; the returned lookup answers any offset. `sessionFacts` are trusted:
 * the caller passes only facts of cells that were executed and have not changed since.
 */
export function nameFactsIn(source: string, sessionFacts: readonly (readonly [string, ValueFacts])[] = [],
    examples: readonly NameFactsExample[] = [], scope?: NameFactsScope,
    loadModule?: (specifier: string) => Program | undefined): ((offset: number) => NameFacts | undefined) | undefined {
    let program: Program;
    try { program = parse(source); } catch { return undefined; }
    const root = program.$cstNode;
    if (!root) return undefined;
    const runtime = new Map(sessionFacts);
    let analysis: ReturnType<typeof analyzeValues>;
    try { analysis = analyzeValues(program, scope ? new Map(scope.bindings) : runtime,
        new Map(scope?.functions), examples.map(example => ({ ...example })), loadModule, scope?.imports); } catch { return undefined; }

    const written = scope ? writtenNames(program) : new Set<string>();
    /** A catalogue name that nothing in the notebook or the run has bound is a function. */
    const isCatalogueFunction = (site: Site): boolean => site.kind === 'read' && !analysis.bindings.has(site.name)
        && !runtime.has(site.name) && !written.has(site.name) && !!findOperation(site.name)?.arities.length;
    const rebound = writtenNames(program);
    /** A name nothing binds (no assignment, loop, parameter, function or run) has no facts to show. */
    const isDefined = (site: Site): boolean => {
        if (analysis.bindings.has(site.name) || runtime.has(site.name) || rebound.has(site.name)
            || analysis.functions.has(site.name) || scope?.bindings.has(site.name)) return true;
        for (let parent = site.node.$container; parent; parent = parent.$container) {
            if (isFunctionStatement(parent) && parent.parameters.includes(site.name)) return true;
        }
        return false;
    };
    const callFacts = (site: Site): { arguments: ValueFacts[]; result?: ValueFacts } | undefined => {
        if (!isNameExpression(site.node)) return undefined;
        let call: AstNode = site.node;
        while (isApplicationExpression(call.$container)) call = call.$container;
        if (!isApplicationExpression(call)) return undefined;
        const parts = flattenApplication(call);
        return parts.at(-1) === site.node ? {
            arguments: parts.slice(0, -1).map(part => analysis.expressions.get(part) ?? UNKNOWN),
            result: analysis.expressions.get(call),
        } : undefined;
    };
    const signatureFor = (site: Site): string | undefined => {
        const actualName = isNameExpression(site.node) ? site.node.name : site.name;
        for (let parent = site.node.$container; parent; parent = parent.$container) {
            if (isFunctionStatement(parent) && parent.parameters.includes(actualName)) return undefined;
        }
        if (site.kind === 'form' && !analysis.bindings.has(actualName) && !runtime.has(actualName)) {
            for (let node: AstNode | undefined = site.node.$container; node && isExpression(node); node = node.$container) {
                const form = applicationForm(node);
                if (form.kind === 'segment' || form.kind === 'named-segment') {
                    const inputs = [signatureType(analysis.expressions.get(form.source) ?? UNKNOWN)];
                    if (form.kind === 'named-segment') {
                        const isMaxSum = isNameExpression(form.operation) && form.operation.name === 'maxsum'
                            && !analysis.bindings.has('maxsum') && !runtime.has('maxsum');
                        if (!isMaxSum) inputs.push({ callback: { inputs: ['unknown', 'unknown'], result: 'unknown' } });
                        if (form.identity) inputs.push(signatureType(analysis.expressions.get(form.identity) ?? UNKNOWN));
                    }
                    return formatTypeSignature({ inputs, result: 'segment' });
                }
                const operands = form.kind === 'outer' ? form.operands
                    : form.kind === 'named-outer' ? [form.left, form.right, form.operation] : undefined;
                if (operands) {
                    const result = analysis.expressions.get(node);
                    return formatTypeSignature({
                        inputs: operands.map(operand => form.kind === 'named-outer' && operand === form.operation
                            ? 'function' : signatureType(analysis.expressions.get(operand) ?? UNKNOWN)),
                        // Every successful outer call builds an array; cell types still need analyzer evidence.
                        result: signatureType(result?.types.length ? result : { types: ['array'] }),
                    });
                }
            }
            return undefined;
        }
        if (site.kind === 'operator') {
            const node = site.node;
            const operands = isBinaryExpression(node) ? [node.left, node.right]
                : isUnaryExpression(node) ? [node.operand] : [];
            return operatorSignature(site.name, operands.map(operand => analysis.expressions.get(operand) ?? UNKNOWN));
        }
        const call = callFacts(site);
        if (isCatalogueFunction(site)) return operationSignature(findOperation(site.name)!, call?.arguments);
        if (site.kind !== 'function' && site.kind !== 'read' && site.kind !== 'form') return undefined;
        if (site.kind !== 'function' && rebound.has(site.name)) return undefined;
        const definition = isFunctionStatement(site.node) ? site.node : analysis.functions.get(site.name);
        if (!definition) return undefined;
        const relationship = analysis.relationships.get(definition);
        if (call?.arguments.length === definition.parameters.length) {
            return functionSignature(definition, { ...call, relationship });
        }
        const observed = analysis.functions.get(site.name) === definition
            ? examples.flatMap((example, index) => example.name === site.name
                ? [{ arguments: example.arguments, result: analysis.functionResults[index] }] : []) : [];
        return observed.length ? [...new Set(observed.map(facts => functionSignature(definition, { ...facts, relationship })))].join(' ; ')
            : functionSignature(definition, { relationship });
    };

    return offset => {
        const site = [offset, offset - 1].map(at => nameSite(root, at)).find(found => found !== undefined);
        if (!site) return undefined;
        const inFunction = AstUtils.getContainerOfType(site.node, isFunctionStatement);
        if (site.kind === 'operator' || site.kind === 'form') {
            const signature = signatureFor(site);
            if (signature) return { name: site.name, source: 'static', facts: FUNCTION, signature };
        }
        const observed = runtime.get(site.name);
        if (observed && !inFunction && site.kind !== 'parameter' && !written.has(site.name)) {
            // A run records no element types; the analyzer's agree with it only when type, rank and shape do.
            const inferred = analysis.bindings.get(site.name);
            const same = inferred && observed.types.join() === inferred.types.join() && observed.rank === inferred.rank
                && observed.shape?.length === inferred.shape?.length
                && observed.shape?.every((size, axis) => inferred.shape![axis] === size);
            const elements = same && !observed.elements ? inferred.elements : undefined;
            return { name: site.name, source: 'runtime', facts: { ...observed, ...(elements ? { elements } : {}) },
                ...(observed.types.join() === 'function' ? { signature: signatureFor(site) } : {}) };
        }
        const facts = isCatalogueFunction(site) ? FUNCTION : staticFacts(site, analysis);
        if (site.kind === 'read' && !facts.types.length && !isDefined(site)) return undefined;
        return { name: site.name, source: 'static', facts,
            ...(facts.types.join() === 'function' ? { signature: signatureFor(site) } : {}) };
    };
}

/**
 * The facts of the name under the cursor: a read, an assignment target, a loop name, a
 * parameter or a function name. The cursor right after a name counts as on it. A name the
 * session executed reports the run's facts; every other name reports what the analyzer
 * proves without running, or `unknown`.
 */
export function factsAt(source: string, offset: number, sessionFacts: readonly (readonly [string, ValueFacts])[] = [],
    examples: readonly NameFactsExample[] = []): NameFacts | undefined {
    return nameFactsIn(source, sessionFacts, examples)?.(offset);
}

function writtenNames(program: Program): Set<string> {
    const names = new Set<string>();
    for (const node of AstUtils.streamAllContents(program)) {
        if (isAssignmentStatement(node) || isArrayAssignmentStatement(node)) names.add(node.name);
        else if (isUnpackStatement(node)) node.names.forEach(name => names.add(name));
        else if (isForStatement(node)) loopNames(node).forEach(name => names.add(name));
    }
    return names;
}

interface Site {
    readonly name: string;
    readonly node: AstNode;
    readonly kind: 'read' | 'assignment' | 'loop' | 'parameter' | 'unpack' | 'function' | 'operator' | 'form';
}

function nameSite(root: NonNullable<Program['$cstNode']>, offset: number): Site | undefined {
    if (offset < 0) return undefined;
    const leaf = CstUtils.findLeafNodeAtOffset(root, offset);
    if (!leaf || offset < leaf.offset || offset >= leaf.end || leaf.hidden) return undefined;
    const node = leaf.astNode;
    const text = leaf.text;
    if (isBinaryExpression(node) || isUnaryExpression(node)) {
        const parts = GrammarUtils.findNodesForProperty(node.$cstNode, 'operator');
        if (parts.some(part => leaf.offset >= part.offset && leaf.end <= part.end)
            && operatorSignature(node.operator)) {
            return { name: parts.map(part => part.text).join(' ').replace(/\s+/g, ' ').trim(), node, kind: 'operator' };
        }
    }
    if (isNameExpression(node)) {
        if (['outer', 'segment', 'maxsum'].includes(node.name) && (text === node.name || text.split(/\s+/)[0] === node.name)) {
            return { name: text.replace(/\s+/g, ' '), node, kind: 'form' };
        }
        return node.name === text ? { name: text, node, kind: loopOf(node) ? 'loop' : 'read' } : undefined;
    }
    if (isAssignmentStatement(node) || isArrayAssignmentStatement(node)) {
        return ownsLeaf(node, 'name', leaf) ? { name: text, node, kind: 'assignment' } : undefined;
    }
    if (isFunctionStatement(node)) {
        if (ownsLeaf(node, 'name', leaf)) return { name: text, node, kind: 'function' };
        return GrammarUtils.findNodesForProperty(node.$cstNode, 'parameters').some(part => part.offset === leaf.offset)
            ? { name: text, node, kind: 'parameter' } : undefined;
    }
    if (isUnpackStatement(node)) {
        return GrammarUtils.findNodesForProperty(node.$cstNode, 'names').some(part => part.offset === leaf.offset)
            && text !== '#' ? { name: text, node, kind: 'unpack' } : undefined;
    }
    return undefined;
}

function ownsLeaf(node: AstNode, property: string, leaf: LeafCstNode): boolean {
    return GrammarUtils.findNodeForProperty(node.$cstNode, property)?.offset === leaf.offset;
}

/** The loop whose `names in iterable` header binds this name expression. */
function loopOf(node: AstNode): ForStatement | undefined {
    const loop = AstUtils.getContainerOfType(node, isForStatement);
    const condition = loop?.condition;
    if (!loop || !isBinaryExpression(condition) || condition.operator !== 'in') return undefined;
    return AstUtils.streamAllContents(condition.left).includes(node) || condition.left === node ? loop : undefined;
}

function staticFacts(site: Site, analysis: ReturnType<typeof analyzeValues>): ValueFacts {
    const { node, name } = site;
    const known = (expression: Expression): ValueFacts => analysis.expressions.get(expression) ?? UNKNOWN;
    switch (site.kind) {
        case 'form': case 'read': {
            if (analysis.functions.has(name)) return FUNCTION;
            return known(node as Expression);
        }
        case 'function': return FUNCTION;
        case 'assignment':
            return isAssignmentStatement(node) && node.operator === '=' ? known(node.value) : UNKNOWN;
        case 'loop': return bodyRead(loopOf(node)!, name, analysis);
        case 'parameter': return bodyRead(node as FunctionStatement, name, analysis);
        default: return UNKNOWN;
    }
}

/**
 * A loop name or parameter has no value of its own in the tree; its facts are those the
 * analyzer gave the first read in the body, unless the body writes the name first.
 */
function bodyRead(scope: ForStatement | FunctionStatement, name: string,
    analysis: ReturnType<typeof analyzeValues>): ValueFacts {
    const body = [...AstUtils.streamAllContents(scope)].filter(node => !isInHeader(node, scope));
    if (body.some(node => (isAssignmentStatement(node) || isArrayAssignmentStatement(node)) && node.name === name
        || isUnpackStatement(node) && node.names.includes(name)
        || isForStatement(node) && node !== scope && loopNames(node).includes(name))) return UNKNOWN;
    const read = body.find(node => isNameExpression(node) && node.name === name && analysis.expressions.has(node));
    return read ? analysis.expressions.get(read as Expression)! : UNKNOWN;
}

function isInHeader(node: AstNode, scope: ForStatement | FunctionStatement): boolean {
    if (!isForStatement(scope) || !scope.condition) return false;
    for (let current: AstNode | undefined = node; current; current = current.$container) {
        if (current === scope.condition) return true;
    }
    return false;
}

function loopNames(loop: ForStatement): string[] {
    const condition = loop.condition;
    if (!isBinaryExpression(condition) || condition.operator !== 'in') return [];
    return [...AstUtils.streamAllContents(condition.left)].filter(isNameExpression).map(part => part.name)
        .concat(isNameExpression(condition.left) ? [condition.left.name] : []);
}

/** How a fact reads in a report: its element type, and its shape when every axis is known. */
export function describeFacts(facts: ValueFacts, withShape = true): string {
    if (facts.types.join() === 'function') return 'function';
    if (!facts.types.length) return 'unknown';
    const shaped = facts.types[0] !== 'text' && facts.shape !== undefined && facts.shape.length > 0;
    const base = shaped && facts.types.join() === 'array' && facts.elements?.length
        ? describeTypes(facts.elements) : describeTypes(facts.types);
    if (!withShape || !shaped || facts.shape!.some(size => size === null)) return base;
    return `${base} [${facts.shape!.join(' ')}]`;
}

/**
 * `M · integer [3 4]`, `Row · text`, `X · unknown`. When the line does not fit, the shape
 * goes first, then the front of the name.
 */
export function formatNameFacts(found: NameFacts, width = Infinity): string {
    const full = `${found.name} · ${found.signature ?? describeFacts(found.facts)}`;
    if (cellWidth(full) <= width) return full;
    const bare = `${found.name} · ${found.signature ?? describeFacts(found.facts, false)}`;
    if (cellWidth(bare) <= width) return bare;
    const suffix = ` · ${found.signature ?? describeFacts(found.facts, false)}`;
    let name = found.name;
    while (name.length > 1 && cellWidth(`${name}…${suffix}`) > width) name = name.slice(0, -1);
    const clipped = `${name}…${suffix}`;
    return cellWidth(clipped) <= width ? clipped
        : width > 1 ? [...clipped].slice(0, width - 1).join('') + '…' : [...clipped].slice(0, Math.max(0, width)).join('');
}
