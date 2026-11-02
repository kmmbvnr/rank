var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _RankFenwick_instances, _RankFenwick_values, _RankFenwick_tree, _RankFenwick_position, _RankFenwick_update;
import { checkValueMutable } from './value-protection.js';
import { MissingValueError, RankError } from '../errors.js';
const nativeInstances = new WeakSet();
/** A fixed-size integer array with logarithmic prefix sums. */
export class RankFenwick {
    constructor(size) {
        _RankFenwick_instances.add(this);
        this.kind = 'fenwick';
        _RankFenwick_values.set(this, void 0);
        _RankFenwick_tree.set(this, void 0);
        if (size < 0n)
            throw new RankError('fenwick size must be nonnegative');
        if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError(`fenwick size is too large: ${size}`);
        }
        const length = Number(size);
        __classPrivateFieldSet(this, _RankFenwick_values, Array(length).fill(0n), "f");
        __classPrivateFieldSet(this, _RankFenwick_tree, Array(length + 1).fill(0n), "f");
        nativeInstances.add(this);
    }
    get size() {
        return __classPrivateFieldGet(this, _RankFenwick_values, "f").length;
    }
    at(index) {
        return __classPrivateFieldGet(this, _RankFenwick_values, "f")[__classPrivateFieldGet(this, _RankFenwick_instances, "m", _RankFenwick_position).call(this, index)];
    }
    set(index, value) {
        checkValueMutable(this);
        const position = __classPrivateFieldGet(this, _RankFenwick_instances, "m", _RankFenwick_position).call(this, index);
        const delta = value - __classPrivateFieldGet(this, _RankFenwick_values, "f")[position];
        __classPrivateFieldGet(this, _RankFenwick_values, "f")[position] = value;
        __classPrivateFieldGet(this, _RankFenwick_instances, "m", _RankFenwick_update).call(this, position, delta);
    }
    sum(index) {
        if (index === -1n)
            return 0n;
        let position = __classPrivateFieldGet(this, _RankFenwick_instances, "m", _RankFenwick_position).call(this, index) + 1;
        let total = 0n;
        while (position > 0) {
            total += __classPrivateFieldGet(this, _RankFenwick_tree, "f")[position];
            position -= position & -position;
        }
        return total;
    }
}
_RankFenwick_values = new WeakMap(), _RankFenwick_tree = new WeakMap(), _RankFenwick_instances = new WeakSet(), _RankFenwick_position = function _RankFenwick_position(index) {
    if (index < 0n || index >= BigInt(__classPrivateFieldGet(this, _RankFenwick_values, "f").length)) {
        throw new MissingValueError(`fenwick index out of bounds: ${index}`);
    }
    return Number(index);
}, _RankFenwick_update = function _RankFenwick_update(position, delta) {
    for (let index = position + 1; index < __classPrivateFieldGet(this, _RankFenwick_tree, "f").length; index += index & -index) {
        __classPrivateFieldGet(this, _RankFenwick_tree, "f")[index] += delta;
    }
};
export function expectFenwick(value) {
    if (!(value instanceof RankFenwick))
        throw new RankError('operation expects a fenwick tree');
    return value;
}
const nativeMethods = Object.entries(Object.getOwnPropertyDescriptors(RankFenwick.prototype));
/** Region entry must exclude replacement methods and observable fields. */
export function hasNativeFenwick(value) {
    if (!value || typeof value !== 'object' || !nativeInstances.has(value)
        || Object.getPrototypeOf(value) !== RankFenwick.prototype)
        return false;
    if (Object.getOwnPropertyDescriptor(value, 'kind')?.value !== 'fenwick')
        return false;
    return nativeMethods.every(([name, descriptor]) => {
        const current = Object.getOwnPropertyDescriptor(RankFenwick.prototype, name);
        return !Object.prototype.hasOwnProperty.call(value, name)
            && current?.value === descriptor.value && current?.get === descriptor.get && current?.set === descriptor.set;
    });
}
//# sourceMappingURL=fenwick.js.map