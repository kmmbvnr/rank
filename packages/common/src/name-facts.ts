import { AstUtils, CstUtils, GrammarUtils, type AstNode, type LeafCstNode } from 'langium';
import {
    analyzeValues, expressionFacts, applicationForm, formatTypeSignature, signatureType, describeTypes, declaredType, findOperation, functionSignature, operationSignature, operatorSignature, flattenApplication, unaryApplicationHead, isApplicationExpression, isArrayAssignmentStatement, isAssignmentStatement, isBinaryExpression, isForStatement, functionBodyKey, joinValueFacts,
    isExpression, isOptionStatement, isArgumentStatement, isFlagStatement, isFunctionStatement, isNameExpression, isUnaryExpression, isUnpackStatement,
    type Expression, type ForStatement, type FunctionStatement, type ImportedFunction, type Program, type ValueFacts, type FunctionCallFacts,
} from '@arrrank/language';
import { parse } from '@arrrank/interpreter';
import { cellWidth } from './display-width.js';

export interface NameFacts {
    readonly name: string;
    readonly facts: ValueFacts;
    readonly source: 'runtime' | 'static';
    readonly signature?: string;
    /** A parameter contract from backward analysis, separate from observed value facts. */
    readonly requirement?: string;
}

/** A function the live preview calls with example arguments, so its parameters have facts. */
export interface NameFactsExample {
    readonly name: string;
    readonly arguments: readonly ValueFacts[];
}

const UNKNOWN: ValueFacts = { types: [] };
const FUNCTION: ValueFacts = { types: ['function'] };
const FOOTER_SIGNATURE = { shortNumericNames: true, compact: true } as const;

/**
 * The cells before an unexecuted draft: what they bind, and which functions they declare. A draft
 * has not run, so a name it writes never takes the run's facts for an earlier value.
 */
export interface NameFactsScope {
    readonly bindings: ReadonlyMap<string, ValueFacts>;
    readonly functions: ReadonlyMap<string, FunctionStatement>;
    readonly imports?: ReadonlyMap<string, ImportedFunction>;
    readonly functionCalls?: ReadonlyMap<FunctionStatement, readonly FunctionCallFacts[]>;
}

/**
 * Analyzes `source` once; the returned lookup answers any offset. `sessionFacts` are trusted:
 * the caller passes only facts of cells that were executed and have not changed since.
 */
export function nameFactsIn(source: string, sessionFacts: readonly (readonly [string, ValueFacts])[] = [],
    examples: readonly NameFactsExample[] = [], scope?: NameFactsScope,
    loadModule?: (specifier: string) => Program | undefined): ((offset: number) => NameFacts | undefined) | undefined {
    let program: Program;
    const known = new Set([...sessionFacts.map(([name]) => name), ...(scope?.bindings.keys() ?? [])]);
    try { program = parse(source, '<preview>', {}, known); } catch { return undefined; }
    const root = program.$cstNode;
    if (!root) return undefined;
    const runtime = new Map(sessionFacts);
    let analysis: ReturnType<typeof analyzeValues>;
    try { analysis = analyzeValues(program, scope ? new Map(scope.bindings) : runtime,
        new Map(scope?.functions), examples.map(example => ({ ...example })), loadModule, scope?.imports); } catch { return undefined; }

    const observedCalls = (definition: FunctionStatement): readonly FunctionCallFacts[] => {
        const previous = scope?.functions.get(definition.name);
        // The active cell is parsed again. Only the exact hoisted declaration
        // can inherit observations from earlier notebook cells.
        const same = previous === definition || !!definition.$cstNode?.text
            && previous?.$cstNode?.text === definition.$cstNode.text;
        return [...analysis.functionCalls.get(definition) ?? [],
            ...(same && previous ? scope?.functionCalls?.get(previous) ?? [] : [])];
    };
    const observedBodies = new Map<FunctionStatement, ReturnType<typeof analyzeValues>>();
    const observedBody = (definition: FunctionStatement): ReturnType<typeof analyzeValues> | undefined => {
        const cached = observedBodies.get(definition);
        if (cached) return cached;
        const calls = observedCalls(definition).filter(call => call.body);
        if (!calls.length) return undefined;
        const expressions = new Map<Expression, ValueFacts>();
        const assignments = new Map(analysis.assignments);
        for (const node of AstUtils.streamAllContents(definition)) {
            const key = functionBodyKey(definition, node);
            const facts = key === undefined ? [] : calls.flatMap(call => call.body![key] ? [call.body![key]] : []);
            if (!facts.length) continue;
            const joined = joinValueFacts(facts);
            if (isExpression(node)) expressions.set(node, joined);
            else if (isAssignmentStatement(node)) assignments.set(node, joined);
        }
        const body = { ...analysis, expressions, assignments };
        observedBodies.set(definition, body);
        return body;
    };

    const generalAnalyses = new Map<FunctionStatement, ReturnType<typeof analyzeValues>>();
    const generalAnalysis = (definition: FunctionStatement): ReturnType<typeof analyzeValues> | undefined => {
        if (analysis.functions.get(definition.name) !== definition) return undefined;
        const cached = generalAnalyses.get(definition);
        if (cached) return cached;
        // A general signature describes one body invocation, before declared
        // ranks lift its result over a caller's collection frame.
        const result = analyzeValues(program, scope ? new Map(scope.bindings) : runtime,
            new Map(scope?.functions), [{ name: definition.name, body: true,
                arguments: definition.parameters.map(() => UNKNOWN) }], loadModule, scope?.imports);
        generalAnalyses.set(definition, result);
        return result;
    };
    const generalResult = (definition: FunctionStatement): ValueFacts =>
        generalAnalysis(definition)?.functionResults[0] ?? UNKNOWN;

    /** Every footer consumer sees the same current, general and observed body facts. */
    const expressionValue = (expression: Expression): ValueFacts => {
        const current = analysis.expressions.get(expression);
        if (current?.types.length) return current;
        const definition = AstUtils.getContainerOfType(expression, isFunctionStatement);
        if (definition) {
            const general = generalAnalysis(definition)?.expressions.get(expression);
            if (general?.types.length) return general;
            const observed = observedBody(definition)?.expressions.get(expression);
            if (observed?.types.length) return observed;
        }
        // Only syntax (for example a literal) can fill a missing observation;
        // final/global bindings cannot stand in for a local read at this point.
        return expressionFacts(expression, () => undefined);
    };

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
    const callFacts = (site: Site): { arguments: readonly ValueFacts[]; result?: ValueFacts } | undefined => {
        if (!isNameExpression(site.node)) return undefined;
        const definition = analysis.functions.get(site.name);
        if (definition) for (let parent: AstNode | undefined = site.node.$container; isApplicationExpression(parent); parent = parent.$container) {
            const found = analysis.functionCallSites.get(parent)?.get(definition);
            if (found) return found;
        }
        const call = site.node.$container;
        if (!isApplicationExpression(call)) return undefined;
        const parts = flattenApplication(call);
        if (parts.at(-1) !== site.node) return undefined;
        const arities = (name: string): readonly number[] | undefined => {
            const definition = analysis.functions.get(name);
            return definition ? [definition.parameters.length] : findOperation(name)?.arities;
        };
        const head = unaryApplicationHead(call, arities,
            name => !analysis.bindings.has(name) && !runtime.has(name));
        const facts = (part: Expression): ValueFacts => {
            const found = expressionValue(part);
            if (found.types.length) return found;
            // Flattened calls may omit intermediate heads from the expression map.
            // Reuse facts at their reads, never the final value of a changed binding.
            const reads = new Map<string, ValueFacts>();
            for (const node of AstUtils.streamAst(part)) {
                if (isNameExpression(node)) reads.set(node.name, expressionValue(node));
            }
            return expressionFacts(part, Object.assign((name: string) => reads.get(name), {
                arity: (name: string) => analysis.functions.get(name)?.parameters.length,
            }));
        };
        return {
            arguments: (head ? [head] : parts.slice(0, -1)).map(facts),
            result: analysis.expressions.get(call),
        };
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
                    const inputs = [signatureType(expressionValue(form.source))];
                    if (form.kind === 'named-segment') {
                        const isMaxSum = isNameExpression(form.operation) && form.operation.name === 'maxsum'
                            && !analysis.bindings.has('maxsum') && !runtime.has('maxsum');
                        if (!isMaxSum) inputs.push({ callback: { inputs: ['unknown', 'unknown'], result: 'unknown' } });
                        if (form.identity) inputs.push(signatureType(expressionValue(form.identity)));
                    }
                    return formatTypeSignature({ inputs, result: 'segment' }, FOOTER_SIGNATURE);
                }
                const operands = form.kind === 'outer' ? form.operands
                    : form.kind === 'named-outer' ? [form.left, form.right, form.operation] : undefined;
                if (operands) {
                    const result = analysis.expressions.get(node);
                    return formatTypeSignature({
                        inputs: operands.map(operand => form.kind === 'named-outer' && operand === form.operation
                            ? 'function' : signatureType(expressionValue(operand))),
                        // Every successful outer call builds an array; cell types still need analyzer evidence.
                        result: signatureType(result?.types.length ? result : { types: ['array'] }),
                    }, FOOTER_SIGNATURE);
                }
            }
            return undefined;
        }
        if (site.kind === 'operator') {
            const node = site.node;
            const operands = isBinaryExpression(node) ? [node.left, node.right]
                : isUnaryExpression(node) ? [node.operand] : [];
            return operatorSignature(site.name, operands.map(expressionValue), FOOTER_SIGNATURE);
        }
        const call = callFacts(site);
        if (isCatalogueFunction(site)) return operationSignature(findOperation(site.name)!, call?.arguments, FOOTER_SIGNATURE);
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
        if (observed.length) return [...new Set(observed.map(facts => functionSignature(definition, { ...facts, relationship })))].join(' ; ');
        const result = relationship ? undefined : generalResult(definition);
        // A later host call can erase captured-value facts. Keep signatures
        // already proved at actual call sites for the definition's footer.
        const earlierCalls = !relationship && !result?.types.length
            ? observedCalls(definition)
            : undefined;
        if (earlierCalls?.length) return [...new Set(earlierCalls.map(facts => functionSignature(definition, facts)))].join(' ; ');
        return functionSignature(definition, { relationship, result,
            requirements: (generalAnalysis(definition) ?? analysis).requirements.functions.get(definition)?.params });
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
        if (observed && !inFunction && site.kind !== 'parameter' && site.kind !== 'input' && !written.has(site.name)) {
            // A run records no element types; the analyzer's agree with it only when type, rank and shape do.
            const inferred = analysis.bindings.get(site.name);
            const same = inferred && observed.types.join() === inferred.types.join() && observed.rank === inferred.rank
                && observed.shape?.length === inferred.shape?.length
                && observed.shape?.every((size, axis) => inferred.shape![axis] === size);
            const elements = same && !observed.elements ? inferred.elements : undefined;
            return { name: site.name, source: 'runtime', facts: { ...observed, ...(elements ? { elements } : {}) },
                ...(observed.types.join() === 'function' ? { signature: signatureFor(site) } : {}) };
        }
        let facts = isCatalogueFunction(site) ? FUNCTION : staticFacts(site, analysis);
        if (!facts.types.length && inFunction) {
            const body = generalAnalysis(inFunction);
            if (body) facts = staticFacts(site, body);
        }
        if (!facts.types.length && inFunction) {
            const body = observedBody(inFunction);
            if (body) facts = staticFacts(site, body);
            if (site.kind === 'parameter') {
                const index = inFunction.parameters.indexOf(site.name);
                const inputs = observedCalls(inFunction).map(call => call.arguments[index] ?? UNKNOWN);
                if (inputs.length) facts = joinValueFacts(inputs);
            }
        }
        let requirement: string | undefined;
        if (!facts.types.length && inFunction) {
            const body = generalAnalysis(inFunction) ?? analysis;
            const index = inFunction.parameters.indexOf(site.name);
            const required = site.kind === 'parameter' && index >= 0
                ? body.requirements.functions.get(inFunction)?.params[index]
                : isNameExpression(site.node) ? body.requirements.expressions.get(site.node) : undefined;
            if (required?.domains?.length) {
                const domain = describeTypes(required.domains as ValueFacts['types']);
                const rank = required.rank;
                requirement = rank.min === 0 && rank.max === 0 ? domain
                    : `(${domain}) [rank ${rank.max === Infinity ? `≥ ${rank.min}` : `${rank.min}..${rank.max}`}]`;
            }
        }
        if (site.kind === 'read' && !facts.types.length && !isDefined(site)) return undefined;
        return { name: site.name, source: 'static', facts, ...(requirement ? { requirement } : {}),
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
    readonly kind: 'read' | 'assignment' | 'input' | 'loop' | 'parameter' | 'unpack' | 'function' | 'operator' | 'form';
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
    if (isOptionStatement(node) || isArgumentStatement(node) || isFlagStatement(node)) {
        return ownsLeaf(node, 'name', leaf) ? { name: text, node, kind: 'input' } : undefined;
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
        case 'input': {
            if (isFlagStatement(node)) return { types: ['boolean'], rank: 0, shape: [] };
            if (!isOptionStatement(node) && !isArgumentStatement(node)) return UNKNOWN;
            const types = declaredType(node.valueType, node.many);
            if (!types.length) return UNKNOWN;
            return node.many ? { types, rank: 1, shape: [null], elements: declaredType(node.valueType, false) }
                : { types, rank: types.join() === 'text' ? 1 : 0, shape: types.join() === 'text' ? [null] : [] };
        }
        case 'function': return FUNCTION;
        case 'assignment':
            return isAssignmentStatement(node) ? node.operator === '=' ? known(node.value)
                : analysis.assignments.get(node) ?? UNKNOWN : UNKNOWN;
        case 'loop': return bodyRead(loopOf(node)!, name, analysis);
        case 'parameter': return bodyRead(node as FunctionStatement, name, analysis);
        case 'unpack': return isUnpackStatement(node)
            ? known(node.value).tupleItems?.[node.names.indexOf(name)] ?? UNKNOWN : UNKNOWN;
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

/** Show exact dimensions when known, otherwise preserve the array kind and rank. */
export function describeFacts(facts: ValueFacts, withShape = true): string {
    if (facts.types.join() === 'function') return 'function';
    if (!facts.types.length) return 'unknown';
    if (facts.types.join() === 'sequence' && facts.elements?.length) {
        return `sequence<${describeTypes(facts.elements)}>`;
    }
    if (facts.types.join() === 'array' && (!facts.shape || facts.shape.some(size => size === null))) {
        const rank = facts.rank ?? facts.shape?.length;
        const axes = rank !== undefined ? `[${Array(rank).fill('#').join(', ')}]` : '';
        return axes || facts.elements?.length ? `array${axes}<${describeTypes(facts.elements ?? [])}>` : 'array';
    }
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
    const full = `${found.name} · ${found.signature ?? found.requirement ?? describeFacts(found.facts)}`;
    if (cellWidth(full) <= width) return full;
    const bare = `${found.name} · ${found.signature ?? found.requirement ?? describeFacts(found.facts, false)}`;
    if (cellWidth(bare) <= width) return bare;
    const suffix = ` · ${found.signature ?? found.requirement ?? describeFacts(found.facts, false)}`;
    let name = found.name;
    while (name.length > 1 && cellWidth(`${name}…${suffix}`) > width) name = name.slice(0, -1);
    const clipped = `${name}…${suffix}`;
    return cellWidth(clipped) <= width ? clipped : [...clipped].slice(0, Math.max(0, width)).join('');
}

/** Split at the spaces that are not inside parentheses or angle brackets. */
function topLevelWords(text: string): string[] {
    const words: string[] = [];
    let depth = 0;
    let word = '';
    for (const char of text) {
        if (char === '(' || char === '<' || char === '[') depth++;
        else if (char === ')' || char === '>' || char === ']') depth--;
        if (char === ' ' && depth === 0) {
            if (word) words.push(word);
            word = '';
        } else word += char;
    }
    if (word) words.push(word);
    // `array # #<integer>` is one type written with an axis marker per axis.
    return words.reduce<string[]>((merged, item) => {
        if ((item.startsWith('#') || item.startsWith('[rank ')) && merged.length) merged[merged.length - 1] += ' ' + item;
        else merged.push(item);
        return merged;
    }, []);
}

/** The members of a union, split at the `|` that sit outside nested brackets. */
function unionMembers(text: string): string[] {
    const members: string[] = [];
    let depth = 0;
    let member = '';
    for (const char of text) {
        if (char === '(' || char === '<' || char === '[') depth++;
        else if (char === ')' || char === '>' || char === ']') depth--;
        if (char === '|' && depth === 0) { members.push(member.trim()); member = ''; } else member += char;
    }
    members.push(member.trim());
    return members;
}

/** A union wider than a row breaks only between its members, packed as many to a row as fit. */
function wrapUnion(text: string, width: number, indent: string): string[] | undefined {
    const wrapped = text.startsWith('(') && text.endsWith(')');
    const members = unionMembers(wrapped ? text.slice(1, -1) : text);
    if (members.length < 2) return undefined;
    const rows: string[] = [];
    let row = indent + (wrapped ? '(' : '');
    members.forEach((member, at) => {
        const piece = member + (at < members.length - 1 ? ' |' : wrapped ? ')' : '');
        const next = row.trim() && row.trim() !== '(' ? row + ' ' + piece : row + piece;
        if (cellWidth(next) <= width || !row.trim().replace('(', '')) row = next;
        else { rows.push(row); row = indent + (wrapped ? ' ' : '') + piece; }
    });
    rows.push(row);
    return rows;
}

/** Break a text that is wider than a row at its spaces, indenting what follows the first row. */
function wrapElement(text: string, width: number, indent: string): string[] {
    const rows: string[] = [];
    let row = indent;
    // `[rank 1]` is one unit.
    for (const word of text.replace(/\[rank /g, '[rank\u00a0').split(' ')) {
        const next = row.trim() ? row + ' ' + word : row + word;
        if (cellWidth(next) <= width || !row.trim()) row = next;
        else { rows.push(row); row = indent + '  ' + word; }
    }
    rows.push(row);
    return rows.map(line => line.replace(/\u00a0/g, ' '));
}

/**
 * The footer as rows: one row when it fits; otherwise the name, then one parameter per row with
 * `→ result` on the last parameter's row, or on its own row when that would not fit.
 * Types are never broken apart unless one alone is wider than a row.
 */
export function layoutNameFacts(found: NameFacts, width: number): string[] {
    const text = `${found.name} · ${found.signature ?? found.requirement ?? describeFacts(found.facts)}`;
    if (cellWidth(text) <= width || !found.signature) return cellWidth(text) <= width ? [text] : wrapElement(text, width, '');
    return found.signature.split(' ; ').flatMap((alternative, index) => {
        const single = `${index === 0 ? found.name + ' · ' : '  '}${alternative}`;
        if (cellWidth(single) <= width) return [single];
        const words = topLevelWords(alternative);
        const arrow = words.indexOf('→');
        // Type/container bounds are annotations, not additional result signatures.
        if (arrow < 0) return wrapElement(alternative, width, '  ');
        const inputs = words.slice(0, arrow);
        const result = words.slice(arrow + 1).join(' ');
        const rows: string[] = index === 0 ? [`${found.name} ·`] : [];
        const place = (line: string): void => {
            if (cellWidth(line) <= width) { rows.push(line); return; }
            const body = line.trim();
            const arrowed = body.startsWith('→ ');
            const union = wrapUnion(arrowed ? body.slice(2) : body, width - (arrowed ? 2 : 0), '  ');
            if (union && arrowed) rows.push('  → ' + union[0].trimStart(), ...union.slice(1).map(row => '  ' + row));
            else rows.push(...(union ?? wrapElement(body, width, '  ')));
        };
        inputs.forEach((input, at) => {
            const last = at === inputs.length - 1;
            const joined = `  ${input} → ${result}`;
            if (last && cellWidth(joined) <= width) rows.push(joined);
            else {
                place(`  ${input}`);
                if (last) place(`  → ${result}`);
            }
        });
        if (!inputs.length) place(`  → ${result}`);
        return rows;
    });
}
