import { arrayBindingContract, refineArrayContract } from './array-binding-contract.js';
import { AstUtils, type AstNode } from 'langium';
import {
    isAllAxisExpression, isApplicationExpression, isArgumentStatement, isArrayAssignmentStatement,
    isAssignmentStatement, isBinaryExpression, isExpression, isExpressionStatement, isForStatement,
    isFunctionStatement, isIfStatement, isLabelLiteral, isNameExpression,
    isOptionStatement, isParenthesizedExpression, isReturnStatement, isTestStatement, isTryStatement,
    isUseStatement, type Expression, type FunctionStatement, type Program, type Statement,
} from '../generated/ast.js';
import { applicationForm, symbolicApplicationForm } from '../application-forms.js';
import { applicationExpression, flattenApplication, unaryApplicationHead } from '../expressions.js';
import { declaredRanks } from '../function-ranks.js';
import { findOperation, type IntrinsicRank, type Operation } from '../operations.js';
import type { ShapePattern, ShapeTerm } from '../shape-signature.js';
import { functionEffects } from './function-effects.js';
import { loopBinding } from './control-flow.js';
import { expressionFacts } from './value-facts.js';
import { declaredType } from './types.js';
import type { ValueFacts } from './value-domain.js';
import type { RequirementConflict, RequirementSite } from './requirement-solver.js';
import { Graph, type Value, type Binding, type Template, type ValueRequirement } from './requirement-graph.js';
export type { ValueRequirement } from './requirement-graph.js';
export type { RequirementConflict, RequirementInterval, RequirementSite } from './requirement-solver.js';

export interface BindingRequirement extends ValueRequirement {
    readonly name: string;
    readonly node: AstNode;
}
export interface FunctionRequirement {
    readonly params: readonly ValueRequirement[];
    readonly result: ValueRequirement;
}
export interface RequirementAnalysis {
    readonly bindings: readonly BindingRequirement[];
    readonly expressions: ReadonlyMap<Expression, ValueRequirement>;
    readonly functions: ReadonlyMap<FunctionStatement, FunctionRequirement>;
    readonly conflicts: readonly RequirementConflict[];
    readonly limited: boolean;
}
export interface RequirementOptions {
    readonly initial?: ReadonlyMap<string, ValueFacts>;
    readonly declarations?: ReadonlyMap<string, FunctionStatement>;
    readonly loadModule?: (path: string) => Program | undefined;
}
const site = (node: AstNode, reason: string): RequirementSite => ({ node, reason });
const primitiveTypes = new Set(['integer', 'real', 'text', 'boolean', 'symbol', 'missing', 'date', 'datetime', 'duration']);
const spread = (term: ShapeTerm): term is { readonly spread: string } =>
    term !== null && typeof term === 'object' && 'spread' in term;

/** A separate, non-executing requirement channel. No solved value enters ValueFacts.
 * Summaries are templates: each call receives fresh variables, including dimensions.
 * Guarded paths, captured writes and unresolved callbacks deliberately lose precision. */
export function inferRequirements(program: Program, options: RequirementOptions = {}): RequirementAnalysis {
    const templates = new Map<FunctionStatement, Template>();
    const active = new Set<FunctionStatement>();
    const functionScopes = new Map<FunctionStatement, Map<string, FunctionStatement>>();
    const opaqueScopes = new Set<FunctionStatement>();
    let budget = 100;
    let limited = false;
    const roots = new Map(options.declarations);
    const moduleScopes = new Map<Program, Map<string, FunctionStatement>>();
    const declarations = (items: readonly Statement[], parent: ReadonlyMap<string, FunctionStatement>, opaque = false): Map<string, FunctionStatement> => {
        const unresolved = opaque || items.some(item => isUseStatement(item) && item.path && !options.loadModule?.(item.path));
        const result = new Map(parent);
        for (const item of items) {
            if (isFunctionStatement(item)) result.set(item.name, item);
            if (isUseStatement(item) && item.path && options.loadModule) {
                const module = options.loadModule(item.path);
                if (!module) continue;
                let imported = moduleScopes.get(module);
                if (!imported) {
                    imported = new Map();
                    moduleScopes.set(module, imported); // Break import cycles before visiting dependencies.
                    const scope = declarations(module.statements, new Map());
                    for (const definition of module.statements.filter(isFunctionStatement)) {
                        imported.set(definition.name, scope.get(definition.name)!);
                    }
                }
                for (const [name, definition] of imported) result.set(item.alias ? `${item.alias}.${name}` : name, definition);
            }
        }
        for (const item of items) if (isFunctionStatement(item)) {
            if (unresolved) opaqueScopes.add(item);
            functionScopes.set(item, declarations(item.statements, result, unresolved));
        }
        return result;
    };
    const functions = declarations(program.statements, roots);
    for (const definition of roots.values()) if (!functionScopes.has(definition)) {
        functionScopes.set(definition, declarations(definition.statements, roots));
    }
    const template = (definition: FunctionStatement): Template | undefined => {
        const cached = templates.get(definition);
        if (cached) return cached;
        if (active.has(definition)) return;
        if (budget-- <= 0) { limited = true; return; }
        active.add(definition);
        const graph = new Graph(), env = new Map<string, Binding>();
        const params = definition.parameters.map(name => {
            const value = graph.value(definition);
            env.set(name, { name, node: definition, rank: value.rank, value });
            return value;
        });
        const result = graph.value(definition);
        collect(definition.statements, graph, env, functionScopes.get(definition) ?? functions, result, opaqueScopes.has(definition));
        active.delete(definition);
        const value = { graph, params, result };
        templates.set(definition, value);
        return value;
    };
    function collect(items: readonly Statement[], graph: Graph, env: Map<string, Binding>,
        callees: ReadonlyMap<string, FunctionStatement>, returns?: Value, opaqueImport = false): void {
        const lookup = (name: string): ValueFacts | undefined => env.get(name)?.value.fact
            ?? (callees.has(name) ? { types: ['function'] } : opaqueImport && findOperation(name) ? { types: [] } : undefined);
        const bound = (name: string) => env.has(name) || callees.has(name) || opaqueImport;
        // A write through a closure or unsupported control flow is not a stable value source.
        const unstable = new Set<string>();
        for (const item of items) if (isFunctionStatement(item) || isIfStatement(item) || isTryStatement(item) || isForStatement(item)) {
            for (const node of AstUtils.streamAllContents(item)) {
                if (isAssignmentStatement(node) || isArrayAssignmentStatement(node)) unstable.add(node.name);
            }
        }
        const forget = () => {
            for (const [name, binding] of env) {
                const value = graph.value(binding.node, { types: [], acceptedArrayContract: arrayBindingContract(binding.value.fact) });
                env.set(name, { ...binding, rank: value.rank, value });
            }
        };
        const effects = functionEffects(name => env.has(name) ? undefined : callees.get(name),
            name => callees.has(name), name => bound(name), lookup);
        const callEffects = (name: string, args: Value[]) => {
            const effect = effects(name, args.map(arg => arg.fact));
            if (effect.unknown || effect.captures.size || effect.globalWriteCaptures.size) forget();
        };
        const builtinEffects = (operation: Operation, args: Value[]) => {
            // I/O with only primitive arguments cannot read lazy cells or mutate Rank
            // bindings. A later file read must not detach aliases of an earlier read.
            if (operation.effects?.length && operation.effects.every(effect => effect === 'io')
                && args.every(arg => arg.fact.types.length && arg.fact.types.every(type => primitiveTypes.has(type)))) return;
            const plain = args.every(arg => arg.fact.types.length && (arg.fact.rank === 0 || arg.fact.types.join() === 'text'
                || arg.fact.eagerScalarCells || arg.fact.callbackFreeScalarCells));
            if (operation.effects?.length || !plain) forget();
        };
        const literal = (value: Expression): number | undefined => {
            const n = expressionFacts(value, lookup).integer;
            return n !== undefined && Number.isSafeInteger(Number(n)) ? Number(n) : undefined;
        };
        const requireRank = (value: Value, min: number, max: number, node: AstNode, reason: string) =>
            graph.solver.bound(value.rank, min, max, site(node, reason));
        const entersCells = (arg: Value, rank: number, axes?: readonly number[]): boolean => {
            const shape = graph.shape(arg);
            if (shape.rank === undefined) return false;
            const cell = rank < 0 ? Math.max(0, shape.rank + rank) : Math.min(rank, shape.rank);
            const frame = shape.rank - cell;
            const lengths = axes ? axes.map(axis => shape.shape?.[axis]) : shape.shape?.slice(0, frame);
            return frame === 0 || lengths?.every(n => n !== null && n !== undefined && n > 0) === true;
        };
        const signature = (operation: Operation, args: Value[], result: Value, node: AstNode,
            ranks?: readonly IntrinsicRank[], axes?: readonly number[]) => {
            const shape = operation.shape?.find(shape => shape.args.length === args.length);
            if (!shape || args.some(arg => arg.fact.types.includes('text') || arg.fact.elements?.includes('text'))) return;
            if (operation.selectsNumericCell && args.some(arg => {
                const types = arg.fact.types.join() === 'array' ? arg.fact.elements : arg.fact.types;
                return !types?.length || !types.every(type => type === 'integer' || type === 'real');
            })) return;
            const cellRanks = ranks ?? (args.length === 1 ? [operation.monadicRank ?? 'all']
                : operation.dyadicRanks ?? args.map(() => 'all'));
            if (cellRanks.some((rank, index) => typeof rank === 'number' && !entersCells(args[index], rank, axes))) return;
            const dims = new Map<string, number>(), tails = new Map<string, Value>();
            const frames: Value[] = [];
            const pattern = (value: Value, terms: ShapePattern, output: boolean) => {
                const tail = terms.find(spread);
                if (tail) {
                    const fixed = terms.length - 1;
                    requireRank(value, fixed, Infinity, node, `${operation.name} needs rank >= ${fixed}`);
                    const old = tails.get(tail.spread);
                    if (old) graph.solver.equal(value.rank, old.rank, site(node, operation.name), fixed);
                    else {
                        const rest = graph.value(node);
                        graph.solver.equal(value.rank, rest.rank, site(node, operation.name), fixed);
                        tails.set(tail.spread, rest);
                    }
                } else requireRank(value, terms.length, terms.length, node, `${operation.name} needs rank ${terms.length}`);
                // Fixed prefixes are meaningful without knowing the tail rank.
                for (let axis = 0; axis < terms.length; axis++) {
                    const term = terms[axis];
                    if (spread(term)) break;
                    if (term === null || typeof term === 'object' && 'exists' in term) continue;
                    const id = graph.dimension(value, axis);
                    if (typeof term === 'number') graph.solver.bound(id, term, term, site(node, `${operation.name} length ${term}`));
                    else if (typeof term === 'string') {
                        const old = dims.get(term);
                        if (old !== undefined) graph.solver.equal(id, old, site(node, `${operation.name} equal lengths`));
                        else if (!output) dims.set(term, id);
                    } else if ('add' in term) {
                        const parts = term.add.map(part => {
                            if (typeof part === 'string') return dims.get(part);
                            const constant = graph.solver.variable('dimension');
                            graph.solver.bound(constant, part, part, site(node, operation.name));
                            return constant;
                        });
                        if (parts.length === 2 && parts.every(part => part !== undefined)) {
                            graph.solver.sum(id, parts[0]!, parts[1]!, site(node, operation.name));
                        }
                    }
                }
            };
            const cells = args.map((arg, index) => {
                const rank = cellRanks[index];
                if (rank === 'all') return arg;
                // Text/sequence boxing differs from tensor assembly; leave it to forward facts.
                if (arg.fact.types.length && arg.fact.types.join() !== 'array') return undefined;
                const cell = graph.value(node), frame = graph.value(node);
                graph.solver.frame(arg.rank, frame.rank, rank, site(node, `${operation.name} frame`));
                graph.solver.sum(arg.rank, frame.rank, cell.rank, site(node, `${operation.name} cell`));
                // A known operand rank makes the trailing cell axes addressable.
                const count = graph.shape(arg).rank;
                const cellCount = count === undefined ? undefined : rank < 0 ? Math.max(0, count + rank) : Math.min(rank, count);
                if (count !== undefined && cellCount !== undefined) {
                    const selected = axes ? new Set(axes) : new Set(Array.from({ length: count - cellCount }, (_, n) => n));
                    const cellAxes = Array.from({ length: count }, (_, n) => n).filter(axis => !selected.has(axis));
                    for (const [axis, sourceAxis] of cellAxes.entries()) cell.dimensions.set(axis, graph.dimension(arg, sourceAxis));
                }
                frames.push(frame);
                return cell;
            });
            cells.forEach((cell, index) => { if (cell && shape.args[index]) pattern(cell, shape.args[index]!, false); });
            if (!shape.result || cells.some(cell => !cell)) return;
            if (!frames.length) pattern(result, shape.result, true);
            else if (args.length === 1) {
                const cell = graph.value(node);
                pattern(cell, shape.result, true);
                graph.solver.sum(result.rank, frames[0].rank, cell.rank, site(node, `${operation.name} result`));
            }
            // Binary frames broadcast: equality is not a requirement.
        };
        const call = (definition: FunctionStatement, args: Value[], output: Value, node: AstNode,
            ranks?: readonly IntrinsicRank[], axes?: readonly number[]) => {
            if (args.length !== definition.parameters.length) return;
            const summary = template(definition);
            if (!summary) return;
            const declared = declaredRanks(definition);
            const cells = ranks ?? (typeof declared === 'object' ? declared.ranks : undefined);
            if (cells?.some((rank, index) => typeof rank === 'number' && !entersCells(args[index], rank, axes))) return;
            if (graph.solver.variables.length + summary.graph.solver.variables.length > 20_000) {
                limited = true; return;
            }
            const instance = graph.instantiate(summary);
            if (!cells || cells.every(rank => rank === 'all')) {
                args.forEach((arg, index) => graph.same(instance.params[index], arg, site(node, `${definition.name} argument`)));
                graph.same(output, instance.result, site(node, `${definition.name} result`));
            } else if (args.length === 1 && typeof cells[0] === 'number'
                && (!args[0].fact.types.length || args[0].fact.types.join() === 'array')) {
                const frame = graph.value(node);
                graph.solver.frame(args[0].rank, frame.rank, cells[0], site(node, `${definition.name} frame`));
                graph.solver.sum(args[0].rank, frame.rank, instance.params[0].rank, site(node, `${definition.name} cell`));
                graph.solver.sum(output.rank, frame.rank, instance.result.rank, site(node, `${definition.name} result`));
                if (axes && cells[0] >= 0) requireRank(args[0], axes.length + cells[0], axes.length + cells[0], node, 'axis count + cell rank');
            }
        };
        function expression(node: Expression): Value {
            if (isParenthesizedExpression(node)) {
                const value = expression(node.value); graph.expressions.set(node, value); return value;
            }
            if (isNameExpression(node) && env.has(node.name)) {
                const value = env.get(node.name)!.value; graph.expressions.set(node, value); return value;
            }
            const nullary = isNameExpression(node) && !env.has(node.name) ? callees.get(node.name) : undefined;
            const output = graph.value(node, nullary?.parameters.length === 0 ? { types: [] } : expressionFacts(node, lookup));
            graph.expressions.set(node, output);
            if (nullary?.parameters.length === 0) {
                call(nullary, [], output, node); callEffects(nullary.name, []); return output;
            }
            if (isBinaryExpression(node)) {
                const form = symbolicApplicationForm(node, name => !bound(name));
                if (form?.kind === 'reduce') {
                    const value = expression(form.source), rank = form.rank && literal(form.rank);
                    if (rank !== undefined && typeof rank === 'number' && rank >= 0) {
                        requireRank(value, rank, Infinity, form.rank!, `reduce needs rank >= ${rank}`);
                        graph.solver.equal(output.rank, value.rank, site(node, 'reduce rank'), -rank);
                    }
                    return output;
                }
                const left = expression(node.left), right = expression(node.right);
                // Arithmetic allows scalar and size-1 broadcasting, not shape equality.
                if (['/', '//', '%', '**'].includes(node.operator)) {
                    for (const value of [left, right]) graph.domains.push({ variable: value.domain,
                        types: ['integer', 'real', 'missing'], site: site(node, `${node.operator} needs numbers`) });
                }
                return output;
            }
            if (!isApplicationExpression(node)) {
                for (const child of AstUtils.streamContents(node)) if (isExpression(child)) expression(child);
                return output;
            }
            const unaryHead = unaryApplicationHead(node, name => env.has(name) || opaqueImport ? undefined
                : callees.has(name) ? [callees.get(name)!.parameters.length] : findOperation(name)?.arities, name => !bound(name));
            let parts = unaryHead ? [unaryHead, node.arguments[0]] : flattenApplication(node);
            const trailing = parts.at(-1);
            const unary = isNameExpression(trailing) && !bound(trailing.name)
                && findOperation(trailing.name)?.arities.includes(1);
            const prefix = parts.slice(1, -1);
            if (unary && prefix.length && (prefix.some(isAllAxisExpression)
                && prefix.every(part => isAllAxisExpression(part) || literal(part) !== undefined)
                || prefix.length === 1 && isLabelLiteral(prefix[0]))) {
                parts = [applicationExpression(parts.slice(0, -1), node), trailing!];
            }
            let form: ReturnType<typeof applicationForm>;
            try { form = applicationForm(parts, name => bound(name) ? false : findOperation(name)); }
            catch { return output; } // Incomplete notebook syntax has no requirements yet.
            if (form.kind === 'checked-read') {
                const value = expression(applicationExpression(form.parts, node));
                graph.expressions.set(node, value);
                return value;
            }
            if (form.kind === 'rank') {
                const target = form.parts.at(-1);
                const args = form.parts.slice(0, -1).map(expression);
                const ranks = form.rightRank === undefined ? [Number(form.rank)] : [Number(form.rank), Number(form.rightRank)];
                if (!isNameExpression(target) || ranks.some(rank => !Number.isSafeInteger(rank))) return output;
                const definition = !env.has(target.name) && callees.get(target.name);
                if (definition) { call(definition, args, output, node, ranks, form.axes); callEffects(definition.name, args); }
                else if (!bound(target.name)) {
                    const operation = findOperation(target.name);
                    if (operation) { signature(operation, args, output, node, ranks, form.axes); builtinEffects(operation, args); }
                }
                if (form.axes && args.length === 1 && ranks[0] >= 0) {
                    requireRank(args[0], form.axes.length + ranks[0], form.axes.length + ranks[0], node, 'axis count + cell rank');
                }
                return output;
            }
            if (form.kind === 'axis-length' || form.kind === 'axis-reduction') {
                const source = expression(form.source);
                const axes = form.kind === 'axis-length' ? [form.axis] : form.axes;
                for (const axis of axes) {
                    const index = typeof axis === 'number' ? axis : literal(axis);
                    if (index !== undefined && index >= 0) requireRank(source, index + 1, Infinity, typeof axis === 'number' ? node : axis, `axis ${index} needs rank >= ${index + 1}`);
                }
                return output;
            }
            const last = parts.at(-1);
            if (isNameExpression(last) && !env.has(last.name)) {
                const definition = callees.get(last.name);
                const operation = definition || bound(last.name) ? undefined : findOperation(last.name);
                const arity = definition?.parameters.length;
                if (arity === parts.length - 1 || operation?.arities.includes(parts.length - 1)) {
                    const args = parts.slice(0, -1).map(expression);
                    if (definition) { call(definition, args, output, node); callEffects(last.name, args); }
                    else if (operation) {
                        signature(operation, args, output, node);
                        for (const [index, types] of (operation.operandDomains ?? []).entries()) {
                            if (args[index] && types) graph.domains.push({ variable: args[index].domain, types,
                                site: site(node, `${operation.name} needs ${types.join(' or ')}`) });
                        }
                        builtinEffects(operation, args);
                    }
                    return output;
                }
            }
            // # is an explicit tensor selector, unlike ordinary nested indexing.
            const selectors = parts.slice(1);
            if (selectors.length && selectors.some(isAllAxisExpression)
                && selectors.every(part => isAllAxisExpression(part) || literal(part) !== undefined)) {
                const input = expression(parts[0]);
                requireRank(input, selectors.length, Infinity, node, `${selectors.length} selectors need rank >= ${selectors.length}`);
                graph.solver.equal(output.rank, input.rank, site(node, 'selection'), -selectors.filter(part => !isAllAxisExpression(part)).length);
                return output;
            }
            // Track a selection by value identity, so aliases share the same requirement.
            // Unknown callable receivers retain the unresolved-application path below.
            if (parts.length === 2 && isLabelLiteral(parts[1])) {
                const fact = expressionFacts(parts[0], lookup);
                if (fact.types.length && fact.types.every(type => ['array', 'object', 'record'].includes(type))) {
                    const source = expression(parts[0]);
                    const selected = graph.field(source, parts[1].name, node, output.fact);
                    graph.expressions.set(node, selected);
                    return selected;
                }
            }
            for (const part of parts) if (!isNameExpression(part) || env.has(part.name)) expression(part);
            // Do not connect unknown callable arguments to its result or to a summary.
            forget();
            return output;
        }
        for (const item of items) {
            if (isUseStatement(item)) {
                if (item.path && !options.loadModule?.(item.path)) opaqueImport = true;
                continue;
            }
            if (isFunctionStatement(item)) continue;
            if (isAssignmentStatement(item)) {
                const value = expression(item.value);
                graph.nameValue(value);
                if (item.name.includes('.') || item.operator !== '=' || unstable.has(item.name)) {
                    env.set(item.name, { name: item.name, node: item, rank: value.rank, value: graph.value(item) });
                    continue;
                }
                const old = env.get(item.name);
                const placeholder = value.fact.types.join() === 'missing' || old?.value.fact.types.join() === 'missing';
                const rank = placeholder ? value.rank : old?.rank ?? value.rank;
                if (old && !placeholder) graph.solver.equal(rank, value.rank, site(item, `${item.name} keeps its rank`));
                value.fact = { ...value.fact, acceptedArrayContract: refineArrayContract(arrayBindingContract(old?.value.fact), value.fact) };
                const binding = { name: item.name, node: item, rank, value };
                env.set(item.name, binding); graph.bindings.push(binding);
                // Lengths and current cell subsets change; the established contract survives.
                for (const name of env.keys()) if (name.startsWith(`${item.name}.`)) env.delete(name);
            } else if (isOptionStatement(item) || isArgumentStatement(item)) {
                const types = declaredType(item.valueType, item.many);
                const fact: ValueFacts = { types, rank: item.many || types.join() === 'text' ? 1 : 0,
                    ...(item.many ? { elements: declaredType(item.valueType, false), shape: [null] } : {}) };
                const value = graph.value(item, fact);
                const binding = { name: item.name, node: item, rank: value.rank, value };
                env.set(item.name, binding); graph.bindings.push(binding);
            } else if (isExpressionStatement(item)) expression(item.value);
            else if (isReturnStatement(item)) {
                if (item.value) {
                    const value = expression(item.value);
                    if (returns) graph.same(returns, value, site(item, 'return'));
                }
                break;
            } else if (isForStatement(item)) {
                if ([...AstUtils.streamAllContents(item)].some(isReturnStatement)) returns = undefined;
                const loop = loopBinding(item.condition);
                if (loop) expression(loop.iterable);
                // A loop may execute zero times; its uses do not constrain entry values.
                forget();
            } else if (isIfStatement(item) || isTryStatement(item)) {
                if ([...AstUtils.streamAllContents(item)].some(isReturnStatement)) returns = undefined;
                if (isIfStatement(item)) expression(item.condition);
                forget();
            } else if (isTestStatement(item)) {
                // Test blocks have independent runtime bindings.
                collect(item.statements, graph, new Map(), declarations(item.statements, callees));
            } else if (isArrayAssignmentStatement(item)) {
                for (const name of env.keys()) if (name.startsWith(`${item.name}.`)) env.delete(name);
                const old = env.get(item.name);
                if (old) env.set(item.name, { ...old, value: graph.value(item, { types: old.value.fact.types, rank: old.value.fact.rank,
                    acceptedArrayContract: arrayBindingContract(old.value.fact) }) });
                forget();
            } else if (!isUseStatement(item)) forget();
        }
    }
    const graph = new Graph(), env = new Map<string, Binding>();
    for (const [name, fact] of options.initial ?? []) {
        const value = graph.value(program, fact);
        env.set(name, { name, node: program, rank: value.rank, value });
    }
    collect(program.statements, graph, env, functions);
    for (const definition of functionScopes.keys()) template(definition);
    const solved = graph.solve();
    const summaries = new Map<FunctionStatement, FunctionRequirement>();
    const conflicts = [...solved.conflicts];
    for (const [definition, summary] of templates) {
        const answer = summary.graph.solve();
        summaries.set(definition, { params: summary.params.map(answer.read), result: answer.read(summary.result) });
        conflicts.push(...answer.conflicts);
        limited ||= answer.limited;
    }
    const siteIds = new WeakMap<AstNode, number>();
    let nextSite = 0;
    const key = (value: RequirementSite) => {
        let id = siteIds.get(value.node);
        if (id === undefined) { id = nextSite++; siteIds.set(value.node, id); }
        return `${id}:${value.reason}`;
    };
    return {
        bindings: graph.bindings.map(binding => ({ ...solved.read(binding.value), name: binding.name, node: binding.node })),
        expressions: new Map([...graph.expressions].map(([node, value]) => [node, solved.read(value)])),
        functions: summaries,
        conflicts: [...new Map(conflicts.map(conflict => [`${conflict.kind}:${key(conflict.first)}:${key(conflict.second)}`, conflict])).values()],
        limited: limited || solved.limited,
    };
}
