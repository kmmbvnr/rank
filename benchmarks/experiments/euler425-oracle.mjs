export function relativePrefix(limit) {
    const composite = new Uint8Array(limit + 1), primes = [], graph = Array.from({ length: limit + 1 }, () => []);
    for (let p = 2; p <= limit; p++) {
        if (composite[p]) continue;
        primes.push(p);
        for (let q = p * p; q <= limit; q += p) composite[q] = 1;
    }
    const isPrime = p => p >= 2 && p <= limit && !composite[p];
    // String edits are independent of Rank's arithmetic candidate generation.
    for (const p of primes) {
        const text = String(p), smaller = new Set();
        for (let at = 0; at < text.length; at++) for (let digit = 0; digit <= 9; digit++) {
            if (at === 0 && digit === 0) continue;
            const q = Number(text.slice(0, at) + digit + text.slice(at + 1));
            if (q < p && isPrime(q)) smaller.add(q);
        }
        if (text.length > 1 && text[1] !== '0') {
            const q = Number(text.slice(1));
            if (isPrime(q)) smaller.add(q);
        }
        for (const q of smaller) { graph[p].push(q); graph[q].push(p); }
    }
    // Minimax Dijkstra: cost is the largest prime visited on a path from 2.
    const cost = new Float64Array(limit + 1).fill(Infinity), heap = [];
    const push = entry => { let at = heap.length; heap.push(entry); while (at) { const parent = (at - 1) >> 1; if (heap[parent][0] <= entry[0]) break; heap[at] = heap[parent]; at = parent; } heap[at] = entry; };
    const pop = () => { const first = heap[0], last = heap.pop(); if (heap.length) { let at = 0; while (2 * at + 1 < heap.length) { let child = 2 * at + 1; if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++; if (heap[child][0] >= last[0]) break; heap[at] = heap[child]; at = child; } heap[at] = last; } return first; };
    if (limit >= 2) { cost[2] = 2; push([2, 2]); }
    while (heap.length) {
        const [current, p] = pop();
        if (current !== cost[p]) continue;
        for (const q of graph[p]) { const next = Math.max(current, q); if (next < cost[q]) { cost[q] = next; push([next, q]); } }
    }
    const prefix = [0n]; let total = 0n;
    for (let n = 1; n <= limit; n++) { if (isPrime(n) && cost[n] > n) total += BigInt(n); prefix.push(total); }
    return prefix;
}
