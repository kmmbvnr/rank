import {
    isAssignmentStatement, isBinaryExpression, isBooleanLiteral, isForStatement, isIfStatement,
    isLabelLiteral, isNameExpression, isNumberLiteral, isParenthesizedExpression, isReturnStatement,
    isStringLiteral, isYieldStatement, type Expression, type FunctionStatement, type Statement,
} from '../generated/ast.js';
import { operatorContract } from '../operator-signature.js';
import { possibleBindingTypeConflict, settledBindingTypes } from '../binding-rule.js';
import { instantiateTypeSignature, type SignatureAtom, type SignatureType } from '../type-signature.js';
import type { FunctionAlternative, FunctionContract } from './function-contracts.js';

type Domain = readonly SignatureAtom[];
type Binding = { readonly types: Domain; readonly contracts: readonly Domain[] };
type Environment = Map<string, Binding>;
const candidates: readonly SignatureAtom[] = ['integer', 'real', 'boolean', 'text', 'missing'];
const union = (domains: readonly Domain[]): Domain => [...new Set(domains.flat())].sort();
const contracts = (domains: readonly Domain[]): readonly Domain[] =>
    [...new Map(domains.map(domain => [domain.join(), domain])).values()].sort((a, b) => a.join().localeCompare(b.join()));
const atoms = (type: SignatureType): Domain | undefined => typeof type === 'string' && type !== 'unknown'
    ? [type] : typeof type === 'object' && 'union' in type
        && type.union.every(member => typeof member === 'string' && member !== 'unknown')
        ? type.union as Domain : undefined;

/** Display-only scalar alternatives. A bounded loop analysis tracks settled
 * binding contracts across paths and back edges; it never executes a generator or
 * turns conditional requirements into optimizer facts. Unsupported code declines.
 */
export function inferGeneratorContract(definition: FunctionStatement, limit = 10000): FunctionContract {
    let remaining = limit;
    let exhausted = false;
    const alternatives: FunctionAlternative[] = [];
    const tick = (): boolean => {
        if (--remaining >= 0) return true;
        exhausted = true;
        return false;
    };
    const binary = (operator: string, left: Domain, right: Domain): Domain | undefined => {
        const rows = operatorContract(operator)?.cells;
        const results: Domain[] = [];
        for (const a of left) for (const b of right) {
            if (!tick()) return undefined;
            const row = rows?.map(row => instantiateTypeSignature(row, [a, b])).find(row => row !== undefined);
            const result = row && atoms(row.result);
            if (!result) return undefined;
            results.push(result);
        }
        return union(results);
    };
    const read = (node: Expression, env: Environment): Domain | undefined => {
        if (!tick()) return undefined;
        if (isParenthesizedExpression(node)) return read(node.value, env);
        if (isNameExpression(node)) return env.get(node.name)?.types;
        if (isNumberLiteral(node)) return [typeof node.value === 'bigint' ? 'integer' : 'real'];
        if (isStringLiteral(node)) return ['text'];
        if (isBooleanLiteral(node)) return ['boolean'];
        if (isLabelLiteral(node) && node.name === 'NA') return ['missing'];
        if (isBinaryExpression(node) && !node.step) {
            const left = read(node.left, env), right = read(node.right, env);
            return left && right && binary(node.operator, left, right);
        }
        return undefined;
    };
    // A local must be established on every continuing path before it can be read.
    const merge = (paths: readonly Environment[]): Environment => {
        const env: Environment = new Map();
        for (const name of paths[0]?.keys() ?? []) {
            if (paths.every(path => path.has(name))) env.set(name, {
                types: union(paths.map(path => path.get(name)!.types)),
                contracts: contracts(paths.flatMap(path => path.get(name)!.contracts)),
            });
        }
        return env;
    };
    const equal = (left: Environment, right: Environment): boolean => left.size === right.size
        && [...left].every(([name, binding]) => JSON.stringify(binding) === JSON.stringify(right.get(name)));
    const analyze = (inputs: readonly SignatureAtom[]): Domain | undefined => {
        const yields: Domain[] = [];
        let valid = true;
        // Nullable comparisons can reach a branch when their result is boolean;
        // these alternatives do not promise absence of value-dependent errors.
        const condition = (node: Expression, env: Environment): boolean => {
            const domain = read(node, env);
            return !!domain?.includes('boolean') && domain.every(type => type === 'boolean' || type === 'missing');
        };
        const walk = (statements: readonly Statement[], entry: Environment): Environment | undefined => {
            let env = new Map(entry);
            for (const statement of statements) {
                if (!tick()) { valid = false; return undefined; }
                if (isAssignmentStatement(statement) && !statement.name.includes('.')) {
                    const right = read(statement.value, env);
                    const left = env.get(statement.name);
                    const value = statement.operator === '=' ? right
                        : left && right && binary(statement.operator.slice(0, -1), left.types, right);
                    if (!value) { valid = false; return undefined; }
                    // Check every possible established contract separately: a
                    // branch join must not grant permission to change its type.
                    if (left?.contracts.some(expected => possibleBindingTypeConflict(expected, value))) {
                        valid = false; return undefined;
                    }
                    env.set(statement.name, { types: value, contracts: left
                        ? contracts(left.contracts.flatMap(expected => value.map(type =>
                            settledBindingTypes(expected, [type]) as Domain))) : value.map(type => [type]) });
                } else if (isYieldStatement(statement)) {
                    const value = read(statement.value, env);
                    if (!value) { valid = false; return undefined; }
                    yields.push(value);
                } else if (isReturnStatement(statement) && !statement.value) return undefined;
                else if (isIfStatement(statement)) {
                    const clauses = [{ condition: statement.condition, statements: statement.thenStatements },
                        ...statement.elifClauses];
                    if (!clauses.every(clause => condition(clause.condition, env))) { valid = false; return undefined; }
                    const paths = [...clauses.map(clause => walk(clause.statements, env)),
                        walk(statement.elseStatements, env)].filter(path => path !== undefined);
                    if (!paths.length) return undefined;
                    env = merge(paths);
                } else if (isForStatement(statement)) {
                    const initial = new Map(env);
                    // Joins describe path uncertainty, never a widening of an
                    // established variable type. The work budget bounds nested loops.
                    for (;;) {
                        if (statement.condition && !condition(statement.condition, env)) { valid = false; return undefined; }
                        const back = walk(statement.statements, env);
                        const joined = merge(back ? [initial, back] : [initial]);
                        if (!valid) return undefined;
                        if (equal(env, joined)) break;
                        env = joined;
                    }
                } else { valid = false; return undefined; }
            }
            return env;
        };
        walk(definition.statements, new Map(definition.parameters.map((name, index) =>
            [name, { types: [inputs[index]], contracts: [[inputs[index]]] }])));
        // Do not advertise heterogeneous cells as a supported sequence domain.
        const cells = union(yields);
        return valid && cells.length === 1 ? cells : undefined;
    };
    const enumerate = (inputs: readonly SignatureAtom[]): void => {
        if (!tick()) return;
        if (inputs.length === definition.parameters.length) {
            const cells = analyze(inputs);
            if (cells) alternatives.push({ inputs, result: { collection: 'sequence',
                element: cells.length === 1 ? cells[0] : { union: cells } } });
        } else for (const candidate of candidates) {
            enumerate([...inputs, candidate]);
            if (exhausted) break;
        }
    };
    // Nested functions can assign an enclosing binding which can change while
    // suspended. Only top-level functions establish these independent locals.
    if (!definition.ranks.length && definition.$container.$type === 'Program') enumerate([]);
    return { alternatives, unresolved: true, exhausted };
}
