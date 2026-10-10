import { functionBindingPlan } from '../function-binding.js';
import { declaredRanks } from '../function-ranks.js';
import { applicationForm } from '../application-forms.js';
import { rankedFunctionFacts, rankedFunctionInputs } from './ranked-function-facts.js';
import type { FunctionRelationship } from './function-relationships.js';
import { arrayBindingContract, establishedArrayContract, refineArrayContract, contractElements, arrayContractConflict } from './array-binding-contract.js';
import { AstUtils, type AstNode } from 'langium';
import { inferRequirements, type RequirementAnalysis, type ValueRequirement } from './requirements.js';
import { requirementDiagnostics } from './requirement-diagnostics.js';
import {
    isApplicationExpression, isAllAxisExpression, isNameExpression, isNumberLiteral, isStringLiteral, isParenthesizedExpression,
    isTupleExpression, isArrayExpression, isMaterializeExpression, isUnaryExpression, isBooleanLiteral, isLabelLiteral,
    isArrayAssignmentStatement, isAssignmentStatement, isBinaryExpression,
    isExpressionStatement, isNewStructureExpression, isRecordExpression, isRecordUpdateExpression,
    isForStatement, isFunctionStatement, isFunctionBindingStatement, isIfStatement, isReturnStatement,
    isArgumentStatement, isOptionStatement, isFlagStatement, isPushStatement, isTryStatement, isUnpackStatement, isUseStatement,
    isBoundClauseExpression, isCountClauseExpression, isFirstIndexWhereExpression, isFirstWhereExpression,
    isTakeWhileExpression,
    isTableFilterExpression, isUnpackExpression,
    isSubjectComparisonExpression,
    type Expression, type Program, type Statement, type FunctionStatement, type AssignmentStatement,
    type TryStatement,
} from '../generated/ast.js';
import { compoundType, declaredType } from './types.js';
import { flattenApplication } from '../expressions.js';
import { findOperation, type Operation } from '../operations.js';
import { builtinBindingDiagnostics } from '../builtin-bindings.js';
import { renamedBuiltinCall } from '../builtin-renames.js';
import { arrayRank, conditionalPaths, contractRank, invalidate, mergeEnvironments } from './control-flow.js';
import { bindingRankConflict, bindingRankMessage, bindingTypeMessage, settledBindingTypes,
    provenBindingTypeConflict } from '../binding-rule.js';
import { functionEffects, isPlainArrayWrite } from './function-effects.js';
import { functionYields, generatorCells, yieldTypes } from './function-yields.js';
import { createCallAnalysis, type ImportedFunction } from './function-calls.js';
import { createReturnPathAnalysis } from './return-paths.js';
import { recordBindingContract, refineRecordContract, recordFieldConflict } from './return-contract.js';
import { createLoopAnalysis } from './loop-analysis.js';
import { freshDim } from './shape-index.js';
import { directValue, safeCollectionValue, safeIndexDefault, safeRead, scalarArithmetic, scalarBitwise } from './value-safety.js';
import { expressionFacts } from './value-facts.js';
import { filterPredicateForm } from '../clause-conditions.js';
import { rankedFrameConflict } from './operation-shape.js';
import { withInsertedElement } from './collection-facts.js';
import type { ConstructorCall } from './test-examples.js';
import { hasCallbackFreeFindProof } from './operation-proofs.js';
import { incompatibleShapes, isAtom, joinValueFacts, stableRecordField, UNKNOWN_VALUE, UnobservedReturn,
    type ValueFacts, type FactLookup } from './value-domain.js';

export interface ValueDiagnostic {
    readonly node: AstNode;
    readonly message: string;
    readonly kind: 'TypeError' | 'DimensionMismatch';
    readonly code?: 'BuiltinRename' | 'RaggedLift' | 'RequirementConflict';
    readonly severity?: 'warning';
}

export interface ValueAnalysis {
    readonly relationships: ReadonlyMap<FunctionStatement, FunctionRelationship>;
    readonly requirements: RequirementAnalysis;
    readonly diagnostics: readonly ValueDiagnostic[];
    readonly bindings: ReadonlyMap<string, ValueFacts>;
    readonly expressions: ReadonlyMap<Expression, ValueFacts>;
    readonly assignments: ReadonlyMap<AssignmentStatement, ValueFacts>;
    readonly functions: ReadonlyMap<string, FunctionStatement>;
    readonly functionResults: readonly ValueFacts[];
    /** The imported functions this pass bound, for a later pass over the next cell to start from. */
    readonly imports: ReadonlyMap<string, ImportedFunction>;
}

let nextCollectionId = 0;
let nextCheckedInputId = 0;

/** Facts available only after a read has validated its backward requirements. */
function checkedSelectionFacts(required: ValueRequirement, base: ValueFacts, id: number): ValueFacts {
    const exactRank = required.rank.min === required.rank.max ? required.rank.min : undefined;
    const domains = required.domains;
    const possible = !base.types.length && domains?.length
        ? exactRank === 0 ? domains
            : exactRank !== undefined && exactRank > 1 ? ['array']
                : exactRank === 1 ? [...(domains.includes('text') ? ['text'] : []), 'array']
                    : [...new Set([...domains, 'array'])] : base.types;
    const shape = exactRank !== undefined && !base.shape
        ? Array.from({ length: exactRank }, (_, axis) => {
            const length = required.dimensions.get(axis);
            return length && length.min === length.max ? length.min : null;
        }) : base.shape;
    const checkedFields: Record<string, ValueFacts> = {};
    for (const [name, field] of required.fields ?? []) {
        const known = base.fields?.[name] ?? (base.xmlAttributeValues
            ? { types: ['text'], rank: 1, shape: [null] } : UNKNOWN_VALUE);
        checkedFields[name] = checkedSelectionFacts(field, known, id);
    }
    return { ...base, types: possible, ...(shape ? { shape } : {}),
        ...(exactRank !== undefined && base.rank === undefined ? { rank: exactRank } : {}),
        ...(!base.elements && possible.includes('array') && domains?.length ? { elements: domains } : {}),
        checkedInputId: id, ...(Object.keys(checkedFields).length ? { checkedFields } : {}) };
}

/** A non-executing pass. Unknown facts never justify a diagnostic. */
export function analyzeValues(program: Program, initial: ReadonlyMap<string, ValueFacts> = new Map(),
    declarations: ReadonlyMap<string, FunctionStatement> = new Map(),
    examples: readonly { name: string; arguments: readonly ValueFacts[];
        /** Infer the body's cell contract, without lifting it over an unknown outer frame. */
        body?: boolean;
        constructions?: readonly (readonly ConstructorCall[] | undefined)[] }[] = [],
    loadModule?: (path: string) => Program | undefined,
    initialImports?: ReadonlyMap<string, ImportedFunction>): ValueAnalysis {
    const diagnostics: ValueDiagnostic[] = builtinBindingDiagnostics(program, undefined, declarations.values(), loadModule);
    const expressions = new Map<Expression, ValueFacts>();
    const assignments = new Map<AssignmentStatement, ValueFacts>();
    const bindings = new Map(initial);
    const numeric = new Set(['integer', 'real']);
    const functions = new Map(declarations);
    const requirements = inferRequirements(program, { initial, declarations, loadModule });
    const calls = createCallAnalysis(bindings, functions, diagnostics, expressions,
        (items, env) => paths.returnPaths(items, env).values,
        (module, name, arguments_) => {
            const analysis = analyzeValues(module, new Map(), new Map(), [{ name, arguments: arguments_ }]);
            const definition = analysis.functions.get(name);
            return { result: analysis.functionResults[0], diagnostics: analysis.diagnostics,
                relationship: definition && analysis.relationships.get(definition) };
        }, initialImports);
    const { functionBindings, imported, importedAliases, globalCallEnvs, privateBindings, frameBindings } = calls;
    function invalidateImportedAlias(alias: string, env: Map<string, ValueFacts>): void {
        for (const name of imported.keys()) if (name.startsWith(`${alias}.`)) {
            env.set(name, invalidate(env.get(name)));
        }
    }

    const paths = createReturnPathAnalysis({
        diagnostics,
        directCallBeforeEffects: (expression, env) => directCallBeforeEffects(expression, env),
        directNoReturnCall: (expression, env) => calls.directNoReturnCall(expression, env),
        invalidateCalls: (expression, env) => invalidateCalls(expression, env),
        inspect: (expression, env) => inspect(expression, env),
        tryPrefixFacts: (statement, env) => tryPrefixFacts(statement, env),
        forgetNonFunctions: env => forgetNonFunctions(env),
        loop: (statement, env) => loops.loop(statement, env),
        loopReturnPaths: (statement, env) => loops.loopReturnPaths(statement, env),
        statements: (items, env) => statements(items, env),
    });
    function insertCollectionElement(name: string, value: ValueFacts, node: Expression,
        env: Map<string, ValueFacts>): void {
        const collection = env.get(name);
        if (!collection || !['set', 'counter', 'queue', 'stack', 'deque', 'heap'].includes(collection.types.join())) return;
        if (!value.types.length) {
            if (collection.collectionId === undefined) return;
            for (const [alias, fact] of env) if (fact.collectionId === collection.collectionId) {
                env.set(alias, withInsertedElement(fact, value));
            }
            return;
        }
        const accepted = collection.elements;
        if (accepted?.length && value.types.every(type => !accepted.includes(type))) {
            diagnostics.push({ node, kind: 'TypeError',
                message: `${name} holds ${accepted.join(' or ')} and cannot receive ${value.types.join(' or ')}` });
            return;
        }
        const rank = value.types.join() === 'array' ? value.rank : undefined;
        if (accepted?.join() === 'array' && collection.elementRank !== undefined
            && rank !== undefined && collection.elementRank !== rank) {
            diagnostics.push({ node, kind: 'DimensionMismatch',
                message: `${name} holds array rank ${collection.elementRank} and cannot receive rank ${rank}` });
            return;
        }
        const nonempty = !!value.declaredArrayContract?.elements?.length || value.shape?.every(size => size !== null && size > 0) === true;
        if (nonempty && accepted?.join() === 'array' && collection.elementCells?.length && value.elements?.length
            && value.elements.every(type => !collection.elementCells!.includes(type))) {
            diagnostics.push({ node, kind: 'TypeError',
                message: `${name} holds array of ${collection.elementCells.join(' or ')} and cannot receive array of ${value.elements.join(' or ')}` });
            return;
        }
        // Unknown host collections need runtime validation before we can publish facts.
        if (collection.collectionId === undefined) return;
        for (const [alias, fact] of env) if (fact.collectionId === collection.collectionId) {
            env.set(alias, { ...withInsertedElement(fact, value),
                ...(rank !== undefined ? { elementRank: collection.elementRank ?? rank } : {}),
                ...(!accepted?.length && nonempty && value.types.join() === 'array' && value.elements?.length
                    ? { elementCells: value.elements } : {}) });
        }
    }
    function bind(name: string, next: ValueFacts, node: AstNode, env: Map<string, ValueFacts>): void {
        const previous = env.get(name);
        const accepted = previous?.acceptedTypes ?? previous?.types;
        const expectedRank = contractRank(previous);
        const receivedRank = arrayRank(next);
        if (accepted?.length && provenBindingTypeConflict(accepted, next.types)) {
            diagnostics.push({ node, kind: 'TypeError',
                message: bindingTypeMessage(name, accepted, next.types) });
        } else if (expectedRank !== undefined && receivedRank !== undefined
            && bindingRankConflict(expectedRank, receivedRank)) {
            diagnostics.push({ node, kind: 'DimensionMismatch',
                message: bindingRankMessage(name, expectedRank, receivedRank) });
        }
        const recordContract = recordBindingContract(previous);
        const recordConflict = recordContract && ['record', 'tuple'].includes(next.types.join())
            ? recordFieldConflict(recordContract, next, name) : undefined;
        if (recordConflict) diagnostics.push({ node, ...recordConflict });
        const schema = refineRecordContract(recordContract, next);
        if (schema && ['record', 'tuple'].includes(next.types.join())) next = { ...next, fields: schema.fields, closedRecord: schema.closedRecord, tupleItems: schema.tupleItems };
        const arrayContract = refineArrayContract(arrayBindingContract(previous), next);
        const elementConflict = arrayContractConflict(arrayBindingContract(previous), next, name);
        if (elementConflict) diagnostics.push({ node, kind: 'TypeError', message: elementConflict });
        // A successful assignment to an uncaptured scalar local must
        // satisfy its existing binding contract, even if the RHS is unknown.
        if (!next.types.length && accepted?.length && privateBindings.at(-1)?.has(name)
            && accepted.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))) {
            next = { types: accepted, rank: 0, shape: [] };
        }
        env.set(name, { ...next,
            acceptedTypes: accepted?.length ? settledBindingTypes(accepted, next.types)
                : next.infinite ? ['integer', 'real'] : next.types,
            acceptedRecordContract: schema,
            acceptedArrayRank: expectedRank ?? receivedRank, acceptedArrayContract: arrayContract });
    }

    function tryPrefixFacts(statement: TryStatement,
        env: Map<string, ValueFacts>): Map<string, ValueFacts> | undefined {
        const indexNames = [...env].filter(([, fact]) => fact.types.join() === 'index' && fact.elements !== undefined)
            .map(([name]) => name);
        const start = diagnostics.length;
        const beforeExpressions = new Map(expressions);
        const prefix = new Map(env);
        const paths = [new Map(prefix)];
        try {
            for (const item of statement.statements) {
                if (isAssignmentStatement(item)) {
                    if (indexNames.includes(item.name)) return;
                } else if (isArrayAssignmentStatement(item) && item.operator === '=' && indexNames.includes(item.name)) {
                    if (!item.indices.every(index => !index.all && !index.spread && !!index.value && directValue(index.value)
                            && isAtom(expressionFacts(index.value, name => prefix.get(name))))
                        || !(directValue(item.value) || scalarArithmetic(item.value, prefix)
                            || scalarBitwise(item.value, prefix))) return;
                } else if (isReturnStatement(item)) {
                    const value = item.value;
                    if (!value || directValue(value) || scalarArithmetic(value, prefix)
                        || scalarBitwise(value, prefix)) break;
                    const parts = isApplicationExpression(value) ? flattenApplication(value) : [];
                    const input = parts[0] && expressionFacts(parts[0], name => prefix.get(name));
                    if (parts.length === 2 && isNameExpression(parts[1]) && parts[1].name === 'integer'
                        && !prefix.has('integer') && directValue(parts[0]) && input?.types.length
                        && input.types.every(type => ['integer', 'real', 'text'].includes(type))) break;
                    return;
                } else return;
                if (!statements([item], prefix) || indexNames.some(name => prefix.get(name)?.types.join() !== 'index'
                    || prefix.get(name)?.elements === undefined)) return;
                paths.push(new Map(prefix));
            }
            const privateNames = privateBindings.at(-1);
            return new Map([...env.keys()].flatMap(name => {
                if (!privateNames?.has(name)) return [];
                const fact = joinValueFacts(paths.map(path => path.get(name) ?? UNKNOWN_VALUE));
                return fact.types.length ? [[name, fact] as const] : [];
            }));
        } finally {
            diagnostics.length = start;
            expressions.clear();
            for (const [node, fact] of beforeExpressions) expressions.set(node, fact);
        }
    }
    // A call into this program's own nested functions writes a captured name through the enclosing
    // frame's binding, so each write still passes its type and rank contract and a scalar keeps
    // them. Host callbacks and unknown names carry no such bound and still forget everything.
    const scalarContract = (name: string, fact: ValueFacts | undefined): ValueFacts | undefined => {
        const accepted = fact?.acceptedTypes ?? fact?.types;
        return fact && frameBindings.at(-1)?.has(name) && fact.types.length > 0 && accepted?.length
            && [...fact.types, ...accepted].every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
            ? { types: accepted, acceptedTypes: accepted, rank: 0, shape: [] } : undefined;
    };
    const forgetNonFunctions = (env: Map<string, ValueFacts>, closureOnly = false): void => {
        const protectedNames = privateBindings.at(-1);
        for (const [name, fact] of env) if (!fact.types.includes('function')) {
            const scalar = closureOnly ? scalarContract(name, fact) : undefined;
            if (scalar) { env.set(name, scalar); continue; }
            // An uncaptured local cannot be rebound by a callee. A scalar's
            // rank therefore survives even when its type is not yet known.
            if (protectedNames?.has(name) && fact.rank === 0 && !fact.types.length) {
                env.set(name, { ...invalidate(fact), rank: 0, shape: [] });
                continue;
            }
            const accepted = fact.acceptedTypes ?? fact.types;
            const privateValue = protectedNames?.has(name) && accepted.length > 0;
            const rank = contractRank(fact);
            const record = recordBindingContract(fact);
            if (privateValue && ['record', 'tuple'].includes(fact.types.join()) && record) {
                env.set(name, { ...record, acceptedRecordContract: record });
                continue;
            }
            // Unknown calls may mutate a private value, but cannot rebind its uncaptured local name.
            env.set(name, privateValue && fact.types.length > 0
                && fact.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                && accepted.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                ? { types: accepted, acceptedTypes: accepted, rank: 0, shape: [] }
                : privateValue && fact.types.join() === 'text' && accepted.join() === 'text'
                    ? { types: ['text'], acceptedTypes: ['text'], rank: 1, shape: [null] }
                    : privateValue && fact.types.join() === 'array' && accepted.join() === 'array'
                        ? { types: ['array'], acceptedTypes: ['array'], acceptedArrayRank: rank,
                            acceptedArrayContract: arrayBindingContract(fact), elements: contractElements(arrayBindingContract(fact)),
                            ...(rank !== undefined ? { rank, shape: Array(rank).fill(null) } : {}) }
                        : privateValue && fact.types.length === 1 && accepted.join() === fact.types.join()
                            ? { types: fact.types, acceptedTypes: accepted }
                            : invalidate(fact));
        }
    };
    const loops = createLoopAnalysis({
        diagnostics, expressions, functions, functionBindings,
        globalEnv: () => globalCallEnvs.at(-1),
        inspect: (expression, env) => inspect(expression, env),
        invalidateCalls: (expression, env) => invalidateCalls(expression, env),
        statements: (items, env) => statements(items, env),
        returnPaths: (items, env) => paths.returnPaths(items, env),
        forgetNonFunctions,
    });
    function invalidateCalls(expression: AstNode, env: Map<string, ValueFacts>): void {
        const syntax = new Set(['reduce', 'scan', 'outer', 'rank', 'axis', 'with', 'segment', 'from', 'check']);
        const effects = functionEffects(name => env.get(name) === functionBindings.get(name) ? functions.get(name) : undefined,
            name => env.get(name)?.types.includes('function') ?? false,
            name => env.has(name), name => env.get(name));
        const nodes = [expression, ...AstUtils.streamAllContents(expression)];
        let unknown = false;
        let closureUnknown = false;
        const written = new Set<string>();
        const writtenGlobals = new Set<string>();
        const numericWritten = new Set<string>();
        const numericWrittenGlobals = new Set<string>();
        const unprovenWritten = new Set<string>();
        const unprovenWrittenGlobals = new Set<string>();
        const rebound = new Set<string>();
        for (const node of nodes) {
            if (isRecordExpression(node) || isRecordUpdateExpression(node)) {
                for (const field of node.fields) {
                    const value = expressionFacts(field.value, name => env.get(name));
                    if (value.types.includes('array') && !safeRead(value)) unknown = true;
                }
            }
            if (!isNameExpression(node)) continue;
            if (env.get(node.name)?.types.includes('function')) {
                // Only the restricted numeric proof can provisionally preserve
                // effects. A general recursive return contract proves no purity.
                if (calls.hasPureRecursiveProbe(node.name)) continue;
                let site: AstNode = node;
                while (isApplicationExpression(site.$container)) site = site.$container;
                const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                const external = imported.get(node.name);
                const arity = functions.get(node.name)?.parameters.length
                    ?? external?.functions.get(external.name)?.parameters.length;
                const form = isApplicationExpression(site)
                    ? applicationForm(site, name => env.has(name) ? false : findOperation(name)) : undefined;
                const ranked = form?.kind === 'rank' && form.parts.at(-1) === node
                    && form.parts.length - 1 === arity ? form : undefined;
                const arguments_ = ranked ? ranked.parts.slice(0, -1)
                    : parts.at(-1) === node && parts.length - 1 === arity
                    ? parts.slice(0, -1)
                    : isApplicationExpression(site) && isApplicationExpression(site.head)
                        && site.arguments.length === 1 && site.arguments[0] === node
                        && site.head.arguments.length + 1 === arity
                        ? [site.head.head, ...site.head.arguments] : undefined;
                const filter = isTableFilterExpression(site.$container) ? site.$container : undefined;
                const condition = filter?.condition === site ? filter.condition
                    : filter?.conditions.find(condition => condition === site);
                const predicate = condition && filter?.sourceFields.length === 0
                    ? filterPredicateForm(condition) : undefined;
                const source = predicate && filter && expressionFacts(filter.source, name => env.get(name));
                const cellInputs = source && arity === 1 && source.rank === 1 && (predicate?.rank ?? 0) === 0
                    && ['array', 'sequence'].includes(source.types.join())
                    && safeRead(source) && source.elements?.length
                    ? [stableRecordField({ types: source.elements })] : undefined;
                const operands = cellInputs ?? arguments_?.map(part => expressionFacts(part, name => env.get(name)));
                const partition = ranked && operands ? rankedFunctionInputs(operands,
                    ranked.rightRank === undefined ? [Number(ranked.rank)] : [Number(ranked.rank), Number(ranked.rightRank)], ranked.axes) : undefined;
                const inputs = ranked ? partition?.inputs : operands;
                const result = external && env.get(node.name) === external.binding
                    ? functionEffects(name => external.functions.get(name), name => external.functions.has(name),
                        name => external.functions.has(name))(external.name, inputs)
                    : effects(node.name, inputs);
                // Host input may re-enter Rank. It is identified separately in
                // the summary, but cannot preserve pre-call value facts here.
                unknown ||= result.io;
                closureUnknown ||= result.unknown && !result.io;
                // Summarized collection writes only change what the collection may hold.
                for (const [name, state] of result.collections ?? []) {
                    const current = env.get(name);
                    if (current?.collectionId === undefined) { unknown = true; continue; }
                    for (const [alias, fact] of env) if (fact.collectionId === current.collectionId) {
                        env.set(alias, { ...fact, elements: state.elements, elementRecord: state.elementRecord });
                    }
                }
                // Other indexed structures can invoke user callbacks on writes.
                const array = (fact: ValueFacts | undefined) => !!fact?.types.length
                    && fact.types.every(type => type === 'array');
                for (const capture of result.captures) {
                    const global = result.globalWriteCaptures.has(capture);
                    const source = global ? globalCallEnvs.at(-1) ?? env : env;
                    unknown ||= !array(source.get(capture));
                    (global ? writtenGlobals : written).add(capture);
                    const preserved = global ? numericWrittenGlobals : numericWritten;
                    const unproven = global ? unprovenWrittenGlobals : unprovenWritten;
                    if (result.numericCaptureWrites?.has(capture) && safeRead(source.get(capture))) {
                        if (!unproven.has(capture)) preserved.add(capture);
                    } else {
                        unproven.add(capture);
                        preserved.delete(capture);
                    }
                }
                for (const capture of result.bindingCaptures) rebound.add(capture);
                for (const capture of result.readCaptures) {
                    const source = result.globalReadCaptures.has(capture)
                        ? globalCallEnvs.at(-1) ?? env : env;
                    unknown ||= !safeRead(source.get(capture));
                }
                if (result.parameters.size || result.readParameters.size) {
                    if (!arguments_) unknown = true;
                    else {
                        for (const index of result.parameters) {
                            unknown ||= !array(expressionFacts(arguments_[index], name => env.get(name)));
                        }
                        for (const index of result.readParameters) {
                            unknown ||= !safeRead(expressionFacts(arguments_[index], name => env.get(name)));
                        }
                    }
                }
            } else if (/^[a-z]/.test(node.name) && !env.has(node.name) && !syntax.has(node.name)) {
                if (node.name === 'raise') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    if ((parts.length === 2 || parts.length === 3) && parts.at(-1) === node
                        && isLabelLiteral(parts[0]) && (parts.length === 2 || directValue(parts[1])
                            && isAtom(expressionFacts(parts[1], name => env.get(name))))) continue;
                }
                if (node.name === 'add') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    const graph = parts[0] && isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
                    const scalar = (part: Expression, allowed: readonly string[]) => {
                        const fact = expressionFacts(part, name => env.get(name));
                        return directValue(part) && isAtom(fact) && fact.types.length > 0
                            && fact.types.every(type => allowed.includes(type));
                    };
                    if (parts[1] === node && (parts.length === 4 || parts.length === 5)
                        && graph?.types.join() === 'graph' && graph.elements?.length
                        && parts.slice(2, 4).every(part => scalar(part,
                            ['integer', 'real', 'boolean', 'text', 'symbol']))
                        && (parts.length === 4 || scalar(parts[4], ['integer', 'real']))) continue;
                }
                if (node.name === 'merge') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    const dsu = parts[0] && isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
                    const arguments_ = parts[1] === node ? parts.slice(2) : parts.slice(1, 3);
                    if (parts.length === 4 && (parts[1] === node || parts[3] === node)
                        && dsu?.types.join() === 'dsu' && arguments_.every(part => {
                            const fact = expressionFacts(part, name => env.get(name));
                            return directValue(part) && isAtom(fact) && fact.types.length > 0
                                && fact.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type));
                        })) {
                        if (dsu.collectionId === undefined) { unknown = true; continue; }
                        for (const [alias, fact] of env) if (fact.collectionId === dsu.collectionId) {
                            env.set(alias, { ...fact, elements: undefined });
                        }
                        continue;
                    }
                    if (parts.length === 4 && (parts[1] === node || parts[3] === node)) {
                        unknown = true;
                        continue;
                    }
                }
                if (node.name === 'len') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    const source = parts[0] && expressionFacts(parts[0], name => env.get(name));
                    if (parts.includes(node) && source?.types.join() === 'sequence'
                        && source.callbackFreeScalarCells !== true) {
                        unknown = true;
                        continue;
                    }
                }
                if (node.name === 'indices') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    const source = parts[0] && expressionFacts(parts[0], name => env.get(name));
                    if (parts.length === 2 && parts[1] === node
                        && source?.eagerScalarCells !== true && source?.callbackFreeScalarCells !== true) {
                        unknown = true;
                        continue;
                    }
                }
                if (node.name === 'find' || node.name === 'findall') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    if (parts.length === 3 && parts[2] === node) {
                        const source = expressionFacts(parts[0], name => env.get(name));
                        const renamed = renamedBuiltinCall(parts);
                        // Removed builtin calls fail before invoking a callback; keep
                        // the receiver facts so inspection can report the migration.
                        if (renamed && source.types.join() === renamed.receiver) continue;
                        const target = expressionFacts(parts[1], name => env.get(name));
                        if (!hasCallbackFreeFindProof(source, target)) {
                            unknown = true;
                            continue;
                        }
                    }
                }
                if (['pop', 'popfront', 'popback'].includes(node.name)) {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    const receiver = parts[0] && isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
                    const kinds = node.name === 'pop' ? ['queue', 'stack', 'deque', 'heap'] : ['deque'];
                    if (parts.length === 2 && parts[1] === node && receiver?.types.length
                        && receiver.types.every(type => kinds.includes(type))) continue;
                }
                const operation = findOperation(node.name);
                if (!operation || operation.effects?.length) unknown = true;
            }
        }
        if (!unknown && !closureUnknown && !written.size && !writtenGlobals.size && !rebound.size) return;
        // An unknown call can change captured bindings. Do not use a pre-call
        // shape, even in another operand of the same expression.
        if (unknown || closureUnknown) {
            forgetNonFunctions(env, !unknown);
            const global = globalCallEnvs.at(-1);
            if (global && global !== env) for (const [name, fact] of global) {
                if (!fact.types.includes('function')) global.set(name, invalidate(fact));
            }
            return;
        }
        // Parameter arrays have value semantics. A write to one parameter
        // cannot alter its caller's array, even if two arguments share storage.
        for (const [source, names, preserved] of [[env, written, numericWritten],
            [globalCallEnvs.at(-1) ?? env, writtenGlobals, numericWrittenGlobals]] as const) {
            for (const name of names) {
                const fact = source.get(name);
                if (fact) source.set(name, { ...fact,
                    ...(!preserved.has(name) ? { elements: undefined, eagerScalarCells: undefined,
                        callbackFreeScalarCells: undefined } : {}),
                    integers: undefined, positions: undefined, positionFacts: undefined });
            }
        }
        for (const name of rebound) {
            const fact = env.get(name);
            if (fact) env.set(name, invalidate(fact));
        }
    }

    function inspect(expression: Expression, env: Map<string, ValueFacts>): ValueFacts {
        const lookup: FactLookup = Object.assign((name: string) => env.get(name), {
            invoke: (name: string, arguments_: readonly ValueFacts[], cellCall = false) => calls.call(name, arguments_, env, expression, cellCall),
            arity: (name: string) => env.get(name) === functionBindings.get(name)
                ? functions.get(name)?.parameters.length
                : env.get(name) === imported.get(name)?.binding
                    ? imported.get(name)?.functions.get(imported.get(name)!.name)?.parameters.length : undefined,
        });
        if (isTableFilterExpression(expression) && expression.sourceFields.length === 0) {
            const source = inspect(expression.source, env);
            const conditions = expression.condition ? [expression.condition] : expression.conditions;
            if (source.types.join() === 'array' && (source.rank ?? 0) > 1
                && conditions.some(condition => [condition, ...AstUtils.streamAllContents(condition)]
                    .some(isSubjectComparisonExpression))) {
                diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                    message: 'filter needs one boolean per row' });
            }
            const frames: number[][] = [];
            for (const condition of conditions) {
                const predicate = filterPredicateForm(condition);
                if (!predicate || !env.get(predicate.name)?.types.includes('function')
                    || lookup.arity?.(predicate.name) !== 1
                    || !['sequence', 'array'].includes(source.types.join())) continue;
                const rank = predicate.rank ?? (source.rank ?? 1) - 1;
                const frameRank = (source.rank ?? 1) - rank;
                const axes = predicate.axes ?? Array.from({ length: Math.max(0, frameRank) }, (_, axis) => axis);
                if (source.rank !== undefined && (rank < 0 || frameRank < 1
                    || axes.length !== frameRank || new Set(axes).size !== axes.length
                    || axes.some(axis => axis < 0 || axis >= source.rank!))) {
                    diagnostics.push({ node: condition, kind: 'DimensionMismatch',
                        message: 'filter axis count plus cell rank must equal source rank, with distinct valid axes' });
                    continue;
                }
                frames.push(axes);
                let cell: ValueFacts = UNKNOWN_VALUE;
                if (source.types.join() === 'sequence' && rank === 0
                    || source.types.join() === 'array' && rank === 0) {
                    cell = source.elementRecord ?? stableRecordField({ types: source.elements ?? [] });
                } else if (source.types.join() === 'array' && source.rank !== undefined
                    && rank > 0) {
                    cell = { types: ['array'], rank, shape: source.shape?.filter((_, index) => !axes.includes(index)),
                        elements: source.elements };
                }
                const result = calls.call(predicate.name, [cell], env, condition, true);
                if (result.types.length && (result.types.join() !== 'boolean' || result.rank !== undefined && result.rank !== 0)) {
                    diagnostics.push({ node: condition, kind: 'TypeError',
                        message: `filter predicate must return boolean, got ${result.types.join(' or ')}` });
                }
            }
            if (frames.some(axes => axes.join() !== frames[0]?.join())) {
                diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                    message: 'filter conditions must traverse the same axes' });
            }
        }
        if (isParenthesizedExpression(expression)) inspect(expression.value, env);
        if (isMaterializeExpression(expression)) inspect(expression.source, env);
        if (isUnaryExpression(expression)) inspect(expression.operand, env);
        if (isRecordExpression(expression)) for (const field of expression.fields) inspect(field.value, env);
        if (isRecordUpdateExpression(expression)) {
            const source = inspect(expression.source, env);
            for (const field of expression.fields) {
                inspect(field.value, env);
                const expected = source.fields?.[field.name];
                if (expected) checkFieldAssignment(expected, field.value, field.operator, env, `record field .${field.name}`);
            }
        }
        if (isFirstWhereExpression(expression) || isFirstIndexWhereExpression(expression)
            || isTakeWhileExpression(expression)) {
            inspect(expression.source, env);
            inspect(expression.mask, env);
        }
        if (isBoundClauseExpression(expression)) {
            inspect(expression.source, env);
            inspect(expression.condition, env);
        }
        if (isCountClauseExpression(expression)) {
            inspect(expression.source, env);
            inspect(expression.count, env);
        }
        if (isTupleExpression(expression)) expression.items.forEach(item => inspect(item.value, env));
        if (isArrayExpression(expression)) {
            for (const item of [...expression.items, ...expression.dimensions, ...expression.rows.flatMap(row => row.items)]) inspect(item.value, env);
            if (expression.fill) inspect(expression.fill, env);
            if (expression.range) inspect(expression.range, env);
            const cells = [...expression.items, ...expression.rows.flatMap(row => row.items)]
                .map(item => expressionFacts(item.value, lookup)).filter(cell => !cell.infinite && cell.types.length === 1
                    && cell.types[0] !== 'missing');
            if (cells.some(cell => recordFieldConflict(cells[0], cell, 'array elements'))) {
                diagnostics.push({ node: expression, kind: 'TypeError',
                    message: 'arrays require one element type; use a tuple for different positional types' });
            }
            const shape = expressionFacts(expression, lookup).shape;
            if (expression.dimensions.length && !expression.fill && shape?.every(n => n !== null)) {
                const expected = shape.reduce<bigint>((size, n) => size * BigInt(n!), 1n);
                if (expression.range) {
                    const rangeFacts = expressionFacts(expression.range, lookup);
                    const rangeSize = rangeFacts.shape?.[0];
                    if (rangeSize !== undefined && rangeSize !== null) {
                        const actual = BigInt(rangeSize);
                        if (expected !== actual) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                            message: `array shape ${shape.join(' ')} expects ${expected} elements, got ${actual}` });
                    }
                } else {
                    const actual = expression.items.length + expression.rows.reduce((count, row) => count + row.items.length, 0);
                    if (expected !== BigInt(actual)) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                        message: `array shape ${shape.join(' ')} expects ${expected} elements, got ${actual}` });
                }
            }
        }
        if (isApplicationExpression(expression)) {
            const parts = flattenApplication(expression);
            const source = inspect(parts[0], env);
            const renamed = renamedBuiltinCall(parts);
            const binding = renamed && env.get(renamed.operation.name);
            if (renamed && source.types.join() === renamed.receiver
                && (!binding || binding.builtinOperation === renamed.operation.name)) {
                diagnostics.push({ node: renamed.operation, kind: 'TypeError', code: 'BuiltinRename', message: renamed.message });
            }
            for (const part of parts.slice(1)) inspect(part, env);
            const form = applicationForm(expression, name => env.has(name) ? false : findOperation(name));
            if (form.kind === 'diagonal') {
                if (form.mode && (!isLabelLiteral(form.mode) || form.mode.name !== 'anti')) {
                    diagnostics.push({ node: form.mode, kind: 'TypeError', message: 'diag mode must be .anti' });
                }
                const offset = form.offset && expressionFacts(form.offset, lookup);
                if (offset?.types.length && offset.types.join() !== 'integer') {
                    diagnostics.push({ node: form.offset!, kind: 'TypeError', message: 'diag offset must be an integer' });
                }
                if (offset?.integer !== undefined && (BigInt(offset.integer) > BigInt(Number.MAX_SAFE_INTEGER)
                    || BigInt(offset.integer) < -BigInt(Number.MAX_SAFE_INTEGER))) {
                    diagnostics.push({ node: form.offset!, kind: 'DimensionMismatch', message: 'diag offset is too large' });
                }
                const input = expressionFacts(form.source, lookup);
                const requested = form.rank === undefined ? 2 : Number(form.rank);
                const rank = requested === undefined ? input.rank : input.rank === undefined ? undefined
                    : requested < 0 ? Math.max(0, input.rank + requested) : Math.min(input.rank, requested);
                if (rank !== undefined && rank !== 1 && rank !== 2) {
                    diagnostics.push({ node: form.source, kind: 'DimensionMismatch',
                        message: 'diag expects a rank-1 vector or rank-2 matrix' });
                }
            }
            if (form.kind === 'reshape') {
                const batch = form.dimensions.length === 1 && isUnpackExpression(form.dimensions[0])
                    && expressionFacts(form.dimensions[0].value, lookup).rank === 2;
                const dimensions = form.dimensions.flatMap(part => {
                    const valueFacts = expressionFacts(isUnpackExpression(part) ? part.value : part, lookup);
                    if (isUnpackExpression(part)) {
                        if (valueFacts.types.length && (valueFacts.types.join() !== 'array'
                            || valueFacts.rank !== undefined && valueFacts.rank !== 1 && valueFacts.rank !== 2
                            || valueFacts.elements?.length && valueFacts.elements.join() !== 'integer')) {
                            diagnostics.push({ node: part, kind: 'TypeError',
                                message: 'reshape shape must be a rank-1 integer array' });
                        }
                        return valueFacts.integers ?? [];
                    }
                    if (valueFacts.types.length && valueFacts.types.join() !== 'integer') {
                        diagnostics.push({ node: part, kind: 'TypeError', message: 'reshape dimensions must be integers' });
                    }
                    const value = valueFacts.integer;
                    return [value === undefined ? null : Number(value)];
                });
                if (!batch && dimensions.length && dimensions.every(n => n !== null && n >= 0)
                    && source.shape?.every(n => n !== null)) {
                    const expected = dimensions.reduce<bigint>((size, n) => size * BigInt(n!), 1n);
                    const actual = source.shape.reduce<bigint>((size, n) => size * BigInt(n!), 1n);
                    if (expected !== actual) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                        message: `reshape expects ${expected} elements, got ${actual}` });
                }
            }
            if (form.kind === 'array-combine-constructor') {
                const cells = form.items.map(item => expressionFacts(isUnpackExpression(item) ? item.value : item, lookup));
                const operation = form.operation;
                const axis = form.axis && expressionFacts(form.axis, lookup);
                const axisNumber = axis?.integer === undefined ? form.axis ? undefined : 0 : Number(axis.integer);
                if (axis?.types.length && axis.types.join() !== 'integer') diagnostics.push({
                    node: form.axis!, kind: 'TypeError', message: `${operation} axis must be an integer`,
                });
                const rank = cells[0]?.rank;
                const maximum = rank === undefined ? undefined : rank + (operation === 'stack' ? 1 : 0);
                if (axis?.integer !== undefined && (BigInt(axis.integer) < 0n
                    || maximum !== undefined && BigInt(axis.integer) >= BigInt(maximum))) diagnostics.push({
                    node: form.axis!, kind: 'DimensionMismatch',
                    message: `${operation} axis ${axis.integer} exceeds result rank ${maximum ?? 'unknown'}`,
                });
                const invalid = cells.some(cell => cell.types.length && !cell.types.every(type =>
                    type === 'array' || type === 'sequence'));
                if (invalid) {
                    diagnostics.push({ node: expression, kind: 'TypeError',
                        message: `${operation} expects arrays or sequences` });
                }
                const first = cells[0];
                for (const cell of invalid ? [] : cells.slice(1)) {
                    if (first.rank !== undefined && cell.rank !== undefined && first.rank !== cell.rank
                        || first.shape && cell.shape && first.shape.some((size, axis) =>
                            (operation === 'stack' || axis !== axisNumber)
                            && size !== null && cell.shape?.[axis] !== null && cell.shape?.[axis] !== size)) {
                        diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                            message: operation === 'stack' ? 'stack arguments must have the same shape'
                                : 'concat arguments must match on non-concatenated axes' });
                        break;
                    }
                    const conflict = first.types.join() === cell.types.join()
                        ? recordFieldConflict(first, cell, `${operation} elements`, true)
                        : first.elements?.length && cell.elements?.length
                            && provenBindingTypeConflict(first.elements, cell.elements);
                    if (conflict) {
                        diagnostics.push({ node: expression, kind: 'TypeError',
                            message: `${operation} arguments must have one element type` });
                        break;
                    }
                }
            }
            const rankedParts = form.kind === 'rank' && form.rightRank !== undefined ? form.parts
                : form.kind === 'plain' ? parts : undefined;
            const rankedName = rankedParts?.at(-1);
            const rankedOperation = rankedName && isNameExpression(rankedName) && !env.has(rankedName.name)
                ? findOperation(rankedName.name) : undefined;
            const ranks = form.kind === 'rank' && form.rightRank !== undefined
                ? [Number(form.rank), Number(form.rightRank)] : rankedOperation?.dyadicRanks;
            if (rankedParts?.length === 3 && rankedOperation?.arities.includes(2) && ranks) {
                const operands = rankedParts.slice(0, 2).map(part => expressions.get(part)
                    ?? expressionFacts(part, name => env.get(name)));
                const conflict = rankedFrameConflict(operands, ranks);
                if (conflict) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                    message: `shape mismatch: [${conflict.left.join(', ')}] and [${conflict.right.join(', ')}]` });
            }
            const selectors = parts.slice(1);
            const last = parts.at(-1);
            const fenwickSelector = source.types.join() === 'fenwick'
                && (selectors.length === 1 || selectors.length === 2
                    && isNameExpression(selectors[0]) && selectors[0].name === 'sum') ? last : undefined;
            const fenwickIndex = fenwickSelector && expressions.get(fenwickSelector);
            if (fenwickSelector && fenwickIndex?.types.length
                && fenwickIndex.types.every(type => type !== 'integer')) {
                diagnostics.push({ node: fenwickSelector, kind: 'TypeError',
                    message: `fenwick index must be integer, got ${fenwickIndex.types.join(' or ')}` });
            }
            if (source.rank !== undefined && source.types.length && source.types.every(type => type === 'array' || type === 'bytes')
                && selectors.every(part => isAllAxisExpression(part) || expressionFacts(part, lookup).types.join() === 'integer')
                && (selectors.some(isAllAxisExpression) || source.elements?.length
                    && source.elements.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type)))
                && selectors.length > source.rank) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                    message: `${selectors.length} selectors exceed array rank ${source.rank}` });
            for (let index = 1; index < parts.length - 1; index++) {
                const part = parts[index];
                // Ordinary rank clamps to the operand rank (negative ranks count
                // back from it). Only an explicit axis is an index here.
                if (!isNameExpression(part) || part.name !== 'axis' || lookup(part.name)) continue;
                const integer = expressionFacts(parts[index + 1], lookup).integer;
                if (integer === undefined || source.rank === undefined) continue;
                const value = BigInt(integer);
                if (value < 0n || value >= BigInt(source.rank)) {
                    diagnostics.push({ node: parts[index + 1], kind: 'DimensionMismatch',
                        message: `${part.name} ${integer} is invalid for rank ${source.rank}` });
                }
            }
        }
        if (isApplicationExpression(expression)) raggedLiftWarning(expression, lookup);
        if (isBinaryExpression(expression)) {
            const left = inspect(expression.left, env);
            const right = inspect(expression.right, env);
            const modifiers = flattenApplication(expression.right);
            if (isNameExpression(modifiers[0]) && modifiers[0].name === 'reduce'
                && isNameExpression(modifiers[1]) && modifiers[1].name === 'rank' && modifiers[2]) {
                const integer = expressionFacts(modifiers[2], lookup).integer;
                if (integer !== undefined && left.rank !== undefined
                    && (BigInt(integer) < 0n || BigInt(integer) > BigInt(left.rank))) {
                    diagnostics.push({ node: modifiers[2], kind: 'DimensionMismatch',
                        message: `rank ${integer} exceeds value rank ${left.rank}` });
                }
            }
            if (['+', '-', '*', '/', '//', 'mod', '**', 'equal', 'notequal',
                'less', 'greater', 'atleast', 'atmost'].includes(expression.operator)) {
                const cells = (value: ValueFacts) => isAtom(value) ? value.types
                    : value.shape?.every(size => size !== null && size > 0) ? value.elements ?? [] : [];
                const a = cells(left), b = cells(right);
                if (a.length && b.length && [...a, ...b].every(type => numeric.has(type))
                    && !a.some(type => b.includes(type))) {
                    diagnostics.push({ node: expression, kind: 'TypeError',
                        message: 'integer and real require explicit conversion with integer or real' });
                }
            }
            if (['+', '-', '*', '/', '//', 'mod', '**'].includes(expression.operator)) {
                if (incompatibleShapes(left, right)) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                    message: `shape mismatch: [${left.shape!.join(', ')}] and [${right.shape!.join(', ')}]` });
                // Other scalar domains (dates/durations) have their own legal operators.
                const primitive = new Set(['integer', 'real', 'text', 'boolean']);
                const leftTypes = isAtom(left) ? left.types : left.shape?.every(n => n !== null && n > 0) ? left.elements ?? [] : [];
                const rightTypes = isAtom(right) ? right.types : right.shape?.every(n => n !== null && n > 0) ? right.elements ?? [] : [];
                if (leftTypes.length && rightTypes.length
                    && [...leftTypes, ...rightTypes].every(type => primitive.has(type))
                    && !leftTypes.some(a => rightTypes.some(b => numeric.has(a) && numeric.has(b)
                        || expression.operator === '+' && a === 'text' && b === 'text'))) {
                    diagnostics.push({ node: expression, kind: 'TypeError',
                        message: `operator ${expression.operator} does not accept ${leftTypes.join(' or ')} and ${rightTypes.join(' or ')}` });
                }
            }
        }
        let result = expressionFacts(expression, lookup);
        if (isApplicationExpression(expression) && !AstUtils.getContainerOfType(expression, isFunctionStatement)) {
            const form = applicationForm(expression, name => env.has(name) ? false : findOperation(name));
            if (form.kind === 'checked-read' && form.reader === 'csv') {
                const rowLength = freshDim('csv');
                const needed = requirements.expressions.get(expression);
                const columns: Record<string, ValueFacts> = Object.fromEntries([...(needed?.fields ?? [])].map(([name, field]) =>
                    [name, { types: ['array'], rank: 1, shape: [null], dims: [rowLength],
                        ...(field.domains?.length ? { elements: field.domains } : {}), eagerScalarCells: true as const }]));
                result = { ...result, types: ['array'], rank: 1, shape: [null], dims: [rowLength],
                    elements: ['object'], eagerScalarCells: true,
                    checkedInputId: nextCheckedInputId++, checkedColumns: columns };
            } else if (form.kind === 'checked-read') {
                const needed = requirements.expressions.get(expression);
                if (needed) result = checkedSelectionFacts(needed, result, nextCheckedInputId++);
            }
        }
        expressions.set(expression, result);
        if (result.bottom) throw new UnobservedReturn();
        return result;
    }

    /** `Row (Row greater 0)`: a parenthesized boolean mask selects a data-dependent number of items. */
    function maskSelection(value: Expression, declared: FunctionStatement, returned: Statement) {
        if (!isApplicationExpression(value)) return undefined;
        const parts = flattenApplication(value);
        const mask = parts.length === 2 ? parts[1] : undefined;
        if (!mask) return undefined;
        let inner: Expression;
        if (isParenthesizedExpression(mask)) inner = mask.value;
        else if (isNameExpression(mask)) {
            const assignments = AstUtils.streamAllContents(declared).filter(isAssignmentStatement)
                .filter(item => item.name === mask.name).toArray();
            const [assignment] = assignments;
            const returnPosition = declared.statements.indexOf(returned);
            const assignmentPosition = assignment ? declared.statements.indexOf(assignment) : -1;
            if (assignments.length !== 1 || assignment.operator !== '='
                || assignmentPosition < 0 || returnPosition <= assignmentPosition) return undefined;
            inner = assignment.value;
        } else return undefined;
        const boolean = isBinaryExpression(inner) ? !['+', '-', '*', '/', '//', 'mod', '**', 'till', 'to', 'until', 'default'].includes(inner.operator)
            : (() => {
                const last = flattenApplication(inner).at(-1);
                const operation = isNameExpression(last) && !declared.parameters.includes(last.name) && !functions.has(last.name)
                    ? findOperation(last.name) : undefined;
                return operation?.result === 'boolean';
            })();
        return boolean ? { name: 'a mask selection' } : undefined;
    }

    /** The builtin that ends every `return` of a one-parameter function with no declared ranks, if all agree on a data-dependent length. */
    function raggedReturn(declared: FunctionStatement) {
        if (declared.parameters.length !== 1 || declared.ranks.length) return undefined;
        const returns = AstUtils.streamAllContents(declared).filter(isReturnStatement).toArray();
        let found;
        for (const item of returns) {
            if (!item.value) return undefined;
            const selected = maskSelection(item.value, declared, item);
            if (selected) { found ??= selected; continue; }
            const last = flattenApplication(item.value).at(-1);
            const operation = isNameExpression(last) && !declared.parameters.includes(last.name) && !functions.has(last.name)
                ? findOperation(last.name) : undefined;
            if (!operation || !dataDependentLength(operation)) return undefined;
            found ??= operation;
        }
        return found;
    }

    /** `F rank N` over a frame of several cells where F's result length depends on the values. */
    function raggedLiftWarning(expression: Expression, lookup: FactLookup): void {
        if (!isApplicationExpression(expression)) return;
        if (lookup('rank') || lookup('axis')) return;
        const form = applicationForm(expression, name => lookup(name) ? false : findOperation(name));
        if (form.kind !== 'rank' || form.rightRank !== undefined || form.parts.length !== 2) return;
        const [input, name] = form.parts;
        if (!isNameExpression(name)) return;
        const declared = functions.get(name.name);
        const operation = declared ? undefined : lookup(name.name) ? undefined : findOperation(name.name);
        const source_ = declared ? raggedReturn(declared) : operation && dataDependentLength(operation) ? operation : undefined;
        if (!source_) return;
        const rank = form.rank;
        const source = expressions.get(input) ?? expressionFacts(input, lookup);
        const sourceRank = source.shape?.length ?? source.acceptedArrayRank;
        if (rank < 0n || sourceRank === undefined
            || source.types.length && source.types.join() !== 'array') return;
        const axes = form.axes;
        if (axes && (axes.length + Number(rank) !== sourceRank
            || new Set(axes).size !== axes.length || axes.some(axis => axis < 0 || axis >= sourceRank))) return;
        const frame = axes ? axes.map(axis => source.shape?.[axis] ?? null)
            : source.shape?.slice(0, Math.max(0, sourceRank - Number(rank)))
                ?? Array<number | null>(Math.max(0, sourceRank - Number(rank))).fill(null);
        if (frame.length === 0 || frame.every(n => n !== null) && frame.reduce<number>((size, n) => size * n!, 1) <= 1) return;
        diagnostics.push({ node: expression, kind: 'DimensionMismatch', code: 'RaggedLift', severity: 'warning',
            message: `\`${name.name}\` returns a data-dependent length${declared ? ` (from \`${source_.name}\`)` : ''}; under \`${axes ? `axis ${axes.join(' ')} ` : ''}rank ${rank}\` the cells may differ in length `
                + `and fail at run time. Reduce inside a function you lift (for example \`fun Total Row\` returning \`Row ... sum\`) or pad to a fixed width`});
    }

    function checkFieldAssignment(expected: ValueFacts, value: Expression, operator: string,
        env: Map<string, ValueFacts>, name: string): void {
        const received = operator === '=' ? expressionFacts(value, key => env.get(key))
            : expressionFacts({ $type: 'BinaryExpression', operator: operator.slice(0, -1),
                left: { $type: 'NameExpression', name: '$field' }, right: value } as Expression,
            key => key === '$field' ? expected : env.get(key));
        const conflict = recordFieldConflict(expected, received, name);
        if (conflict) diagnostics.push({ node: value, ...conflict });
    }

    // A direct call receives its already-evaluated arguments before its body
    // can invalidate caller facts. Limit this early snapshot to values whose
    // evaluation cannot itself call Rank or read host-owned array cells.
    function directCallBeforeEffects(value: Expression, env: Map<string, ValueFacts>): ValueFacts | undefined {
        if (!isApplicationExpression(value)) return undefined;
        const form = applicationForm(value, name => env.has(name) ? false : findOperation(name));
        if (form.kind === 'rank') {
            const target = form.parts.at(-1);
            if (target && isNameExpression(target) && env.get(target.name) === functionBindings.get(target.name)
                && functions.get(target.name)?.parameters.length === form.parts.length - 1
                && form.parts.slice(0, -1).every(directValue)) {
                const operands = form.parts.slice(0, -1).map(part => expressionFacts(part, name => env.get(name)));
                if (operands.every(fact => safeRead(fact) || fact.rank === 0 && !fact.types.includes('function'))) {
                    return rankedFunctionFacts(operands,
                        form.rightRank === undefined ? [Number(form.rank)] : [Number(form.rank), Number(form.rightRank)],
                        cells => calls.call(target.name, cells, new Map(env), value, true), form.axes);
                }
            }
        }
        const parts = flattenApplication(value);
        const target = parts.at(-1);
        const external = target && isNameExpression(target) ? imported.get(target.name) : undefined;
        if (external && isNameExpression(target) && env.get(target.name) === external.binding
            && external.functions.get(external.name)?.parameters.length === parts.length - 1
            && parts.slice(0, -1).every(directValue)) {
            return calls.call(target.name, parts.slice(0, -1).map(part => expressionFacts(part,
                name => env.get(name))), new Map(env), value);
        }
        if (!target || !isNameExpression(target) || env.get(target.name) !== functionBindings.get(target.name)
            || functions.get(target.name)?.parameters.length !== parts.length - 1) return undefined;
        const numericArgument = (part: Expression): boolean => {
            if (isParenthesizedExpression(part)) return numericArgument(part.value);
            if (isUnaryExpression(part) && ['+', '-'].includes(part.operator))
                return numericArgument(part.operand);
            if (isBinaryExpression(part) && ['+', '-', '*', '/', '//', 'mod', '**'].includes(part.operator))
                return numericArgument(part.left) && numericArgument(part.right);
            if (!isNameExpression(part) && !isNumberLiteral(part)) return false;
            const fact = isNameExpression(part) ? env.get(part.name) : expressionFacts(part, name => env.get(name));
            return fact?.rank === 0 && fact.types.length > 0
                && fact.types.every(type => type === 'integer' || type === 'real');
        };
        const safeIndexedScalar = (value: Expression): boolean => {
            while (isParenthesizedExpression(value)) value = value.value;
            if (!isApplicationExpression(value)) return false;
            const parts = flattenApplication(value);
            const source = isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
            const cell = expressionFacts(value, name => env.get(name));
            return source?.types.join() === 'array' && safeRead(source)
                && parts.slice(1).every(numericArgument)
                && cell.rank === 0 && cell.types.length > 0 && cell.types.every(type => numeric.has(type));
        };
        const arguments_: ValueFacts[] = [];
        for (const part of parts.slice(0, -1)) {
            const atom = isParenthesizedExpression(part) ? part.value : part;
            if (!isNameExpression(atom) && !isNumberLiteral(atom) && !isStringLiteral(atom)
                && !isBooleanLiteral(atom) && !numericArgument(part) && !safeIndexedScalar(part)) return undefined;
            const fact = expressionFacts(part, name => env.get(name));
            if (!fact.types.length || fact.types.includes('function')
                || fact.types.includes('array') && !fact.eagerScalarCells && !fact.callbackFreeScalarCells) return undefined;
            arguments_.push(fact);
        }
        parts.slice(0, -1).forEach((part, index) => expressions.set(part, arguments_[index]));
        return calls.call(target.name, arguments_, new Map(env), value);
    }

    function statements(items: readonly Statement[], env: Map<string, ValueFacts>): boolean {
        // Runtime registers function declarations before running their block.
        for (const statement of items) if (isFunctionStatement(statement)) {
            const fact: ValueFacts = { types: ['function'] };
            env.set(statement.name, fact);
            functionBindings.set(statement.name, fact);
            functions.set(statement.name, statement);
        }
        for (const statement of items) {
            if (isFunctionBindingStatement(statement)) {
                const plan = functionBindingPlan(statement);
                const operation = plan.alias && findOperation(plan.alias);
                const fact = plan.alias ? env.get(plan.alias) ?? (operation
                    ? { types: [], builtinOperation: operation.name } : { types: ['function'] })
                    : { types: ['function'] };
                env.set(statement.name, fact);
                const definition = plan.alias ? functions.get(plan.alias)
                    : plan.definitions.length === 1 ? plan.definitions[0] : undefined;
                if (definition) {
                    functions.set(statement.name, definition);
                    functionBindings.set(statement.name, fact);
                }
            } else if (isAssignmentStatement(statement)) {
                const dot = statement.name.indexOf('.');
                if (dot > 0 && importedAliases.has(statement.name.slice(0, dot))) {
                    invalidateImportedAlias(statement.name.slice(0, dot), env);
                }
                const beforeEffects = statement.operator === '=' ? directCallBeforeEffects(statement.value, env) : undefined;
                invalidateCalls(statement.value, env);
                const previous = env.get(statement.name);
                let next = beforeEffects ?? inspect(statement.value, env);
                if (beforeEffects) expressions.set(statement.value, beforeEffects);
                let constructor = statement.value;
                while (isParenthesizedExpression(constructor)) constructor = constructor.value;
                if (isNewStructureExpression(constructor)
                    && ['set', 'counter', 'queue', 'stack', 'deque', 'heap', 'dsu'].includes(constructor.structure)) {
                    next = { ...next, collectionId: nextCollectionId++ };
                }
                if (isApplicationExpression(constructor)
                    && ['new-heap', 'new-dsu'].includes(applicationForm(constructor).kind)) {
                    next = { ...next, collectionId: nextCollectionId++ };
                }
                if (next.bottom) throw new UnobservedReturn();
                if (statement.operator !== '=') {
                    const combined = expressionFacts({ $type: 'BinaryExpression', operator: statement.operator.slice(0, -1),
                        left: { $type: 'NameExpression', name: statement.name }, right: statement.value } as Expression, name => env.get(name));
                    next = { ...combined, types: combined.types.length ? combined.types
                        : compoundType(statement.operator, previous?.types ?? [], next.types) };
                }
                bind(statement.name, next, statement.value, env);
                assignments.set(statement, env.get(statement.name)!);
                if (calls.directNoReturnCall(statement.value, env)) return false;
            } else if (isUnpackStatement(statement)) {
                invalidateCalls(statement.value, env);
                const source = inspect(statement.value, env);
                const knownCells = !!source.elements?.length || !!source.positionFacts?.length;
                if (!source.tupleItems && (source.types.join() !== 'array' || source.rank !== 1
                    || source.shape?.[0] != null && source.shape[0] !== statement.names.length
                    || !knownCells && source.positions?.length !== statement.names.length
                    || !(source.eagerScalarCells || source.callbackFreeScalarCells))) {
                    forgetNonFunctions(env);
                    continue;
                }
                if (source.tupleItems && source.tupleItems.length !== statement.names.length) {
                    diagnostics.push({ node: statement, kind: 'TypeError', message: `unpack expects ${statement.names.length} values, got ${source.tupleItems.length}` });
                    continue;
                }
                for (const [index, name] of statement.names.entries()) {
                    if (name === '#') continue;
                    const cell = source.tupleItems?.[index] ?? source.positionFacts?.[index];
                    const types = cell?.types ?? source.positions?.[index] ?? source.elements ?? [];
                    const scalarCell = types.length && types.every(type =>
                        ['integer', 'real', 'boolean', 'symbol', 'date', 'datetime', 'duration'].includes(type));
                    const textCell = types.join() === 'text';
                    bind(name, { ...(cell ?? (scalarCell ? { rank: 0, shape: [] }
                            : textCell ? { rank: 1, shape: [null] } : {})),
                        types,
                        ...(source.integers?.[index] != null ? { integer: String(source.integers[index]) } : {}),
                    }, statement, env);
                }
            } else if (isPushStatement(statement)) {
                const receiver = isNameExpression(statement.receiver) ? statement.receiver.name : undefined;
                for (const value of [statement.receiver, statement.value]) {
                    invalidateCalls(value, env);
                    if (!safeCollectionValue(value, env)) {
                        forgetNonFunctions(env);
                    }
                    inspect(value, env);
                }
                const payload = expressionFacts(statement.value, name => env.get(name));
                if (payload.types.includes('array') && !payload.eagerScalarCells && !payload.callbackFreeScalarCells) {
                    forgetNonFunctions(env);
                }
                if (receiver && safeCollectionValue(statement.value, env)) {
                    insertCollectionElement(receiver,
                        expressionFacts(statement.value, name => env.get(name)), statement.value, env);
                }
            } else if (isArrayAssignmentStatement(statement)) {
                const selectors = statement.indices.map(index => {
                    if (!index.value) return undefined;
                    invalidateCalls(index.value, env);
                    return inspect(index.value, env);
                });
                invalidateCalls(statement.value, env);
                const replacement = inspect(statement.value, env);
                let fact = env.get(statement.name);
                if (fact?.checkedInputId !== undefined) {
                    for (const [name, alias] of env) if (alias.checkedInputId === fact.checkedInputId) {
                        env.set(name, { ...alias, checkedColumns: undefined, checkedFields: undefined,
                            checkedInputId: undefined });
                    }
                    fact = env.get(statement.name);
                }
                let contract = arrayBindingContract(fact);
                const cellWrite = fact?.types.join() === 'array' && fact.rank === statement.indices.length
                    && statement.indices.every((index, position) => !index.spread
                        && (index.all && (fact.shape?.[position] ?? 0) > 0
                            || !index.all && selectors[position]?.types.join() === 'integer' && selectors[position]?.rank === 0
                            || !index.all && ['array', 'sequence'].includes(selectors[position]?.types.join() ?? '')
                                && selectors[position]?.elements?.join() === 'integer' && (selectors[position]?.shape?.[0] ?? 0) > 0));
                if (cellWrite && !fact!.shape?.some(size => size === 0)) contract ??= establishedArrayContract({
                    ...fact!, shape: Array(fact!.rank).fill(1),
                });
                const inserted = statement.operator === '=' ? replacement : {
                    types: compoundType(statement.operator, fact?.elements ?? [], replacement.types), rank: 0,
                };
                const elementConflict = cellWrite && arrayContractConflict(contract, inserted, statement.name, true);
                if (elementConflict) diagnostics.push({ node: statement.value, kind: 'TypeError', message: elementConflict });
                if (cellWrite) contract = refineArrayContract(contract, inserted.types.join() === 'array' ? inserted
                    : { types: ['array'], rank: fact!.rank, shape: [1], eagerScalarCells: true,
                        elements: inserted.types, positionFacts: [inserted] });
                const fenwickIndex = statement.indices.length === 1 && !statement.indices[0].all
                    && !statement.indices[0].spread ? selectors[0] : undefined;
                const fenwickValueTypes = statement.operator === '=' ? replacement.types
                    : compoundType(statement.operator, ['integer'], replacement.types);
                const segmentValueTypes = statement.operator === '=' ? replacement.types
                    : compoundType(statement.operator, fact?.elements ?? [], replacement.types);
                if (fact?.types.join() === 'fenwick' && fenwickIndex?.types.length
                    && fenwickIndex.types.every(type => type !== 'integer')) {
                    diagnostics.push({ node: statement.indices[0].value!, kind: 'TypeError',
                        message: `fenwick index must be integer, got ${fenwickIndex.types.join(' or ')}` });
                } else if (fact?.types.join() === 'fenwick' && fenwickValueTypes.length
                    && fenwickValueTypes.every(type => type !== 'integer')) {
                    diagnostics.push({ node: statement.value, kind: 'TypeError',
                        message: `fenwick value must be integer, got ${fenwickValueTypes.join(' or ')}` });
                }
                const integerSelector = (value: Expression) => expressionFacts(value, name => env.get(name)).types.join() === 'integer';
                const spreadLength = (value: Expression): number | undefined => {
                    const selector = expressionFacts(value, name => env.get(name));
                    return selector.types.join() === 'array' && selector.rank === 1
                        && (selector.eagerScalarCells || selector.callbackFreeScalarCells)
                        && selector.elements?.join() === 'integer'
                        ? selector.shape?.[0] ?? undefined : undefined;
                };
                const selectorLengths = statement.indices.map(index => index.all || !index.value ? undefined
                    : index.spread ? spreadLength(index.value) : integerSelector(index.value) ? 1 : undefined);
                const oneCellSelectors = fact?.rank !== undefined
                    && selectorLengths.every(length => length !== undefined)
                    && selectorLengths.reduce((total, length) => total + (length ?? 0), 0) === fact.rank;
                const indexedCells = fact?.rank === 1 && statement.indices.length === 1
                    && !statement.indices[0].all && !statement.indices[0].spread
                    && ['array', 'sequence'].includes(selectors[0]?.types.join() ?? '')
                    && selectors[0]?.rank === 1 && selectors[0].elements?.join() === 'integer'
                    && (selectors[0].eagerScalarCells || selectors[0].callbackFreeScalarCells);
                const integerVector = (selector: ValueFacts | undefined): boolean => !!selector
                    && ['array', 'sequence'].includes(selector.types.join()) && selector.rank === 1
                    && selector.elements?.join() === 'integer'
                    && (selector.eagerScalarCells === true || selector.callbackFreeScalarCells === true);
                const lineTypes = statement.operator === '=' ? replacement.elements ?? []
                    : compoundType(statement.operator, fact?.elements ?? [], replacement.elements ?? []);
                const lineWrite = !!fact && fact.rank === statement.indices.length
                    && fact.eagerScalarCells === true && !!fact.elements?.length
                    && fact.elements.every(type => type === 'integer' || type === 'real')
                    && statement.indices.every((index, position) => !index.spread
                        && (index.all || selectors[position]?.rank === 0 && selectors[position]?.types.join() === 'integer'
                            || integerVector(selectors[position])))
                    && statement.indices.filter((index, position) => index.all || integerVector(selectors[position])).length === 1
                    && replacement.types.join() === 'array' && replacement.rank === 1
                    && (replacement.eagerScalarCells || replacement.callbackFreeScalarCells)
                    && !!replacement.elements?.length
                    && replacement.elements.every(type => type === 'integer' || type === 'real')
                    && lineTypes.length > 0 && lineTypes.every(type => type === 'integer' || type === 'real');
                const compound = statement.operator !== '=' && (oneCellSelectors || indexedCells)
                    && !!fact
                    && fact.eagerScalarCells === true
                    && !!fact.elements?.length && fact.elements.every(type => type === 'integer' || type === 'real')
                    && replacement.rank === 0 && replacement.types.length > 0
                    && replacement.types.every(type => type === 'integer' || type === 'real')
                    ? compoundType(statement.operator, fact.elements, replacement.types) : [];
                const lineCompound = statement.operator !== '=' && !!fact && fact.rank === statement.indices.length
                    && fact.eagerScalarCells === true && !!fact.elements?.length
                    && fact.elements.every(type => type === 'integer' || type === 'real')
                    && statement.indices.every((index, position) => !index.spread
                        && (index.all || selectors[position]?.rank === 0 && selectors[position]?.types.join() === 'integer'))
                    && statement.indices.filter(index => index.all).length === 1
                    && replacement.rank === 0 && replacement.types.length > 0
                    && replacement.types.every(type => type === 'integer' || type === 'real')
                    ? compoundType(statement.operator, fact.elements, replacement.types) : [];
                if (fact?.types.join() === 'fenwick' && statement.indices.length === 1
                    && !statement.indices[0].all && !statement.indices[0].spread
                    && fenwickIndex?.types.join() === 'integer'
                    && fenwickValueTypes.join() === 'integer') {
                    env.set(statement.name, fact);
                } else if (fact?.types.join() === 'record' && fact.fields
                    && statement.indices.length > 0 && statement.indices.every(index =>
                        !index.all && !index.spread && index.value && isLabelLiteral(index.value))) {
                    let expected: ValueFacts | undefined = fact;
                    const path: string[] = [];
                    for (const index of statement.indices) {
                        if (!index.value || !isLabelLiteral(index.value)) break;
                        const field = index.value.name;
                        path.push(`.${field}`);
                        expected = expected?.fields?.[field];
                    }
                    if (expected) checkFieldAssignment(expected, statement.value, statement.operator, env, `record field ${path.join(' ')}`);
                    if (replacement.types.includes('array') && !safeRead(replacement)) forgetNonFunctions(env);
                    for (const source of [env, globalCallEnvs.at(-1)]) if (source) for (const [name, value] of source) {
                        if (value.types.join() === 'record') source.set(name, { ...value, ...stableRecordField(value) });
                    }
                } else if (fact?.types.join() === 'segment' && fact.segmentOperation && fact.elements?.length
                    && (statement.indices.length === 1 || statement.indices.length === 2
                        && fact.segmentOperation === '+')
                    && statement.indices.every((index, position) => !index.all && !index.spread
                        && selectors[position]?.types.join() === 'integer')
                    && replacement.rank === 0 && replacement.types.length > 0
                    && replacement.types.every(type => type === 'integer' || type === 'real')
                    && (!['band', 'bor', 'bxor'].includes(fact.segmentOperation)
                        || replacement.types.every(type => type === 'integer'))
                    && segmentValueTypes.length > 0
                    && segmentValueTypes.every(type => type === 'integer' || type === 'real')) {
                    // Segment aliases may share storage, so widen every known numeric segment.
                    for (const source of [env, globalCallEnvs.at(-1)]) if (source) for (const [name, value] of source) {
                        if (value.types.join() === 'segment' && value.segmentOperation && value.elements?.length) {
                            source.set(name, { ...value,
                                elements: [...new Set([...value.elements, ...segmentValueTypes])] });
                        }
                    }
                } else if (fact?.types.join() === 'index' && statement.operator === '='
                    && statement.indices.every(index => !index.all && !index.spread && !!index.value
                        && (directValue(index.value) || scalarArithmetic(index.value, env)))
                    && (directValue(statement.value) || safeIndexDefault(statement.value, env)
                        || scalarArithmetic(statement.value, env) || scalarBitwise(statement.value, env)
                        || isBinaryExpression(statement.value) && ['and', 'or', 'xor'].includes(statement.value.operator)
                            && [statement.value.left, statement.value.right].every(value => directValue(value)
                                && expressionFacts(value, name => env.get(name)).types.join() === 'boolean'))) {
                    // Pure keys and values leave other facts intact. Named indices may alias any other index,
                    // so every index widens, and its value types are forgotten unless this write is fully typed.
                    const typed = statement.indices.every((index, position) => !!selectors[position]?.types.length
                        && selectors[position]!.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type)))
                        && isAtom(replacement) && replacement.types.length > 0
                        && replacement.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol',
                            'date', 'datetime'].includes(type));
                    for (const source of [env, globalCallEnvs.at(-1)]) if (source) for (const [name, value] of source) {
                        if (value.types.join() === 'index') source.set(name, { ...value,
                            elements: value.elements === undefined || !typed ? undefined
                                : [...new Set([...value.elements, ...replacement.types])] });
                    }
                } else if ((isPlainArrayWrite(statement, integerSelector)
                    || statement.operator === '=' && oneCellSelectors || compound.length > 0
                    || lineWrite || lineCompound.length > 0)
                    && fact?.types.length
                    && fact.types.every(type => type === 'array')) {
                    // Successful writes stay within the established domain. Values
                    // and cell-read safety still need their own proofs.
                    const oneCell = (oneCellSelectors || indexedCells) && isAtom(replacement)
                        && replacement.types.length > 0;
                    const safeCells = oneCell || lineWrite || lineCompound.length > 0;
                    env.set(statement.name, { ...fact, elementRecord: undefined,
                        acceptedArrayContract: contract,
                        elements: contractElements(contract) ? [...new Set([...contractElements(contract)!,
                            ...(fact.elements?.includes('missing') || inserted.types.includes('missing') ? ['missing'] : [])])] : (safeCells && fact.elements?.length
                            ? [...new Set([...fact.elements, ...(lineWrite ? lineTypes
                                : lineCompound.length ? lineCompound
                                    : compound.length ? compound : replacement.types)])] : undefined),
                        integers: undefined, positions: undefined, positionFacts: undefined,
                        callbackFreeScalarCells: undefined,
                        eagerScalarCells: safeCells && fact.eagerScalarCells
                            && (lineWrite || lineCompound.length > 0
                                || replacement.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type)))
                            ? true : undefined });
                } else {
                    forgetNonFunctions(env);
                }
            } else if (isExpressionStatement(statement)) {
                const parts = isApplicationExpression(statement.value)
                    ? flattenApplication(statement.value) : [];
                const key = parts[2] && expressionFacts(parts[2], name => env.get(name));
                const receiver = parts[0] && isNameExpression(parts[0]) ? env.get(parts[0].name) : undefined;
                const method = parts.at(-1);
                const safePayload = (node: Expression): boolean => {
                    const fact = expressionFacts(node, name => env.get(name));
                    return safeCollectionValue(node, env) && fact.types.length > 0
                        && (!fact.types.includes('array') || !!fact.eagerScalarCells || !!fact.callbackFreeScalarCells);
                };
                const dequeInsert = parts.length === 3 && receiver?.types.join() === 'deque'
                    && method && isNameExpression(method) && ['pushfront', 'pushback'].includes(method.name)
                    && !env.has(method.name) && safePayload(parts[1]);
                const heapInsert = parts.length === 4 && receiver?.types.join() === 'heap'
                    && method && isNameExpression(method) && method.name === 'enqueue' && !env.has('enqueue')
                    && directValue(parts[1]) && ['integer', 'real', 'text'].includes(expressionFacts(parts[1], name => env.get(name)).types.join())
                    && safePayload(parts[2]);
                const collectionRemove = parts.length === 3 && ['set', 'counter'].includes(receiver?.types.join() ?? '')
                    && isNameExpression(parts[1]) && parts[1].name === 'remove' && !env.has('remove')
                    && safePayload(parts[2]);
                const collectionAdd = parts.length === 3 && isNameExpression(parts[0])
                    && ['set', 'counter'].includes(env.get(parts[0].name)?.types.join() ?? '')
                    && isNameExpression(parts[1]) && parts[1].name === 'add' && !env.has('add')
                    && safeCollectionValue(parts[2], env) && key && (isAtom(key) && key.types.length > 0
                        && key.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol',
                            'date', 'datetime'].includes(type)) || key.types.join() === 'array'
                            && key.eagerScalarCells === true);
                // A direct leading argument is read before the call can change captured bindings.
                const argument = isApplicationExpression(statement.value) && isNameExpression(parts[0]) ? parts[0] : undefined;
                const argumentFacts = argument && env.get(argument.name);
                if (!collectionAdd && !dequeInsert && !heapInsert && !collectionRemove) invalidateCalls(statement.value, env);
                inspect(statement.value, env);
                if (argument && argumentFacts?.types.length) expressions.set(argument, argumentFacts);
                if (collectionAdd && isNameExpression(parts[0])) insertCollectionElement(parts[0].name,
                    key!, parts[2], env);
                if ((dequeInsert || heapInsert) && isNameExpression(parts[0])) {
                    const payload = parts[dequeInsert ? 1 : 2];
                    insertCollectionElement(parts[0].name, expressionFacts(payload, name => env.get(name)), payload, env);
                }
                if (calls.directNoReturnCall(statement.value, env)) return false;
            } else if (isOptionStatement(statement) || isArgumentStatement(statement)) {
                if (statement.defaultValue) invalidateCalls(statement.defaultValue, env);
                env.set(statement.name, statement.many ? externalArray(statement.valueType)
                    : externalScalar(statement.valueType, env.get(statement.name)));
            } else if (isFlagStatement(statement)) {
                env.set(statement.name, externalScalar('boolean', env.get(statement.name)));
            } else if (isUseStatement(statement) && statement.path && statement.alias && loadModule) {
                if (importedAliases.has(statement.alias)) {
                    invalidateImportedAlias(statement.alias, env);
                    continue;
                }
                const module = loadModule(statement.path);
                if (!module) continue;
                const definitions = new Map(module.statements.filter(isFunctionStatement)
                    .map(definition => [definition.name, definition]));
                importedAliases.add(statement.alias);
                for (const [name] of definitions) {
                    const qualified = `${statement.alias}.${name}`;
                    const binding: ValueFacts = { types: ['function'] };
                    env.set(qualified, binding);
                    imported.set(qualified, { program: module, name, binding, functions: definitions });
                }
            } else if (isUseStatement(statement) && !statement.path) {
                // Opening a standard module does not alter existing bindings.
            } else if (isFunctionStatement(statement)) {
                const fact = { types: ['function'] };
                env.set(statement.name, fact);
                functionBindings.set(statement.name, fact);
                functions.set(statement.name, statement);
                if (functionYields(statement).length) {
                    const { yields, cells } = generatorCells(statement,
                        statement.parameters.map(() => UNKNOWN_VALUE));
                    const known = yieldTypes(cells);
                    if (known.length > 1) diagnostics.push({ node: yields.find((_, index) =>
                        yieldTypes(cells.slice(0, index + 1)).length > 1)?.value ?? statement,
                        kind: 'TypeError', message: `${statement.name} yields incompatible types: ${known.join(' and ')}` });
                }
            } else if (isIfStatement(statement)) {
                const paths = conditionalPaths(statement, env, diagnostics, inspect, invalidateCalls);
                const survivors: Map<string, ValueFacts>[] = [];
                for (const path of paths) {
                    const start = diagnostics.length;
                    if (statements(path.items, path.env)) survivors.push(path.env);
                    if (paths.length > 1) diagnostics.length = start;
                }
                if (!survivors.length) return false;
                // A terminating branch may have changed a captured binding before
                // it terminates; keep that possibility for later diagnostics.
                mergeEnvironments(env, paths.map(path => path.env));
            } else if (isForStatement(statement)) {
                loops.loop(statement, env);
            } else if (isTryStatement(statement)) {
                if (!paths.returnPaths([statement], env).fallsThrough) return false;
            } else {
                // Unsupported statements may mutate bindings through closures or imports.
                for (const [name, fact] of env) env.set(name, invalidate(fact));
            }
        }
        return true;
    }

    statements(program.statements, bindings);
    const functionResults = examples.map(example => {
        const definition = functions.get(example.name);
        const ranks = example.body && definition ? declaredRanks(definition) : undefined;
        // A collection the test filled with module-function results holds what those calls return.
        const inputs = example.arguments.map((fact, index) => {
            if (ranks && typeof ranks !== 'string' && ranks.ranks[index] === 0
                && !fact.types.length && fact.rank === undefined) fact = { ...fact, rank: 0, shape: [] };
            const sites = example.constructions?.[index];
            if (!sites) return fact;
            let collection: ValueFacts = { ...fact, elements: [], collectionId: nextCollectionId++ };
            for (const site of sites) {
                calls.resetBudget();
                collection = withInsertedElement(collection, calls.call(site.name, site.arguments, bindings));
            }
            return collection;
        });
        calls.resetBudget();
        return calls.call(example.name, inputs, bindings, undefined, example.body);
    });
    calls.validateDeclarations(bindings);
    diagnostics.push(...requirementDiagnostics(requirements.conflicts, diagnostics));
    const unique = diagnostics.filter((diagnostic, index) => !diagnostics.slice(0, index).some(previous =>
        previous.node === diagnostic.node && previous.message === diagnostic.message));
    return { diagnostics: unique, bindings, expressions, assignments, functions, functionResults, requirements, imports: imported,
        relationships: calls.validRelationships(bindings) };
}

function dataDependentLength(operation: Operation): boolean {
    return operation.dataLength === true || !!operation.shape?.find(shape => shape.args.length === 1)?.result
        ?.some(term => term !== null && typeof term === 'object' && 'exists' in term);
}

/** A `many` command-line value: one array whose length is fixed when the program starts. */
function externalArray(valueType: string): ValueFacts {
    const elements = declaredType(valueType, false);
    return { types: ['array'], rank: 1, shape: [null], dims: [freshDim('arg')], acceptedTypes: ['array'],
        acceptedArrayRank: 1, ...(elements.length ? { elements } : {}) };
}

/** A declared CLI scalar keeps a validated existing binding, but its default is not a constant. */
function externalScalar(valueType: string, existing?: ValueFacts): ValueFacts {
    const types = declaredType(valueType, false);
    if (!types.length) return UNKNOWN_VALUE;
    if (existing?.types.join() === types.join()) return existing;
    return { types, acceptedTypes: types, rank: types.join() === 'text' ? 1 : 0,
        shape: types.join() === 'text' ? [null] : [] };
}
