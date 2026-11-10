// Ordered compositions check probabilities independently of partition weights.
export function area(lengths, counts = lengths.map(() => 1)) {
    const longest = Math.max(...lengths), top = 1 / longest;
    const angleSum = t => lengths.reduce((sum, side, i) => sum + counts[i] * Math.asin(Math.min(1, side * t)), 0);
    const endpoint = angleSum(top), outside = endpoint < Math.PI;
    let low = 0, high = top, t = top;
    if (Math.abs(endpoint - Math.PI) > 1e-14) {
        for (let i = 0; i < 100; i++) {
            t = (low + high) / 2;
            if (t === low || t === high) break;
            const f = angleSum(t) - (outside ? 2 * Math.asin(Math.min(1, longest * t)) : Math.PI);
            if (outside ? f > 0 : f < 0) low = t; else high = t;
        }
    }
    let numerator = lengths.reduce((sum, side, i) => sum + counts[i] * side * Math.sqrt(Math.max(0, 1 - (side * t) ** 2)), 0);
    if (outside) numerator -= 2 * longest * Math.sqrt(Math.max(0, 1 - (longest * t) ** 2));
    return Math.abs(numerator) / (4 * t);
}
export function compositions(n) {
    const sides = Array(n).fill(1), cache = new Map();
    let sum = 0, correction = 0, count = 0;
    function visit(at, remaining) {
        if (at === n - 1) {
            sides[at] = remaining + 1;
            const key = [...sides].sort((a,b)=>a-b).join(',');
            let value = cache.get(key);
            if (value === undefined) { value = area(sides); cache.set(key,value); }
            const y = value - correction, next = sum + y; correction = (next - sum) - y; sum = next; count++;
            return;
        }
        for (let extra = 0; extra <= remaining; extra++) { sides[at] = extra + 1; visit(at + 1, remaining - extra); }
    }
    visit(0,n-3);
    return { mean:sum/count, count };
}
export function partitions(k) {
    const factorial = [1n]; for (let n=1;n<=2*k;n++) factorial[n]=factorial[n-1]*BigInt(n);
    const means = [], prefixes = []; let total = 0;
    for (let n=3;n<=k;n++) {
        const frequencies = new Int32Array(n), lengths=[],counts=[];
        const combinations = factorial[2*n-4]/factorial[n-1]/factorial[n-3];
        let mean=0, correction=0;
        function visit(remaining, maximum, depth) {
            if (!remaining) {
                const ones=n-depth; lengths.length=0;counts.length=0;lengths.push(1);counts.push(ones);
                let denominator=factorial[ones];
                for(let part=1;part<n;part++) if(frequencies[part]) {
                    lengths.push(part+1);counts.push(frequencies[part]);denominator*=factorial[frequencies[part]];
                }
                const permutations=factorial[n]/denominator;
                const value=area(lengths,counts)*Number(permutations)/Number(combinations);
                const y=value-correction,next=mean+y;correction=(next-mean)-y;mean=next;return;
            }
            for(let part=1;part<=Math.min(remaining,maximum);part++) {frequencies[part]++;visit(remaining-part,part,depth+1);frequencies[part]--;}
        }
        visit(n-3,n-3,0); means.push(mean);total+=mean;prefixes.push(total);
    }
    return {means,prefixes,total};
}
