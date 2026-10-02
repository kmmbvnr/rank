import { AstUtils, CstUtils, GrammarUtils, type AstNode, type LeafCstNode } from 'langium';
import {
    analyzeValues, describeTypes, isArrayAssignmentStatement, isAssignmentStatement, isBinaryExpression, isForStatement,
    isFunctionStatement, isNameExpression, isUnpackStatement,
    type Expression, type ForStatement, type FunctionStatement, type Program, type ValueFacts,
} from '@arrrank/language';
import { parse } from '@arrrank/interpreter';
import { cellWidth } from './display-width.js';

export interface NameFacts {
    readonly name: string;
    readonly facts: ValueFacts;
    readonly source: 'runtime' | 'static';
}

/** A function the live preview calls with example arguments, so its parameters have facts. */
export interface NameFactsExample {
    readonly name: string;
    readonly arguments: readonly ValueFacts[];
}

const UNKNOWN: ValueFacts = { types: [] };
const FUNCTION: ValueFacts = { types: ['function'] };

/**
 * Analyzes `source` once; the returned lookup answers any offset. `sessionFacts` are trusted:
 * the caller passes only facts of cells that were executed and have not changed since.
 */
export function nameFactsIn(source: string, sessionFacts: readonly (readonly [string, ValueFacts])[] = [],
    examples: readonly NameFactsExample[] = []): ((offset: number) => NameFacts | undefined) | undefined {
    let program: Program;
    try { program = parse(source); } catch { return undefined; }
    const root = program.$cstNode;
    if (!root) return undefined;
    const runtime = new Map(sessionFacts);
    let analysis: ReturnType<typeof analyzeValues>;
    try { analysis = analyzeValues(program, runtime, new Map(), examples.map(example => ({ ...example }))); } catch { return undefined; }

    return offset => {
        const site = [offset, offset - 1].map(at => nameSite(root, at)).find(found => found !== undefined);
        if (!site) return undefined;
        const inFunction = AstUtils.getContainerOfType(site.node, isFunctionStatement);
        const observed = runtime.get(site.name);
        if (observed && !inFunction && site.kind !== 'parameter') {
            // A run records no element types; the analyzer's agree with it only when type, rank and shape do.
            const inferred = analysis.bindings.get(site.name);
            const same = inferred && observed.types.join() === inferred.types.join() && observed.rank === inferred.rank
                && observed.shape?.length === inferred.shape?.length
                && observed.shape?.every((size, axis) => inferred.shape![axis] === size);
            const elements = same && !observed.elements ? inferred.elements : undefined;
            return { name: site.name, source: 'runtime', facts: { ...observed, ...(elements ? { elements } : {}) } };
        }
        return { name: site.name, source: 'static', facts: staticFacts(site, analysis) };
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

interface Site {
    readonly name: string;
    readonly node: AstNode;
    readonly kind: 'read' | 'assignment' | 'loop' | 'parameter' | 'unpack' | 'function';
}

function nameSite(root: NonNullable<Program['$cstNode']>, offset: number): Site | undefined {
    if (offset < 0) return undefined;
    const leaf = CstUtils.findLeafNodeAtOffset(root, offset);
    if (!leaf || offset < leaf.offset || offset >= leaf.end || leaf.hidden) return undefined;
    const node = leaf.astNode;
    const text = leaf.text;
    if (isNameExpression(node)) {
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
        case 'read': {
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
    const full = `${found.name} · ${describeFacts(found.facts)}`;
    if (cellWidth(full) <= width) return full;
    const bare = `${found.name} · ${describeFacts(found.facts, false)}`;
    if (cellWidth(bare) <= width) return bare;
    const suffix = ` · ${describeFacts(found.facts, false)}`;
    let name = found.name;
    while (name.length > 1 && cellWidth(`${name}…${suffix}`) > width) name = name.slice(0, -1);
    const clipped = `${name}…${suffix}`;
    return cellWidth(clipped) <= width ? clipped : [...clipped].slice(0, Math.max(0, width)).join('');
}
