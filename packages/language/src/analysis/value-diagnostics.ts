import { AstUtils, type AstNode } from 'langium';
import {
    isApplicationExpression, isAllAxisExpression, isNameExpression, isNumberLiteral, isStringLiteral, isParenthesizedExpression,
    isArrayExpression, isMaterializeExpression, isNewStructureExpression, isUnaryExpression, isBooleanLiteral, isLabelLiteral,
    isArrayAssignmentStatement, isAssignmentStatement, isIndexAssignmentStatement, isBinaryExpression,
    isExpressionStatement, isStatement, isExpression,
    isBreakStatement, isContinueStatement, isForStatement, isFunctionStatement, isIfStatement, isReturnStatement, isStdinExpression,
    isAddStatement, isArgumentStatement, isPushStatement, isTryStatement, isUnpackStatement, isUseStatement, isYieldStatement,
    isFirstIndexWhereExpression, isFirstWhereExpression, isTakeWhileExpression,
    type Expression, type Program, type Statement, type FunctionStatement, type ForStatement,
    type TryStatement,
} from '../generated/ast.js';
import { compoundType, type Types } from './types.js';
import { flattenApplication, inlineSliceOperands } from '../expressions.js';
import { findOperation } from '../operations.js';
import { arrayRank, conditionalPaths, contractRank, invalidate, mergeEnvironments, settledShape } from './control-flow.js';
import { bindingRankConflict, bindingRankMessage, bindingTypeMessage,
    provenBindingTypeConflict } from '../binding-rule.js';
import { functionEffects, isPlainArrayWrite } from './function-effects.js';
import { functionYields, generatorCells, yieldTypes } from './function-yields.js';
import { directValue, safeCollectionValue, safeEmptyArrayIteration, safeIndexDefault, safeIndexedIteration, safeIndexedSource, safeRead, scalarArithmetic, scalarBitwise } from './value-safety.js';
import { expressionFacts } from './value-facts.js';
import { hasCallbackFreeFindProof } from './operation-proofs.js';
import { incompatibleShapes, isAtom, joinValueFacts, stableRecordField, UNKNOWN_VALUE,
    type ValueFacts, type FactLookup } from './value-domain.js';

export interface ValueDiagnostic {
    readonly node: AstNode;
    readonly message: string;
    readonly kind: 'TypeError' | 'DimensionMismatch';
}

export interface ValueAnalysis {
    readonly diagnostics: readonly ValueDiagnostic[];
    readonly bindings: ReadonlyMap<string, ValueFacts>;
    readonly expressions: ReadonlyMap<Expression, ValueFacts>;
    readonly functions: ReadonlyMap<string, FunctionStatement>;
    readonly functionResults: readonly ValueFacts[];
}

/** A non-executing pass. Unknown facts never justify a diagnostic. */
export function analyzeValues(program: Program, initial: ReadonlyMap<string, ValueFacts> = new Map(),
    declarations: ReadonlyMap<string, FunctionStatement> = new Map(),
    examples: readonly { name: string; arguments: readonly ValueFacts[] }[] = [],
    loadModule?: (path: string) => Program | undefined): ValueAnalysis {
    const diagnostics: ValueDiagnostic[] = [];
    const expressions = new Map<Expression, ValueFacts>();
    const bindings = new Map(initial);
    const numeric = new Set(['integer', 'real']);
    const functions = new Map(declarations);
    const functionBindings = new Map([...functions.keys()].map(name => [name, bindings.get(name)]));
    const imported = new Map<string, { program: Program; name: string; binding: ValueFacts;
        functions: ReadonlyMap<string, FunctionStatement> }>();
    const importedAliases = new Set<string>();
    function invalidateImportedAlias(alias: string, env: Map<string, ValueFacts>): void {
        for (const name of imported.keys()) if (name.startsWith(`${alias}.`)) {
            env.set(name, invalidate(env.get(name)));
        }
    }
    const activeCalls = new Set<string>();
    const recursiveProbes = new Map<string, { inputs: readonly ValueFacts[]; result: ValueFacts;
        seen: boolean; valid: boolean }>();
    const globalCallEnvs: Map<string, ValueFacts>[] = [];
    const noReturnFunctions = new WeakMap<FunctionStatement, boolean>();
    let remainingCalls = 100;
    const privateBindings: Set<string>[] = [];

    function directNoReturnCall(expression: Expression, env: ReadonlyMap<string, ValueFacts>): boolean {
        const parts = isApplicationExpression(expression) ? flattenApplication(expression) : [expression];
        const target = parts.at(-1);
        if (!target || !isNameExpression(target)) return false;
        if (target.name === 'raise' && !env.has('raise') && (parts.length === 2 || parts.length === 3)) return true;
        const definition = functions.get(target.name);
        if (!definition || env.get(target.name) !== functionBindings.get(target.name)
            || definition.parameters.length !== parts.length - 1) return false;
        let noReturn = noReturnFunctions.get(definition);
        if (noReturn === undefined) {
            noReturn = !functionYields(definition).length && ![...AstUtils.streamAllContents(definition)]
                .some(node => isReturnStatement(node)
                    && AstUtils.getContainerOfType(node, isFunctionStatement) === definition);
            noReturnFunctions.set(definition, noReturn);
        }
        return noReturn;
    }

    const numericInput = (fact: ValueFacts): boolean => fact.types.length > 0
        && (fact.rank === 0 && fact.types.every(type => type === 'integer' || type === 'real')
            || fact.types.join() === 'array' && fact.rank !== undefined && fact.rank > 0
                && !!(fact.eagerScalarCells || fact.callbackFreeScalarCells)
                && !!fact.elements?.length && fact.elements.every(type => type === 'integer' || type === 'real'));
    const widenedInput = (fact: ValueFacts): ValueFacts => ({ types: fact.types, rank: fact.rank,
        shape: Array(fact.rank!).fill(null), ...(fact.elements ? { elements: fact.elements } : {}),
        ...(fact.eagerScalarCells ? { eagerScalarCells: true as const } : {}),
        ...(fact.callbackFreeScalarCells ? { callbackFreeScalarCells: true as const } : {}) });
    const sameNumericInput = (left: ValueFacts, right: ValueFacts): boolean => numericInput(right)
        && left.types.join() === right.types.join() && left.rank === right.rank
        && left.elements?.join() === right.elements?.join();

    function numericRecursionEligible(name: string, definition: FunctionStatement): boolean {
        if (definition.$container.$type !== 'Program') return false;
        const nodes = [...AstUtils.streamAllContents(definition)];
        if (nodes.some(node => isFunctionStatement(node) || isTryStatement(node) || isYieldStatement(node)
            || isStdinExpression(node) || isArrayAssignmentStatement(node) || isIndexAssignmentStatement(node)
            || isAddStatement(node) || isPushStatement(node))) return false;
        const locals = new Set([...definition.parameters, ...nodes.filter(isAssignmentStatement).map(node => node.name),
            ...nodes.filter(isUnpackStatement).flatMap(node => node.names),
            ...nodes.filter(isForStatement).flatMap(node => loopBinding(node.condition)?.names ?? [])]);
        if (locals.has(name)) return false;
        const numericSyntax = (part: Expression): boolean => isNameExpression(part) || isNumberLiteral(part)
            || isParenthesizedExpression(part) && numericSyntax(part.value)
            || isUnaryExpression(part) && ['+', '-'].includes(part.operator) && numericSyntax(part.operand)
            || isBinaryExpression(part) && ['+', '-', '*', '/', '//', '%', '**'].includes(part.operator)
                && numericSyntax(part.left) && numericSyntax(part.right);
        return nodes.filter(isNameExpression).every(node => {
            if (node.name === name) {
                const parent = node.$container;
                if (!isApplicationExpression(parent)) return false;
                let call: AstNode = parent;
                while (isApplicationExpression(call.$container)) call = call.$container;
                if (!isApplicationExpression(call)) return false;
                const parts = flattenApplication(call);
                return parts.at(-1) === node && parts.length === definition.parameters.length + 1
                    && parts.slice(0, -1).every(numericSyntax);
            }
            return locals.has(node.name) || ['len', 'min', 'max', 'odd'].includes(node.name)
                && !bindings.has(node.name);
        });
    }

    function call(name: string, arguments_: readonly ValueFacts[], caller: Map<string, ValueFacts>, site?: Expression): ValueFacts {
        const external = imported.get(name);
        if (external && caller.get(name) === external.binding
            && external.functions.get(external.name)?.parameters.length === arguments_.length) {
            return analyzeValues(external.program, new Map(), new Map(),
                [{ name: external.name, arguments: arguments_ }]).functionResults[0];
        }
        const definition = functions.get(name);
        if (!definition || caller.get(name) !== functionBindings.get(name)
            || definition.parameters.length !== arguments_.length) return UNKNOWN_VALUE;
        if (activeCalls.has(name)) {
            const probe = recursiveProbes.get(name);
            if (!probe) return UNKNOWN_VALUE;
            probe.seen = true;
            probe.valid &&= arguments_.every((fact, index) => sameNumericInput(probe.inputs[index], fact));
            return probe.result;
        }
        if (remainingCalls-- <= 0) return UNKNOWN_VALUE;
        const yields = functionYields(definition);
        if (yields.length) {
            // A generator call creates a sequence without executing its body.
            const { cells } = generatorCells(definition, arguments_);
            const known = yieldTypes(cells);
            const declarationKnown = yieldTypes(generatorCells(definition,
                definition.parameters.map(() => UNKNOWN_VALUE)).cells);
            if (site && known.length > 1 && declarationKnown.length <= 1) diagnostics.push({ node: site,
                kind: 'TypeError', message: `${name} yields incompatible types: ${known.join(' and ')}` });
            const elements = cells.length && cells.every(cell => cell.types.length) ? known : undefined;
            const scalars = cells.every(cell => cell.rank === 0);
            return { types: ['sequence'], ...(elements ? { elements } : {}),
                ...(scalars ? { rank: 1, shape: [cells.length ? null : 0] } : {}) };
        }
        const globalEnv = globalCallEnvs.at(-1) ?? caller;
        const local = new Map(definition.$container.$type === 'Program' ? globalEnv : caller);
        // Top-level functions create local bindings on assignment, rather than
        // inheriting the assignment contracts of equally named globals.
        for (const node of AstUtils.streamAllContents(definition)) {
            if (isAssignmentStatement(node) && !definition.parameters.includes(node.name)) local.delete(node.name);
        }
        definition.parameters.forEach((parameter, index) => local.set(parameter, {
            ...arguments_[index], acceptedArrayRank: arrayRank(arguments_[index]), acceptedTypes: arguments_[index].types,
        }));
        if (!definition.parameters.includes('index')) local.set('index', { types: ['index'], elements: [] });
        // Runtime declares local functions before executing the body, including
        // declarations textually after an early return.
        const hoisted = definition.statements.filter(isFunctionStatement).map(nested => ({
            nested, previous: functions.get(nested.name), previousBinding: functionBindings.get(nested.name),
            hadBinding: functionBindings.has(nested.name),
        }));
        for (const { nested } of hoisted) {
            const fact: ValueFacts = { types: ['function'] };
            local.set(nested.name, fact);
            functions.set(nested.name, nested);
            functionBindings.set(nested.name, fact);
        }
        activeCalls.add(name);
        globalCallEnvs.push(globalEnv);
        const nodes = [...AstUtils.streamAllContents(definition)];
        const nestedWrites = new Set(nodes.filter(isFunctionStatement).flatMap(nested =>
            [...AstUtils.streamAllContents(nested)].flatMap(node => isAssignmentStatement(node) ? [node.name]
                : isFunctionStatement(node) ? [node.name] : isUnpackStatement(node) ? node.names : isForStatement(node)
                    ? loopBinding(node.condition)?.names ?? [] : [])));
        privateBindings.push(new Set([...definition.parameters, ...nodes.filter(isAssignmentStatement)
            .map(statement => statement.name).filter(name => !name.includes('.')), ...nodes.filter(isForStatement)
            .flatMap(loop => loopBinding(loop.condition)?.names ?? [])]
            .filter(name => name !== '#' && !nestedWrites.has(name))));
        const diagnosticStart = diagnostics.length;
        try {
            const result = returnPaths(definition.statements, local);
            // Reaching the end throws: only paths that actually return contribute
            // a result value. With no proven return, the result remains unknown.
            const ordinary = joinValueFacts(result.values);
            if (ordinary.types.length || !arguments_.every(numericInput)
                || !numericRecursionEligible(name, definition)) return ordinary;
            const inputs = arguments_.map(widenedInput);
            const widened = new Map(local);
            definition.parameters.forEach((parameter, index) => widened.set(parameter, {
                ...inputs[index], acceptedTypes: inputs[index].types,
                acceptedArrayRank: arrayRank(inputs[index]),
            }));
            const before = new Map(expressions);
            const start = diagnostics.length;
            let base = joinValueFacts(result.values.filter(fact => fact.types.length));
            if (!base.types.length) {
                try {
                    base = joinValueFacts(returnPaths(definition.statements, new Map(widened)).values
                        .filter(fact => fact.types.length));
                } finally {
                    diagnostics.length = start;
                    expressions.clear();
                    for (const [node, fact] of before) expressions.set(node, fact);
                }
            }
            if (base.rank !== 0 || !base.types.length
                || !base.types.every(type => type === 'integer' || type === 'real')) return ordinary;
            const probe = { inputs, result: base, seen: false, valid: true };
            recursiveProbes.set(name, probe);
            let inferred: ValueFacts;
            try {
                inferred = joinValueFacts(returnPaths(definition.statements, widened).values);
            } finally {
                recursiveProbes.delete(name);
                diagnostics.length = start;
                expressions.clear();
                for (const [node, fact] of before) expressions.set(node, fact);
            }
            return probe.valid && probe.seen && inferred.rank === 0 && inferred.types.length
                && inferred.types.every(type => base.types.includes(type)) ? inferred : ordinary;
        } finally {
            activeCalls.delete(name);
            globalCallEnvs.pop();
            privateBindings.pop();
            for (const { nested, previous, previousBinding, hadBinding } of hoisted.reverse()) {
                if (previous) functions.set(nested.name, previous);
                else functions.delete(nested.name);
                if (hadBinding) functionBindings.set(nested.name, previousBinding);
                else functionBindings.delete(nested.name);
            }
            if (site) for (let index = diagnosticStart; index < diagnostics.length; index++) {
                diagnostics[index] = { ...diagnostics[index], node: site, message: `${name}: ${diagnostics[index].message}` };
            }
        }
    }

    interface ReturnPaths {
        values: ValueFacts[];
        fallsThrough: boolean;
        breaks: Map<string, ValueFacts>[];
        continues: Map<string, ValueFacts>[];
    }
    function returnPaths(items: readonly Statement[], env: Map<string, ValueFacts>): ReturnPaths {
        const values: ValueFacts[] = [];
        const breaks: Map<string, ValueFacts>[] = [];
        const continues: Map<string, ValueFacts>[] = [];
        for (const statement of items) {
            if (isBreakStatement(statement)) return { values, fallsThrough: false, breaks: [...breaks, env], continues };
            if (isContinueStatement(statement)) return { values, fallsThrough: false, breaks, continues: [...continues, env] };
            if (isReturnStatement(statement)) {
                const beforeEffects = statement.value && directCallBeforeEffects(statement.value, env);
                if (statement.value) invalidateCalls(statement.value, env);
                const observed = statement.value ? beforeEffects ?? inspect(statement.value, env) : UNKNOWN_VALUE;
                const contract = statement.value && isNameExpression(statement.value)
                    ? env.get(statement.value.name) : undefined;
                const result = observed.types.length || !contract?.acceptedTypes?.length ? observed
                    : { types: contract.acceptedTypes, acceptedArrayRank: contractRank(contract) };
                if (!statement.value || !directNoReturnCall(statement.value, env)) values.push(result);
                return { values, fallsThrough: false, breaks, continues };
            }
            if (isIfStatement(statement)) {
                const branches = conditionalPaths(statement, env, diagnostics, inspect, invalidateCalls);
                const survivors: Map<string, ValueFacts>[] = [];
                for (const branch of branches) {
                    const local = branch.env;
                    const diagnosticStart = diagnostics.length;
                    const result = returnPaths(branch.items, local);
                    // A call-site fact must not accuse an unproven branch of executing.
                    // Return facts still join all possible paths conservatively.
                    if (branches.length > 1) diagnostics.length = diagnosticStart;
                    values.push(...result.values);
                    breaks.push(...result.breaks);
                    continues.push(...result.continues);
                    if (result.fallsThrough) survivors.push(local);
                }
                if (!survivors.length) return { values, fallsThrough: false, breaks, continues };
                mergeEnvironments(env, survivors);
            } else if (isTryStatement(statement) && !statement.finallyStatements.length) {
                if (statement.statements.length === 1 && isExpressionStatement(statement.statements[0])
                    && directNoReturnCall(statement.statements[0].value, env)) {
                    return { values, fallsThrough: false, breaks, continues };
                }
                const caughtFacts = tryPrefixFacts(statement, env);
                const success = new Map(env);
                const tried = returnPaths(statement.statements, success);
                values.push(...tried.values);
                breaks.push(...tried.breaks);
                continues.push(...tried.continues);
                const survivors = tried.fallsThrough ? [success] : [];
                for (const clause of statement.catches) {
                    // An error can occur after any prefix of the try body. Its
                    // bindings cannot be assumed to have their entry values.
                    const caught = new Map(env);
                    forgetNonFunctions(caught);
                    if (caughtFacts) for (const [name, fact] of caughtFacts) caught.set(name, fact);
                    caught.set(clause.errorName, UNKNOWN_VALUE);
                    const start = diagnostics.length;
                    const path = returnPaths(clause.statements, caught);
                    diagnostics.length = start;
                    values.push(...path.values);
                    breaks.push(...path.breaks);
                    continues.push(...path.continues);
                    if (path.fallsThrough) survivors.push(caught);
                }
                if (!survivors.length) return { values, fallsThrough: false, breaks, continues };
                mergeEnvironments(env, survivors);
            } else if (isForStatement(statement)) {
                const contents = [...AstUtils.streamAllContents(statement)];
                if (contents.some(isReturnStatement)) values.push(...loopReturnPaths(statement, env));
                else loop(statement, env);
            } else if (isAssignmentStatement(statement) || isArrayAssignmentStatement(statement)
                || isIndexAssignmentStatement(statement)
                || isAddStatement(statement) || isPushStatement(statement)
                || isUnpackStatement(statement)
                || isExpressionStatement(statement) || isFunctionStatement(statement)) {
                if (!statements([statement], env)) return { values, fallsThrough: false, breaks, continues };
            } else {
                // Unknown control flow may return, yield, throw or alter captured state.
                return { values: [UNKNOWN_VALUE], fallsThrough: true, breaks, continues };
            }
        }
        return { values, fallsThrough: true, breaks, continues };
    }

    function emptyBuiltinRange(source: Expression | undefined, collection: ValueFacts): boolean {
        while (source && isParenthesizedExpression(source)) source = source.value;
        return !!source && isBinaryExpression(source)
            && (source.operator === 'to' || source.operator === 'until')
            && !inlineSliceOperands(source) && collection.types.join() === 'sequence'
            && collection.shape?.[0] === 0;
    }

    const writtenBindings = (node: AstNode): readonly string[] => isAssignmentStatement(node) ? [node.name]
        : isUnpackStatement(node) ? node.names.filter(name => name !== '#') : [];
    function widenArrayWrite(node: AstNode, env: Map<string, ValueFacts>): void {
        if (!isArrayAssignmentStatement(node)) return;
        const fact = env.get(node.name);
        if (fact && fact.types.join() !== 'segment') env.set(node.name, { ...fact,
            elements: undefined, positions: undefined, positionFacts: undefined, integers: undefined,
            eagerScalarCells: undefined, callbackFreeScalarCells: undefined });
    }
    function widenLoopExit(contents: readonly AstNode[], env: Map<string, ValueFacts>, preserved: ReadonlySet<string> = new Set()): void {
        for (const node of contents) {
            for (const name of writtenBindings(node)) {
                const fact = env.get(name);
                const rank = contractRank(fact);
                env.set(name, preserved.has(name) ? { ...fact, types: fact?.types ?? [],
                    shape: rank === undefined ? undefined : Array(rank).fill(null),
                    integers: undefined, positions: undefined, positionFacts: undefined }
                    : { types: fact?.acceptedTypes ?? [], acceptedTypes: fact?.acceptedTypes,
                        acceptedArrayRank: rank, ...settledShape(fact?.acceptedTypes ?? [], rank) });
            }
            if (!isArrayAssignmentStatement(node) || !preserved.has(node.name)) widenArrayWrite(node, env);
        }
    }
    function insertCollectionElement(name: string, value: ValueFacts, node: Expression,
        env: Map<string, ValueFacts>): void {
        const collection = env.get(name);
        if (!collection || !['set', 'counter', 'queue', 'stack', 'deque', 'heap'].includes(collection.types.join())
            || !value.types.length) return;
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
        if (!accepted?.length) env.set(name, { ...collection, elements: value.types,
            ...(rank !== undefined ? { elementRank: rank } : {}) });
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
                } else if (isIndexAssignmentStatement(item)) {
                    if (!item.keys.every(key => directValue(key) && isAtom(expressionFacts(key, name => prefix.get(name))))
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
                if (!privateNames?.has(name) && !(privateNames && name === 'index')) return [];
                const fact = joinValueFacts(paths.map(path => path.get(name) ?? UNKNOWN_VALUE));
                return fact.types.length ? [[name, fact] as const] : [];
            }));
        } finally {
            diagnostics.length = start;
            expressions.clear();
            for (const [node, fact] of beforeExpressions) expressions.set(node, fact);
        }
    }
    const forgetNonFunctions = (env: Map<string, ValueFacts>): void => {
        const protectedNames = privateBindings.at(-1);
        for (const [name, fact] of env) if (!fact.types.includes('function')) {
            const accepted = fact.acceptedTypes ?? fact.types;
            const privateValue = protectedNames?.has(name) && accepted.length > 0;
            const rank = contractRank(fact);
            // Unknown calls may mutate a private value, but cannot rebind its uncaptured local name.
            env.set(name, privateValue && fact.types.length > 0
                && fact.types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                && accepted.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                ? { types: accepted, acceptedTypes: accepted, rank: 0, shape: [] }
                : privateValue && fact.types.join() === 'text' && accepted.join() === 'text'
                    ? { types: ['text'], acceptedTypes: ['text'], rank: 1, shape: [null] }
                    : privateValue && fact.types.join() === 'array' && accepted.join() === 'array'
                        ? { types: ['array'], acceptedTypes: ['array'], acceptedArrayRank: rank,
                            ...(rank !== undefined ? { rank, shape: Array(rank).fill(null) } : {}) }
                        : privateValue && fact.types.length === 1 && accepted.join() === fact.types.join()
                            ? { types: fact.types, acceptedTypes: accepted }
                            : invalidate(fact));
        }
    };
    function loopBinding(condition: Expression | undefined): { names: readonly string[]; iterable: Expression } | undefined {
        if (!condition || !isBinaryExpression(condition) || condition.operator !== 'in') return undefined;
        const parts = flattenApplication(condition.left);
        if (parts.length < 1 || parts.length > 2 || !parts.every(part =>
            isNameExpression(part) || isAllAxisExpression(part))) return undefined;
        return { names: parts.map(part => isNameExpression(part) ? part.name : '#'), iterable: condition.right };
    }

    function bindIteration(env: Map<string, ValueFacts>, names: readonly string[], collection: ValueFacts): void {
        if (names[0] !== '#') {
            if (collection.types.join() === 'array' && collection.rank !== undefined && collection.rank > 1) {
                env.set(names[0], { types: ['array'], acceptedTypes: ['array'],
                    rank: collection.rank - 1, acceptedArrayRank: collection.rank - 1,
                    shape: collection.shape?.slice(1) ?? Array(collection.rank - 1).fill(null),
                    ...(collection.eagerScalarCells || collection.callbackFreeScalarCells
                        ? { elements: collection.elements, callbackFreeScalarCells: true as const } : {}) });
            } else {
                const types = collection.elements ?? (collection.types.join() === 'text' ? ['text'] : []);
                env.set(names[0], { types, acceptedTypes: types,
                    ...(types.length && types.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type))
                        ? { rank: 0, shape: [] } : types.join() === 'text' ? { rank: 1, shape: [null] }
                            : types.join() === 'array' && collection.elementRank !== undefined
                                ? { rank: collection.elementRank, acceptedArrayRank: collection.elementRank,
                                    shape: Array(collection.elementRank).fill(null) } : {}) });
            }
        }
        if (names[1] && names[1] !== '#') env.set(names[1], {
            types: ['integer'], acceptedTypes: ['integer'], rank: 0, shape: [],
        });
    }

    function loop(statement: ForStatement, env: Map<string, ValueFacts>): void {
        const condition = statement.condition;
        if (condition && isBooleanLiteral(condition) && !condition.value) return;
        const candidate = loopBinding(condition);
        const source = candidate?.iterable ?? condition;
        if (source) invalidateCalls(source, env);
        const collection = source ? inspect(source, env) : UNKNOWN_VALUE;
        const membership = candidate && (candidate.names.length === 1
            || safeIndexedIteration(collection) && safeIndexedSource(candidate.iterable)
            || safeEmptyArrayIteration(candidate.iterable, collection)) ? candidate : undefined;
        const count = membership && collection.rank !== undefined && collection.rank > 0
            ? collection.shape?.[0] : undefined;
        if (count === 0) {
            if (!emptyBuiltinRange(source, collection)
                && !safeEmptyArrayIteration(source, collection)
                && !(source && safeIndexedIteration(collection) && safeIndexedSource(source))) {
                forgetNonFunctions(env);
            }
            return;
        }
        const contents = [...AstUtils.streamAllContents(statement)];
        const hasExit = contents.some(node => isBreakStatement(node) || isContinueStatement(node));
        if (condition && isBinaryExpression(condition) && condition.operator === 'in' && !membership
            || contents.some(node => isStatement(node) && !isExpression(node) && !isAssignmentStatement(node)
                && !isUnpackStatement(node) && !isArrayAssignmentStatement(node) && !isIndexAssignmentStatement(node)
                && !isAddStatement(node) && !isPushStatement(node) && !isExpressionStatement(node)
                && !isIfStatement(node) && !isForStatement(node) && !isTryStatement(node)
                && !isBreakStatement(node) && !isContinueStatement(node))) {
            // Mutation and non-local exits need their own flow rules.
            forgetNonFunctions(env);
            return;
        }
        const writes = new Set(contents.filter(isArrayAssignmentStatement).map(node => node.name));
        const writesIndex = contents.some(isIndexAssignmentStatement);
        const rebound = new Set(contents.flatMap(writtenBindings));
        const touchesIndex = writesIndex || [...writes].some(name => env.get(name)?.types.join() === 'index'
            || rebound.has(name) || !env.has(name));
        const knownIndices = touchesIndex ? [...env.values()].filter(fact => fact.types.join() === 'index') : [];
        const indexCandidate = knownIndices.length && knownIndices.every(fact => fact.elements !== undefined)
            ? [...new Set(knownIndices.flatMap(fact => fact.elements!))] : undefined;
        const candidates = new Map([...writes].flatMap(name => {
            const fact = env.get(name);
            return !rebound.has(name) && fact?.types.join() === 'array' && fact.rank !== undefined && fact.rank > 0
                && fact.eagerScalarCells && fact.elements?.length
                ? [[name, fact] as const] : [];
        }));
        const numeric = new Map([...rebound].flatMap(name => {
            const fact = env.get(name);
            return !writes.has(name) && fact?.types.join() === 'array' && fact.rank !== undefined && fact.rank > 0
                && (fact.eagerScalarCells || fact.callbackFreeScalarCells)
                && fact.elements?.length && fact.elements.every(type => type === 'integer' || type === 'real')
                ? [[name, { ...fact, shape: Array(fact.rank).fill(null), elements: ['integer', 'real'] as Types,
                    eagerScalarCells: undefined, callbackFreeScalarCells: true as const,
                    integers: undefined, positions: undefined, positionFacts: undefined }] as const] : [];
        }));
        const prepare = (preserved: ReadonlySet<string>, indexSeed?: readonly string[],
            numericSeeds: ReadonlyMap<string, ValueFacts> = new Map(),
            arraySeeds: ReadonlyMap<string, ValueFacts> = candidates): Map<string, ValueFacts> => {
            const local = new Map(env);
            for (const name of preserved) if (arraySeeds.has(name)) local.set(name, arraySeeds.get(name)!);
            // Other writes still widen before the body: a later iteration may
            // observe a different value. Preserved cells need a closure proof.
            for (const node of contents) {
                for (const name of writtenBindings(node)) {
                    const previous = local.get(name);
                    const types = previous?.acceptedTypes ?? previous?.types ?? [];
                    const rank = contractRank(previous);
                    local.set(name, numericSeeds.get(name) ?? { types, acceptedTypes: types, acceptedArrayRank: rank,
                        ...settledShape(types, rank) });
                }
                if (!isArrayAssignmentStatement(node) || !preserved.has(node.name)
                    && !(indexSeed !== undefined && local.get(node.name)?.types.join() === 'index')) {
                    widenArrayWrite(node, local);
                }
            }
            if (touchesIndex) {
                for (const [name, fact] of local) if (fact.types.join() === 'index') {
                    local.set(name, { ...fact, elements: indexSeed });
                }
            }
            if (membership) bindIteration(local, membership.names, collection);
            return local;
        };
        const start = diagnostics.length;
        let preserved = new Set<string>();
        let local: Map<string, ValueFacts>;
        const preview = prepare(new Set(candidates.keys()), indexCandidate, numeric);
        const indexWriteTypes = indexCandidate === undefined ? undefined
            : contents.flatMap(node => {
                if (!isIndexAssignmentStatement(node) && (!isArrayAssignmentStatement(node)
                    || preview.get(node.name)?.types.join() !== 'index')) return [];
                const value = expressionFacts(node.value, name => preview.get(name));
                return value.types;
            });
        const effects = functionEffects(name => preview.get(name) === functionBindings.get(name)
            ? functions.get(name) : undefined, name => preview.get(name)?.types.includes('function') ?? false,
        name => preview.has(name), name => preview.get(name));
        const safeCalls = contents.filter(isNameExpression).filter(node =>
            AstUtils.getContainerOfType(node, isForStatement) === statement
                && preview.get(node.name)?.types.includes('function'))
            .every(node => {
                if (indexCandidate !== undefined && !candidates.size && !numeric.size
                    && AstUtils.getContainerOfType(node, isTryStatement)) return true;
                let site: AstNode = node;
                while (isApplicationExpression(site.$container)) site = site.$container;
                const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                if (parts.at(-1) !== node || parts.length - 1 !== functions.get(node.name)?.parameters.length
                    || !parts.slice(0, -1).every(directValue)) return false;
                const inputs = parts.slice(0, -1).map(part => expressionFacts(part, name => preview.get(name)));
                const effect = effects(node.name, inputs);
                return !effect.unknown && !effect.io && !effect.parameters.size && !effect.reboundParameters.size
                    && [...effect.captures].every(name => effect.numericCaptureWrites?.has(name)
                        && safeRead(preview.get(name)))
                    && !effect.bindingCaptures.size && !effect.valueCaptures.size
                    && [...effect.readCaptures].every(name => safeRead(preview.get(name)))
                    && [...effect.readParameters].every(index => safeRead(inputs[index]));
            });
        if (hasExit) {
            const before = new Map(contents.filter(isExpression).map(node => [node, expressions.get(node)] as const));
            const run = (keep: ReadonlySet<string>) => {
                const body = prepare(keep);
                const paths = returnPaths(statement.statements, body);
                return [...paths.breaks, ...paths.continues, ...(paths.fallsThrough ? [body] : [])];
            };
            let exits = candidates.size > 0 && safeCalls ? run(new Set(candidates.keys())) : [];
            const closed = exits.length > 0 && exits.every(path => [...candidates].every(([name, fact]) => {
                const after = path.get(name);
                return after?.types.join() === 'array' && after.rank === fact.rank && after.eagerScalarCells
                    && after.elements?.length && after.elements.every(type => fact.elements!.includes(type));
            }));
            if (closed) preserved = new Set(candidates.keys());
            else {
                diagnostics.length = start;
                for (const [node, prior] of before) {
                    if (prior) expressions.set(node, prior);
                    else expressions.delete(node);
                }
                exits = run(preserved);
            }
            if (count == null || count <= 0) diagnostics.length = start;
            for (const path of exits) widenLoopExit(contents, path, preserved);
            mergeEnvironments(env, [env, ...exits]);
            return;
        }
        if ((candidates.size || numeric.size || indexCandidate !== undefined) && safeCalls) {
            const before = new Map(contents.filter(isExpression).map(node => [node, expressions.get(node)] as const));
            const restore = () => {
                diagnostics.length = start;
                for (const node of contents.filter(isExpression)) {
                    const prior = before.get(node);
                    if (prior) expressions.set(node, prior);
                    else expressions.delete(node);
                }
            };
            let seed = indexCandidate && [...new Set([...indexCandidate, ...(indexWriteTypes ?? [])])];
            if (seed !== undefined) {
                const first = prepare(new Set(candidates.keys()), seed, numeric);
                statements(statement.statements, first);
                const indices = [...env].filter(([, fact]) => fact.types.join() === 'index')
                    .map(([name]) => first.get(name));
                seed = indices.every(fact => fact?.types.join() === 'index' && fact.elements !== undefined)
                    ? [...new Set(indices.flatMap(fact => fact!.elements!))] : undefined;
                restore();
            }
            const attempt = (arrays: ReadonlyMap<string, ValueFacts>) => {
                const trial = prepare(new Set(candidates.keys()), seed, numeric, arrays);
                statements(statement.statements, trial);
                const indexAfter = [...env].filter(([, fact]) => fact.types.join() === 'index')
                    .map(([name]) => trial.get(name));
                const closed = [...arrays].every(([name, fact]) => {
                    const after = trial.get(name);
                    return after?.types.join() === 'array' && after.rank === fact.rank && after.eagerScalarCells
                        && after.elements?.length === fact.elements!.length
                        && after.elements.every(type => fact.elements!.includes(type));
                }) && [...numeric].every(([name, fact]) => {
                    const after = trial.get(name);
                    return after?.types.join() === 'array' && after.rank === fact.rank
                        && (after.eagerScalarCells || after.callbackFreeScalarCells)
                        && after.elements?.length && after.elements.every(type => type === 'integer' || type === 'real');
                }) && (indexCandidate === undefined || seed !== undefined
                    && indexAfter.every(fact => fact?.types.join() === 'index' && fact.elements !== undefined
                        && fact.elements.every(type => seed!.includes(type))));
                return { trial, closed };
            };
            let { trial, closed } = attempt(candidates);
            if (!closed && [...candidates.values()].some(fact => fact.elements?.every(type =>
                type === 'integer' || type === 'real'))) {
                restore();
                const widened = new Map([...candidates].map(([name, fact]) => [name,
                    fact.elements?.every(type => type === 'integer' || type === 'real')
                        ? { ...fact, elements: ['integer', 'real'] as Types } : fact] as const));
                ({ trial, closed } = attempt(widened));
            }
            if (closed) {
                local = trial;
                preserved = new Set([...candidates.keys(), ...numeric.keys(),
                    ...(indexCandidate !== undefined ? [...env].filter(([, fact]) => fact.types.join() === 'index')
                        .map(([name]) => name) : [])]);
            } else {
                restore();
                local = prepare(preserved);
                statements(statement.statements, local);
            }
        } else {
            local = prepare(preserved);
            statements(statement.statements, local);
        }
        if (count == null || count <= 0) diagnostics.length = start;
        // No final-iteration dimensions are proven. Keep contracts, not body values.
        widenLoopExit(contents, local, preserved);
        mergeEnvironments(env, [env, local]);
    }

    function loopReturnPaths(statement: ForStatement, env: Map<string, ValueFacts>): ValueFacts[] {
        const condition = statement.condition;
        if (condition && isBooleanLiteral(condition) && !condition.value) return [];
        const candidate = loopBinding(condition);
        const source = candidate?.iterable ?? condition;
        if (source) invalidateCalls(source, env);
        const collection = source ? inspect(source, env) : UNKNOWN_VALUE;
        const membership = candidate && (candidate.names.length === 1
            || safeIndexedIteration(collection) && safeIndexedSource(candidate.iterable)
            || safeEmptyArrayIteration(candidate.iterable, collection)) ? candidate : undefined;
        const count = membership && collection.rank !== undefined && collection.rank > 0
            ? collection.shape?.[0] : undefined;
        if (count === 0) {
            if (!emptyBuiltinRange(source, collection)
                && !safeEmptyArrayIteration(source, collection)
                && !(source && safeIndexedIteration(collection) && safeIndexedSource(source))) {
                for (const [name, fact] of env) env.set(name, invalidate(fact));
            }
            return [];
        }
        const contents = [...AstUtils.streamAllContents(statement)];
        const rebound = new Set(contents.flatMap(writtenBindings));
        const indexWrites = contents.filter(isArrayAssignmentStatement);
        const indexNames = [...env].filter(([, fact]) => fact.types.join() === 'index');
        const owner = AstUtils.getContainerOfType(statement, isFunctionStatement);
        const directIndex = owner?.statements.indexOf(statement) ?? -1;
        const preceding = directIndex >= 0 ? owner!.statements.slice(0, directIndex) : [];
        const precedingWrites = preceding.flatMap(node => [node, ...AstUtils.streamAllContents(node)]);
        const closedIndexCandidate = indexWrites.length > 0 && indexNames.length > 0
            && indexNames.every(([, fact]) => fact.elements !== undefined)
            && ![...(globalCallEnvs.at(-1)?.values() ?? [])].some(fact => fact.types.join() === 'index')
            && indexWrites.every(write => {
                if (write.operator !== '=' || env.get(write.name)?.types.join() !== 'index') return false;
                const binding = precedingWrites.filter(node => writtenBindings(node).includes(write.name)
                    || isForStatement(node) && loopBinding(node.condition)?.names.includes(write.name)).at(-1);
                return !!binding && isAssignmentStatement(binding) && binding.operator === '='
                    && isNewStructureExpression(binding.value) && binding.value.structure === 'index';
            })
            && !contents.some(node => isIndexAssignmentStatement(node) || isForStatement(node)
                || isTryStatement(node) || isFunctionStatement(node) || isExpressionStatement(node)
                || isAddStatement(node) || isPushStatement(node) || isUnpackStatement(node)
                || isStdinExpression(node))
            && contents.filter(isNameExpression).every(node => env.get(node.name)?.types.length
                && env.get(node.name)!.types.every(type => ['integer', 'real', 'boolean', 'index'].includes(type)));
        const touchesIndex = contents.some(node => isIndexAssignmentStatement(node)
            || isArrayAssignmentStatement(node) && (env.get(node.name)?.types.join() === 'index'
                || rebound.has(node.name) || !env.has(node.name)));
        const prepare = (seed?: readonly string[]): Map<string, ValueFacts> => {
            const local = new Map(env);
            if (touchesIndex) for (const [name, fact] of local) if (fact.types.join() === 'index') {
                local.set(name, { ...fact, elements: seed });
            }
            for (const node of contents) {
                for (const name of writtenBindings(node)) {
                    const previous = local.get(name);
                    const types = previous?.acceptedTypes ?? previous?.types ?? [];
                    const rank = contractRank(previous);
                    local.set(name, { types, acceptedTypes: types, acceptedArrayRank: rank,
                        ...settledShape(types, rank) });
                }
                if (!isArrayAssignmentStatement(node) || seed === undefined
                    || local.get(node.name)?.types.join() !== 'index') widenArrayWrite(node, local);
            }
            if (membership) bindIteration(local, membership.names, collection);
            return local;
        };
        const start = diagnostics.length;
        let local = prepare();
        let returned: ReturnPaths;
        if (closedIndexCandidate) {
            const seed = [...new Set([...indexNames.flatMap(([, fact]) => fact.elements!),
                ...indexWrites.flatMap(write => expressionFacts(write.value, name => local.get(name)).types)])];
            const before = new Map(contents.filter(isExpression).map(node => [node, expressions.get(node)] as const));
            local = prepare(seed);
            returned = returnPaths(statement.statements, local);
            const continuing = [...returned.continues, ...(returned.fallsThrough ? [local] : [])];
            const closed = continuing.every(path => indexNames.every(([name]) => {
                const fact = path.get(name);
                return fact?.types.join() === 'index' && fact.elements !== undefined
                    && fact.elements.every(type => seed.includes(type));
            }));
            if (!closed) {
                diagnostics.length = start;
                for (const [node, prior] of before) {
                    if (prior) expressions.set(node, prior);
                    else expressions.delete(node);
                }
                local = prepare();
                returned = returnPaths(statement.statements, local);
            }
        } else returned = returnPaths(statement.statements, local);
        if (count == null || count <= 0) diagnostics.length = start;
        const exits = [...returned.breaks, ...returned.continues, ...(returned.fallsThrough ? [local] : [])];
        if (exits.length) {
            for (const path of exits) widenLoopExit(contents, path);
            mergeEnvironments(env, [env, ...exits]);
        }
        return returned.values;
    }

    function invalidateCalls(expression: AstNode, env: Map<string, ValueFacts>): void {
        const syntax = new Set(['reduce', 'scan', 'outer', 'rank', 'axis', 'with', 'segment', 'from']);
        const effects = functionEffects(name => env.get(name) === functionBindings.get(name) ? functions.get(name) : undefined,
            name => env.get(name)?.types.includes('function') ?? false,
            name => env.has(name), name => env.get(name));
        const nodes = [expression, ...AstUtils.streamAllContents(expression)];
        const sliceModifiers = new Set(nodes.filter(isBinaryExpression)
            .flatMap(node => inlineSliceOperands(node)?.modifiers ?? []));
        let unknown = false;
        const written = new Set<string>();
        const writtenGlobals = new Set<string>();
        const numericWritten = new Set<string>();
        const numericWrittenGlobals = new Set<string>();
        const unprovenWritten = new Set<string>();
        const unprovenWrittenGlobals = new Set<string>();
        const rebound = new Set<string>();
        for (const node of nodes) {
            if (isStdinExpression(node)) unknown = true;
            if (!isNameExpression(node)) continue;
            if (sliceModifiers.has(node)) continue;
            if (env.get(node.name)?.types.includes('function')) {
                // During the numeric fixed-point check, this recursive call is
                // provisionally pure; its argument and result types are checked
                // before the provisional result can escape the analysis.
                if (activeCalls.has(node.name) && recursiveProbes.has(node.name)) continue;
                let site: AstNode = node;
                while (isApplicationExpression(site.$container)) site = site.$container;
                const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                const external = imported.get(node.name);
                const arity = functions.get(node.name)?.parameters.length
                    ?? external?.functions.get(external.name)?.parameters.length;
                const arguments_ = parts.at(-1) === node && parts.length - 1 === arity
                    ? parts.slice(0, -1)
                    : isApplicationExpression(site) && isApplicationExpression(site.head)
                        && site.arguments.length === 1 && site.arguments[0] === node
                        && site.head.arguments.length + 1 === arity
                        ? [site.head.head, ...site.head.arguments] : undefined;
                const inputs = arguments_?.map(part => expressionFacts(part, name => env.get(name)));
                const result = external && env.get(node.name) === external.binding
                    ? functionEffects(name => external.functions.get(name), name => external.functions.has(name),
                        name => external.functions.has(name))(external.name, inputs)
                    : effects(node.name, inputs);
                // Host input may re-enter Rank. It is identified separately in
                // the summary, but cannot preserve pre-call value facts here.
                unknown ||= result.unknown || result.io;
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
                if (node.name === 'index') {
                    let site: AstNode = node;
                    while (isApplicationExpression(site.$container)
                        || isParenthesizedExpression(site.$container)) site = site.$container;
                    const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                    if (!parts.length || parts[0] === node && parts.slice(1).every(directValue)) continue;
                }
                if (['queue', 'set', 'counter'].includes(node.name)) {
                    let site: AstNode = node;
                    while (isParenthesizedExpression(site.$container)) site = site.$container;
                    if (!isApplicationExpression(site.$container)) continue;
                    if (node.name === 'counter') {
                        const parts = flattenApplication(site.$container);
                        const key = parts[1] && expressionFacts(parts[1], name => env.get(name));
                        if (parts.length === 2 && parts[0] === node && directValue(parts[1])
                            && key && isAtom(key) && key.types.length > 0
                            && key.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol',
                                'date', 'datetime'].includes(type))) continue;
                    }
                    if (node.name === 'queue') {
                        while (isApplicationExpression(site.$container)) site = site.$container;
                        const parts = isApplicationExpression(site) ? flattenApplication(site) : [];
                        if (parts.length === 2 && parts[1] === node) {
                            const source = expressionFacts(parts[0], name => env.get(name));
                            if (safeRead(source) || source.types.join() === 'queue') continue;
                        }
                    }
                }
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
                    if (parts.length === 4 && parts[1] === node && dsu?.types.join() === 'dsu'
                        && parts.slice(2).every(part => {
                            const fact = expressionFacts(part, name => env.get(name));
                            return directValue(part) && isAtom(fact) && fact.types.length > 0
                                && fact.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type));
                        })) continue;
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
        if (!unknown && !written.size && !writtenGlobals.size && !rebound.size) return;
        // An unknown call can change captured bindings. Do not use a pre-call
        // shape, even in another operand of the same expression.
        if (unknown) {
            forgetNonFunctions(env);
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
            invoke: (name: string, arguments_: readonly ValueFacts[]) => call(name, arguments_, env, expression),
            arity: (name: string) => env.get(name) === functionBindings.get(name)
                ? functions.get(name)?.parameters.length
                : env.get(name) === imported.get(name)?.binding
                    ? imported.get(name)?.functions.get(imported.get(name)!.name)?.parameters.length : undefined,
        });
        if (isParenthesizedExpression(expression)) inspect(expression.value, env);
        if (isMaterializeExpression(expression)) inspect(expression.source, env);
        if (isUnaryExpression(expression)) inspect(expression.operand, env);
        if (isFirstWhereExpression(expression) || isFirstIndexWhereExpression(expression)
            || isTakeWhileExpression(expression)) {
            inspect(expression.source, env);
            inspect(expression.mask, env);
        }
        if (isArrayExpression(expression)) {
            for (const item of [...expression.items, ...expression.dimensions, ...expression.rows.flatMap(row => row.items)]) inspect(item.value, env);
            if (expression.fill) inspect(expression.fill, env);
            const shape = expressionFacts(expression, lookup).shape;
            if (expression.dimensions.length && !expression.fill && shape?.every(n => n !== null)) {
                const expected = shape.reduce<bigint>((size, n) => size * BigInt(n!), 1n);
                const actual = expression.items.length + expression.rows.reduce((count, row) => count + row.items.length, 0);
                if (expected !== BigInt(actual)) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                    message: `array shape ${shape.join(' ')} expects ${expected} elements, got ${actual}` });
            }
        }
        if (isApplicationExpression(expression)) {
            const parts = flattenApplication(expression);
            const source = inspect(parts[0], env);
            for (const part of parts.slice(1)) inspect(part, env);
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
            if (isNameExpression(last) && last.name === 'reshape' && !lookup(last.name) && parts.length === 3) {
                const dimensions = expressionFacts(parts[1], lookup).integers;
                if (dimensions?.every(n => n !== null && n >= 0)
                    && source.shape?.every(n => n !== null)) {
                    const expected = dimensions.reduce<bigint>((size, n) => size * BigInt(n!), 1n);
                    const actual = source.shape.reduce<bigint>((size, n) => size * BigInt(n!), 1n);
                    if (expected !== actual) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                        message: `reshape expects ${expected} elements, got ${actual}` });
                }
            }
            if (source.rank !== undefined && source.types.length && source.types.every(type => type === 'array' || type === 'bytes')
                && selectors.every(part => isAllAxisExpression(part) || expressionFacts(part, lookup).types.join() === 'integer')
                && (selectors.some(isAllAxisExpression) || source.elements?.length
                    && source.elements.every(type => ['integer', 'real', 'boolean', 'symbol'].includes(type)))
                && selectors.length > source.rank) diagnostics.push({ node: expression, kind: 'DimensionMismatch',
                    message: `${selectors.length} selectors exceed array rank ${source.rank}` });
            for (let index = 1; index < parts.length - 1; index++) {
                const part = parts[index];
                if (!isNameExpression(part) || !['rank', 'axis'].includes(part.name) || lookup(part.name)) continue;
                const integer = expressionFacts(parts[index + 1], lookup).integer;
                if (integer === undefined || source.rank === undefined) continue;
                const value = BigInt(integer);
                if (value < 0n || (part.name === 'axis' ? value >= BigInt(source.rank) : value > BigInt(source.rank))) {
                    diagnostics.push({ node: parts[index + 1], kind: 'DimensionMismatch',
                        message: `${part.name} ${integer} is invalid for rank ${source.rank}` });
                }
            }
        }
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
            if (['+', '-', '*', '/', '//', '%', '**'].includes(expression.operator)) {
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
        const result = expressionFacts(expression, lookup);
        expressions.set(expression, result);
        return result;
    }

    // A direct call receives its already-evaluated arguments before its body
    // can invalidate caller facts. Limit this early snapshot to values whose
    // evaluation cannot itself call Rank or read host-owned array cells.
    function directCallBeforeEffects(value: Expression, env: Map<string, ValueFacts>): ValueFacts | undefined {
        if (!isApplicationExpression(value)) return undefined;
        const parts = flattenApplication(value);
        const target = parts.at(-1);
        const external = target && isNameExpression(target) ? imported.get(target.name) : undefined;
        if (external && isNameExpression(target) && env.get(target.name) === external.binding
            && external.functions.get(external.name)?.parameters.length === parts.length - 1
            && parts.slice(0, -1).every(directValue)) {
            return call(target.name, parts.slice(0, -1).map(part => expressionFacts(part,
                name => env.get(name))), new Map(env), value);
        }
        if (!target || !isNameExpression(target) || env.get(target.name) !== functionBindings.get(target.name)
            || functions.get(target.name)?.parameters.length !== parts.length - 1) return undefined;
        const numericArgument = (part: Expression): boolean => {
            if (isParenthesizedExpression(part)) return numericArgument(part.value);
            if (isUnaryExpression(part) && ['+', '-'].includes(part.operator))
                return numericArgument(part.operand);
            if (isBinaryExpression(part) && ['+', '-', '*', '/', '//', '%', '**'].includes(part.operator))
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
        return call(target.name, arguments_, new Map(env), value);
    }

    function statements(items: readonly Statement[], env: Map<string, ValueFacts>): boolean {
        for (const statement of items) {
            if (isAssignmentStatement(statement)) {
                const dot = statement.name.indexOf('.');
                if (dot > 0 && importedAliases.has(statement.name.slice(0, dot))) {
                    invalidateImportedAlias(statement.name.slice(0, dot), env);
                }
                const beforeEffects = statement.operator === '=' ? directCallBeforeEffects(statement.value, env) : undefined;
                invalidateCalls(statement.value, env);
                const previous = env.get(statement.name);
                let next = beforeEffects ?? inspect(statement.value, env);
                if (statement.operator !== '=') next = {
                    ...expressionFacts({ $type: 'BinaryExpression', operator: statement.operator.slice(0, -1),
                        left: { $type: 'NameExpression', name: statement.name }, right: statement.value } as Expression, name => env.get(name)),
                    types: compoundType(statement.operator, previous?.types ?? [], next.types),
                };
                const accepted = previous?.acceptedTypes ?? previous?.types;
                const expectedRank = contractRank(previous);
                const receivedRank = arrayRank(next);
                if (accepted?.length && provenBindingTypeConflict(accepted, next.types)) {
                    diagnostics.push({ node: statement.value, kind: 'TypeError',
                        message: bindingTypeMessage(statement.name, accepted, next.types) });
                } else if (expectedRank !== undefined && receivedRank !== undefined
                    && bindingRankConflict(expectedRank, receivedRank)) {
                    diagnostics.push({ node: statement.value, kind: 'DimensionMismatch',
                        message: bindingRankMessage(statement.name, expectedRank, receivedRank) });
                }
                env.set(statement.name, { ...next, acceptedTypes: accepted?.length ? accepted : next.types,
                    acceptedArrayRank: expectedRank ?? receivedRank });
                if (directNoReturnCall(statement.value, env)) return false;
            } else if (isUnpackStatement(statement)) {
                invalidateCalls(statement.value, env);
                const source = inspect(statement.value, env);
                const knownCells = !!source.elements?.length || !!source.positionFacts?.length;
                if (source.types.join() !== 'array' || source.rank !== 1
                    || source.shape?.[0] != null && source.shape[0] !== statement.names.length
                    || !knownCells && source.positions?.length !== statement.names.length
                    || !(source.eagerScalarCells || source.callbackFreeScalarCells)) {
                    forgetNonFunctions(env);
                    continue;
                }
                for (const [index, name] of statement.names.entries()) {
                    if (name === '#') continue;
                    const cell = source.positionFacts?.[index];
                    const types = cell?.types ?? source.positions?.[index] ?? source.elements ?? [];
                    const previous = env.get(name);
                    const accepted = previous?.acceptedTypes ?? previous?.types;
                    if (accepted?.length && provenBindingTypeConflict(accepted, types)) {
                        diagnostics.push({ node: statement, kind: 'TypeError',
                            message: bindingTypeMessage(name, accepted, types) });
                    }
                    const scalarCell = types.length && types.every(type =>
                        ['integer', 'real', 'boolean', 'symbol', 'date', 'datetime', 'duration'].includes(type));
                    const textCell = types.join() === 'text';
                    env.set(name, { ...(cell ?? (scalarCell ? { rank: 0, shape: [] }
                            : textCell ? { rank: 1, shape: [null] } : {})),
                        types,
                        ...(source.integers?.[index] != null ? { integer: String(source.integers[index]) } : {}),
                        acceptedTypes: accepted ?? types,
                        ...(cell?.types.join() === 'array' ? { acceptedArrayRank: cell.rank } : {}) });
                }
            } else if (isAddStatement(statement)) {
                invalidateCalls(statement.value, env);
                if (!directValue(statement.value)) {
                    forgetNonFunctions(env);
                }
                const value = inspect(statement.value, env);
                if (!value.types.length || !value.types.every(type =>
                    ['integer', 'real', 'boolean', 'text', 'symbol', 'date', 'datetime'].includes(type))) {
                    forgetNonFunctions(env);
                }
            } else if (isIndexAssignmentStatement(statement)) {
                let safeKeys = true;
                for (const key of statement.keys) {
                    invalidateCalls(key, env);
                    if (!directValue(key)) {
                        forgetNonFunctions(env);
                    }
                    const fact = inspect(key, env);
                    safeKeys &&= directValue(key) && fact.types.length > 0
                        && fact.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type));
                }
                invalidateCalls(statement.value, env);
                const booleanValue = isBinaryExpression(statement.value)
                    && ['and', 'or', 'xor'].includes(statement.value.operator)
                    && [statement.value.left, statement.value.right].every(value => directValue(value)
                        && expressionFacts(value, name => env.get(name)).types.join() === 'boolean');
                const safeValue = directValue(statement.value) || safeIndexDefault(statement.value, env) || booleanValue
                    || scalarArithmetic(statement.value, env) || scalarBitwise(statement.value, env);
                if (!safeValue) {
                    forgetNonFunctions(env);
                }
                const replacement = inspect(statement.value, env);
                if (env.get('index')?.types.join() === 'index') {
                    for (const [name, fact] of env) if (fact.types.join() === 'index') {
                        env.set(name, { ...fact,
                            elements: fact.elements !== undefined && safeKeys && safeValue && replacement.types.length
                                ? [...new Set([...fact.elements, ...replacement.types])] : undefined });
                    }
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
                const fact = env.get(statement.name);
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
                const lineWrite = fact?.rank === statement.indices.length
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
                    && fact.eagerScalarCells === true
                    && !!fact.elements?.length && fact.elements.every(type => type === 'integer' || type === 'real')
                    && replacement.rank === 0 && replacement.types.length > 0
                    && replacement.types.every(type => type === 'integer' || type === 'real')
                    ? compoundType(statement.operator, fact.elements, replacement.types) : [];
                const lineCompound = statement.operator !== '=' && fact?.rank === statement.indices.length
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
                } else if (fact?.types.join() === 'record' && fact.fields && statement.operator === '='
                    && statement.indices.length === 1 && !statement.indices[0].all && !statement.indices[0].spread
                    && statement.indices[0].value && isLabelLiteral(statement.indices[0].value)
                    && fact.fields[statement.indices[0].value.name]) {
                    const field = statement.indices[0].value.name;
                    const expected = fact.fields[field].types;
                    if (expected.length && provenBindingTypeConflict(expected, replacement.types)) {
                        diagnostics.push({ node: statement.value, kind: 'TypeError',
                            message: bindingTypeMessage(`record field .${field}`, expected, replacement.types) });
                    }
                    for (const source of [env, globalCallEnvs.at(-1)]) if (source) for (const [name, value] of source) {
                        if (value.types.join() === 'record' && value.fields?.[field]) source.set(name, {
                            ...value, fields: { ...value.fields, [field]: stableRecordField(value.fields[field]) },
                        });
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
                    && statement.indices.every((index, position) => !index.all && !index.spread
                        && !!index.value && directValue(index.value) && !!selectors[position]?.types.length
                        && selectors[position]!.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol'].includes(type)))
                    && directValue(statement.value) && isAtom(replacement) && replacement.types.length > 0
                    && replacement.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol',
                        'date', 'datetime'].includes(type))) {
                    // Named indices may alias any other index, including the implicit local one.
                    for (const source of [env, globalCallEnvs.at(-1)]) if (source) for (const [name, value] of source) {
                        if (value.types.join() === 'index') source.set(name, { ...value,
                            elements: value.elements === undefined ? undefined
                                : [...new Set([...value.elements, ...replacement.types])] });
                    }
                } else if ((isPlainArrayWrite(statement, integerSelector)
                    || statement.operator === '=' && oneCellSelectors || compound.length > 0
                    || lineWrite || lineCompound.length > 0)
                    && fact?.types.length
                    && fact.types.every(type => type === 'array')) {
                    // Keep old element types as conservative possibilities;
                    // a known scalar replacement adds its possible types.
                    const oneCell = (oneCellSelectors || indexedCells) && isAtom(replacement)
                        && replacement.types.length > 0;
                    const safeCells = oneCell || lineWrite || lineCompound.length > 0;
                    env.set(statement.name, { ...fact,
                        elements: safeCells && fact.elements?.length
                            ? [...new Set([...fact.elements, ...(lineWrite ? lineTypes
                                : lineCompound.length ? lineCompound
                                    : compound.length ? compound : replacement.types)])] : undefined,
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
                const collectionAdd = parts.length === 3 && isNameExpression(parts[0])
                    && ['set', 'counter'].includes(env.get(parts[0].name)?.types.join() ?? '')
                    && isNameExpression(parts[1]) && parts[1].name === 'add' && !env.has('add')
                    && safeCollectionValue(parts[2], env) && key && (isAtom(key) && key.types.length > 0
                        && key.types.every(type => ['integer', 'real', 'boolean', 'text', 'symbol',
                            'date', 'datetime'].includes(type)) || key.types.join() === 'array'
                            && key.eagerScalarCells === true);
                if (!collectionAdd) invalidateCalls(statement.value, env);
                inspect(statement.value, env);
                if (collectionAdd && isNameExpression(parts[0])) insertCollectionElement(parts[0].name,
                    key!, parts[2], env);
                if (directNoReturnCall(statement.value, env)) return false;
            } else if (isArgumentStatement(statement)) {
                if (statement.defaultValue) invalidateCalls(statement.defaultValue, env);
                env.set(statement.name, invalidate(env.get(statement.name)));
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
                loop(statement, env);
            } else if (isTryStatement(statement)) {
                if (!returnPaths([statement], env).fallsThrough) return false;
            } else {
                // Unsupported statements may mutate bindings through closures or imports.
                for (const [name, fact] of env) env.set(name, invalidate(fact));
            }
        }
        return true;
    }

    statements(program.statements, bindings);
    const functionResults = examples.map(example => {
        remainingCalls = 100;
        return call(example.name, example.arguments, bindings);
    });
    const unique = diagnostics.filter((diagnostic, index) => !diagnostics.slice(0, index).some(previous =>
        previous.node === diagnostic.node && previous.message === diagnostic.message));
    return { diagnostics: unique, bindings, expressions, functions, functionResults };
}
