import { bindCallWords } from './call-words.js';
import {
    isLabelLiteral, isParenthesizedExpression, isNameExpression, isNumberLiteral, isUnaryExpression,
    type DeclaredCallExpression, type Expression,
} from './generated/ast.js';
import type { FunctionCallSignature } from './function-call-signature.js';
import { applicationExpression } from './expressions.js';

/** Bind source operands once. Consumers never rediscover argument placement from runtime values. */
export function groupDeclaredCalls(
    parts: readonly Expression[],
    signatureOf: (expression: Expression) => FunctionCallSignature | undefined,
    callable: (expression: Expression) => boolean,
    report: (expression: Expression, message: string) => void,
): Expression[] {
    const result: Expression[] = [];
    const numeric = (value: Expression | undefined) => isNumberLiteral(value)
        || isUnaryExpression(value) && value.operator === '-' && isNumberLiteral(value.operand);
    for (let cursor = 0; cursor < parts.length; cursor++) {
        const callee = parts[cursor];
        const signature = signatureOf(callee);
        if (!signature || !signature.rightParameters.length && !signature.words.length) {
            result.push(callee);
            continue;
        }
        const name = isNameExpression(callee) ? callee.name : 'function';
        if (result.length < signature.leftCount) {
            report(callee, `${name} expects ${signature.leftCount} left operands`);
            result.push(callee);
            continue;
        }
        const arguments_: Expression[] = [];
        if (signature.leftCount) {
            const tail = result.splice(result.length - signature.leftCount + 1);
            arguments_.push(applicationExpression(result.splice(0)), ...tail);
        }
        for (const parameter of signature.rightParameters) {
            const next = parts[cursor + 1];
            const word = isNameExpression(next) && next.name;
            if (!next || word && (signature.words.some(group => group.word === word) || word === 'rank' || word === 'axis')
                || parameter.kind === 'data' && callable(next)) {
                report(callee, `${name} is missing right parameter ${parameter.name}`);
                arguments_.push({ $type: 'LabelLiteral', name: 'NA' } as Expression);
            } else {
                arguments_.push(next);
                cursor++;
            }
        }
        for (const group of signature.words) {
            const value = group.defaultValue;
            arguments_.push(value ? { ...value, ...(isUnaryExpression(value) ? { operand: { ...value.operand } } : {}) }
                : { $type: 'LabelLiteral', name: 'NA' } as Expression);
        }
        const groups = bindCallWords(parts, cursor + 1, signature.words.map(group => group.word), name,
            value => !callable(value), report);
        cursor = groups.next - 1;
        for (const group of signature.words) {
            const supplied = groups.values.get(group.word);
            if (!supplied) continue;
            let literal = supplied;
            while (isParenthesizedExpression(literal)) literal = literal.value;
            // Literal .NA has the same static and runtime meaning as omission.
            if (!isLabelLiteral(literal) || literal.name !== 'NA') arguments_[group.parameter] = supplied;
        }
        const ranks: Expression[] = [], axes: Expression[] = [];
        while (isNameExpression(parts[cursor + 1])) {
            const marker = parts[cursor + 1] as Expression & { name: string };
            if (marker.name !== 'rank' && marker.name !== 'axis') break;
            cursor++;
            const values = marker.name === 'rank' ? ranks : axes;
            if (values.length) report(marker, `Duplicate ${marker.name} modifier`);
            while (numeric(parts[cursor + 1])) values.push(parts[++cursor]);
            if (!values.length) report(marker, `${marker.name} expects an integer`);
        }
        const next = parts[cursor + 1];
        if (isNameExpression(next) && /^[a-z]/.test(next.name) && !callable(next)) {
            report(next, `Unknown ${name} word ${next.name}`);
        }
        result.push({ $type: 'DeclaredCallExpression', callee, arguments: arguments_,
            dataParameters: [...signature.dataParameters], ranks, axes, $cstNode: callee.$cstNode } as DeclaredCallExpression);
    }
    return result;
}
