// Independent exhaustive Heron iteration, with exact integer arithmetic.
const rows = [];
for (let digits = 1; digits <= 6; digits++) {
    const first = 10n ** BigInt(digits - 1), last = 10n ** BigInt(digits) - 1n;
    const start = digits % 2
        ? 2n * 10n ** BigInt((digits - 1) / 2)
        : 7n * 10n ** BigInt((digits - 2) / 2);
    let total = 0n, max = 0;
    for (let n = first; n <= last; n++) {
        let x = start, steps = 0;
        for (;;) {
            const next = (x + (n + x - 1n) / x) / 2n;
            steps++;
            if (next === x) break;
            x = next;
        }
        total += BigInt(steps);
        max = Math.max(max, steps);
    }
    const count = last - first + 1n, scale = 10000000000n;
    const rounded = (2n * total * scale + count) / (2n * count);
    const answer = `${rounded / scale}.${String(rounded % scale).padStart(10, '0')}`;
    rows.push({ digits, total: String(total), count: String(count),
        answer: answer.replace(/\.?0+$/, ''), max });
}
console.log(JSON.stringify(rows));
