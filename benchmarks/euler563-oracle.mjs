// Direct enumeration of smooth side pairs, without area windows or Rank code.
export function solve(limit, k) {
    const primes = [2,3,5,7,11,13,17,19,23], sides = [];
    function extend(index, value) {
        if (index === primes.length) { sides.push(value); return; }
        for (let n=value;n<=limit;n*=primes[index]) extend(index+1,n);
    }
    extend(0,1); sides.sort((a,b)=>a-b);
    const end = Math.floor(limit*10/11)**2;
    if (!Number.isSafeInteger(end)) throw Error('oracle requires exact Number areas');
    const counts = new Map(); let total = 0;
    for(let i=0;i<sides.length;i++) {
        const x=sides[i], upper=Math.min(Math.floor(11*x/10),Math.floor((end-1)/x));
        for(let j=i;j<sides.length && sides[j]<=upper;j++) {
            const area=x*sides[j]; total++; counts.set(area,(counts.get(area)??0)+1);
        }
    }
    const minima=Array(k+1).fill(0n);
    for(const [area,count] of counts) if(count>=2 && count<=k && (!minima[count] || BigInt(area)<minima[count])) minima[count]=BigInt(area);
    return {answer:minima.reduce((a,b)=>a+b,0n),minima,complete:minima.slice(2).every(x=>x>0n),pairs:total,counts};
}
