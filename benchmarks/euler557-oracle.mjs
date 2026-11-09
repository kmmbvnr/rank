import { pathToFileURL } from 'node:url';
export function solve(n) {
    if (!Number.isInteger(n) || n < 0 || n > 10000) throw Error('oracle supports 0..10000');
    const gcd = (a, b) => { while (b) { const r = a % b; a = b; b = r; } return a; };
    let answer = 0n;
    for (let total = 4; total <= n; total++) {
        let count = 0;
        for (let part = 1; part <= total - 3; part++) {
            const square = part * part, combined = total + part, common = gcd(square, combined);
            const step = combined / common, room = total - part;
            const last = Math.floor(Math.floor(room * room / combined) / step);
            const factor = square / common;
            for (let k = 1; k <= last; k++) {
                const sum = room - step * k, delta = sum * sum - 4 * factor * k;
                const root = Math.floor(Math.sqrt(delta));
                if (root * root === delta && (sum - root) % 2 === 0) count++;
            }
        }
        answer += BigInt(total) * BigInt(count);
    }
    return answer;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const start = performance.now(), n = Number(process.argv[2] ?? 10000), answer = solve(n);
    console.log(JSON.stringify({ n, answer: String(answer), ms: performance.now() - start }));
}
