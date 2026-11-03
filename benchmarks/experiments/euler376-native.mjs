import assert from 'node:assert/strict';
const limit=Number(process.argv[2]||30),canonical=process.env.CANONICAL==='1',occupied=process.env.OCCUPIED==='1';
const start=performance.now();let cur=new Map([[0,1]]),checks=0,maxWays=1,maxStates=0,attempts=0,accepted=0;const phases=[];let sum=0,binomial=1;const term=6|6<<3|6<<6|19<<9|19<<14|19<<19;
for(let v=1;v<=(occupied?Math.min(limit,18):limit);v++){
 const next=new Map(),left=limit-v,begin=performance.now();
 for(const[key,ways]of cur){
  const ua=key&7,ub=key>>>3&7,uc=key>>>6&7,wba=key>>>9&31,wcb=key>>>14&31,wac=key>>>19&31;
  for(let aa=0;aa<=6-ua;aa++){const na=ua+aa;
   for(let bb=0;bb<=6-ub;bb++){const nb=ub+bb;
    for(let cc=0;cc<=6-uc;cc++){attempts++;const nc=uc+cc;
     if(occupied&&aa+bb+cc===0)continue;
     if(!occupied&&left===0&&(na!==6||nb!==6||nc!==6))continue;
     const ba=Math.min(19,wba+bb*ua),cb=Math.min(19,wcb+cc*ub),ac=Math.min(19,wac+aa*uc);
     if(ba+6*(6-nb)<19||cb+6*(6-nc)<19||ac+6*(6-na)<19)continue;
     let nk=na|nb<<3|nc<<6|ba<<9|cb<<14|ac<<19;
     if(canonical)nk=Math.min(nk,nb|nc<<3|na<<6|cb<<9|ac<<14|ba<<19,nc|na<<3|nb<<6|ac<<9|ba<<14|cb<<19);
     const value=(next.get(nk)||0)+ways;assert.ok(Number.isSafeInteger(value));maxWays=Math.max(maxWays,value);next.set(nk,value);accepted++;
    }
   }
  }
 }
 cur=next;if(occupied){binomial=binomial*(limit-v+1)/v;sum+=(cur.get(term)||0)*binomial;assert.ok(Number.isSafeInteger(sum));}maxStates=Math.max(maxStates,cur.size);phases.push({v,states:cur.size,ms:performance.now()-begin});
}
const answer=(occupied?sum:(cur.get(term)||0))/3;
if(limit===6)assert.equal(answer,581);if(limit===30)assert.equal(answer,973059630185670);
console.log(JSON.stringify({limit,canonical,occupied,answer,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,attempts,accepted,maxStates,maxWays,phases}));
