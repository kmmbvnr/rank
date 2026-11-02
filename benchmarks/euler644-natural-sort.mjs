// Research-only generic stable natural merge sort; no Euler-specific pattern.
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){
 const loaded=next(url,context);if(!url.endsWith('/runtime/axis-order.js'))return loaded;
 const source=String(loaded.source),start=source.indexOf('function orderRow('),end=source.indexOf('/** Stored buffers',start);
 if(start<0||end<0)throw Error('sort hook target changed');
 const replacement=`function orderRow(keys,n,down,a,b){
  for(let i=0;i<n;i++)a[i]=i;
  const before=(x,y)=>down?keys[x]>keys[y]:keys[x]<keys[y];
  let runs=[0];
  for(let lo=0;lo<n;){
   let hi=lo+1;
   if(hi<n&&before(a[hi],a[lo])){
    while(hi<n&&before(a[hi],a[hi-1]))hi++;
    for(let l=lo,r=hi-1;l<r;l++,r--){const t=a[l];a[l]=a[r];a[r]=t;}
   }else while(hi<n&&!before(a[hi],a[hi-1]))hi++;
   runs.push(hi);lo=hi;
  }
  let from=a,to=b;
  while(runs.length>2){
   const nextRuns=[0];
   for(let i=0;i<runs.length-1;i+=2){
    const lo=runs[i],mid=runs[i+1],hi=runs[i+2]??mid;
    mergeRuns(keys,from,to,lo,mid,hi,down);nextRuns.push(hi);
   }
   [from,to]=[to,from];runs=nextRuns;
  }
  return from;
}
`;
 return {...loaded,source:source.slice(0,start)+replacement+source.slice(end)};
}});
