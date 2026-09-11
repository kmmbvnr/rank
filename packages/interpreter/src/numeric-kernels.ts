import type { RankValue } from './value.js';

type BinaryOperation = (left: RankValue, right: RankValue) => RankValue;

/** Select once per collection operation; guard each pair without probing lazy inputs. */
export function numericKernel(operator: string, fallback: BinaryOperation): BinaryOperation {
    switch (operator) {
        case '+': return (left, right) => {
            if (typeof left === 'bigint' && typeof right === 'bigint') return left + right;
            if ((typeof left === 'number' || typeof left === 'bigint')
                && (typeof right === 'number' || typeof right === 'bigint')) {
                return Number(left) + Number(right);
            }
            return fallback(left, right);
        };
        case '-': return (left, right) => {
            if (typeof left === 'bigint' && typeof right === 'bigint') return left - right;
            if ((typeof left === 'number' || typeof left === 'bigint')
                && (typeof right === 'number' || typeof right === 'bigint')) {
                return Number(left) - Number(right);
            }
            return fallback(left, right);
        };
        case '*': return (left, right) => {
            if (typeof left === 'bigint' && typeof right === 'bigint') return left * right;
            if ((typeof left === 'number' || typeof left === 'bigint')
                && (typeof right === 'number' || typeof right === 'bigint')) {
                return Number(left) * Number(right);
            }
            return fallback(left, right);
        };
        default: return fallback;
    }
}
