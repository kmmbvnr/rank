export function perBallReference(last) {
    let stack = new Uint32Array(1024), depth = 0, state = 290797, total = 0;
    const close = () => {
        if (!depth) return;
        const round = stack[--depth] + 1;
        total += 2 * round - 1;
        if (depth && stack[depth - 1] < round) stack[depth - 1] = round;
    };
    for (let run = 0; run <= last; run++) {
        const count = state % 64 + 1;
        // The generator's product is below 2^53, so integer arithmetic is exact.
        state = state * state % 50515093;
        if (run % 2 === 0) {
            if (depth + count > stack.length) {
                const next = new Uint32Array(Math.max(depth + count, stack.length * 2));
                next.set(stack);
                stack = next;
            }
            stack.fill(0, depth, depth + count);
            depth += count;
        } else {
            for (let box = 0; box < count && depth; box++) close();
        }
    }
    while (depth) close();
    return total;
}

