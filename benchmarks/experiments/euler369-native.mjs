const start=performance.now();
const states=new Set([1]);let frontier=[1];const extend=(r,t)=>r | ((t&1)?(r&21845)<<1:0) | ((t&2)?(r&13107)<<2:0) | ((t&4)?(r&3855)<<4:0) | ((t&8)?(r&255)<<8:0);
while(frontier.length){const next=[];for(let r of frontier)for(let t=0;t<16;t++){let s=extend(r,t);if(!states.has(s)){states.add(s);next.push(s);}}frontier=next;}
const ids=[...states],index=new Map(ids.map((r,i)=>[r,i])),counts=Array.from({length:16},(_,i)=>i.toString(2).replaceAll('0','').length),trans=ids.map(r=>counts.map((_,t)=>index.get(extend(r,t))));
let cur=new Float64Array(14*ids.length);cur[0]=1;let active=[];
for(let rank=0;rank<13;rank++){let next=new Float64Array(cur.length),live=0;for(let n=0;n<14;n++)for(let r=0;r<ids.length;r++){let w=cur[n*ids.length+r];if(w){live++;for(let t=0;t<16;t++){let k=n+counts[t];if(k<14)next[k*ids.length+trans[r][t]]+=w;}}}cur=next;active.push(live);}
let answer=0;for(let n=4;n<14;n++)for(let r=0;r<ids.length;r++)if(ids[r]&32768)answer+=cur[n*ids.length+r];
console.log(JSON.stringify({states:ids.length,active,answer,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024}));
