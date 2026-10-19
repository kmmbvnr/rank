import { GraphValue } from './graph.js';
import { checkpoint } from './interrupt.js';
import { currentDiagnostics } from './diagnostics.js';
import type { RankValue } from './value.js';

const prototype = GraphValue.prototype;
const methods = Object.getOwnPropertyDescriptors(prototype);
const add = prototype.add;

/** Only the concrete runtime graph may enter a synchronous effect region.
 * Predicate/successor graphs and overridden host methods use normal dispatch. */
export function prepareGraphAdd(value: RankValue | undefined): ((values: RankValue[]) => void) | undefined {
    if (!(value instanceof GraphValue) || Object.getPrototypeOf(value) !== prototype) return undefined;
    for (const [name, descriptor] of Object.entries(methods)) {
        const current = Object.getOwnPropertyDescriptor(prototype, name);
        if (Object.prototype.hasOwnProperty.call(value, name) || current?.value !== descriptor.value
            || current?.get !== descriptor.get || current?.set !== descriptor.set) return undefined;
    }
    return values => {
        checkpoint('adding graph edge');
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.compiledGraphAdds++;
        add.call(value, values);
    };
}
