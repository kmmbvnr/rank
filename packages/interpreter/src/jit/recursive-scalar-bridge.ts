import { currentDiagnostics } from '../diagnostics.js';
import { numberOverflow } from './number-arithmetic.js';
import type { RankValue } from '../runtime/value.js';

interface Bridge {
    enter(): void;
    leave(): void;
    hook(): void;
    allowed(): boolean;
    rejectArguments(): void;
    succeeded(): void;
    failed(): void;
    number: (...args: never[]) => RankValue;
    exact: (...args: never[]) => RankValue;
    integerResult: boolean;
    recover(error: unknown, args: RankValue[]): { tail: RankValue[] } | { result: RankValue };
}

const factories = new Map<number, (bridge: Bridge) => (...args: RankValue[]) => RankValue>();

/** Keep proved positional arguments in locals across numeric calls and replay.
 * Argument arrays are needed only for exceptional tail transfers or errors. */
export function recursiveScalarBridge(arity: number, bridge: Bridge): ((...args: RankValue[]) => RankValue) | undefined {
    if (arity > 16) return undefined;
    let factory = factories.get(arity);
    if (!factory) {
        const args = Array.from({ length: arity }, (_, index) => `arg${index}`);
        const numbers = args.map((_, index) => `num${index}`);
        const guards = args.map((arg, index) => `typeof ${arg} === 'bigint' && Number.isSafeInteger(${numbers[index]} = Number(${arg}))`);
        const source = `return function(${args}) {
            bridge.enter();
            try {
                for (;;) {
                    try {
                        bridge.hook();
                        if (bridge.allowed()) {
                            ${numbers.length ? `let ${numbers};` : ''}
                            if (${guards.join(' && ') || 'true'}) {
                                try {
                                    const diagnostics = currentDiagnostics();
                                    if (diagnostics) diagnostics.numberFunctions++;
                                    const value = bridge.number(${numbers});
                                    bridge.succeeded();
                                    return bridge.integerResult ? BigInt(value) : value;
                                } catch (error) {
                                    if (error !== numberOverflow) throw error;
                                    bridge.failed();
                                }
                            } else bridge.rejectArguments();
                        }
                        return bridge.exact(${args});
                    } catch (error) {
                        const transfer = bridge.recover(error, [${args}]);
                        if ('result' in transfer) return transfer.result;
                        ${args.map((arg, index) => `${arg} = transfer.tail[${index}];`).join('\n')}
                    }
                }
            } finally { bridge.leave(); }
        };`;
        factory = new Function('currentDiagnostics', 'numberOverflow',
            `return function(bridge) { ${source} };`)(currentDiagnostics, numberOverflow);
        factories.set(arity, factory!);
    }
    return factory!(bridge);
}
