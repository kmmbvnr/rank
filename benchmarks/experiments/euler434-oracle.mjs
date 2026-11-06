// Exact component-of-first-row recurrence; no factorial inverses or convolution.
export function connectedCounts(n,mod=1000000033n){
 const choose=Array.from({length:n+1},()=>Array(n+1).fill(0n));choose[0][0]=1n;
 for(let i=1;i<=n;i++)for(let j=0;j<=i;j++)choose[i][j]=(choose[i-1][j]+(j?choose[i-1][j-1]:0n))%mod;
 const powers=[1n];for(let i=1;i<=n*n;i++)powers.push(powers.at(-1)*2n%mod);
 const rows=Array.from({length:n+1},()=>Array(n+1).fill(0n));if(n)rows[1][0]=1n;
 for(let m=1;m<=n;m++)for(let q=1;q<=n;q++){
  let value=powers[m*q];
  for(let i=1;i<=m;i++)for(let j=0;j<=q;j++)if(i!==m||j!==q){
   value-=choose[m-1][i-1]*choose[q][j]%mod*rows[i][j]%mod*powers[(m-i)*(q-j)]%mod;
  }
  rows[m][q]=(value%mod+mod)%mod;
 }
 return rows;
}
export function squareTotal(rows,n,mod=1000000033n){let value=0n;for(let m=1;m<=n;m++)for(let q=1;q<=n;q++)value+=rows[m][q];return value%mod;}
// Enumerate every edge subset of a small complete bipartite graph.
export function bruteConnected(m,n){let count=0;const fullRows=(1<<m)-1,fullCols=(1<<n)-1;
 for(let edges=0;edges<2**(m*n);edges++){
  let rows=1,cols=0,previous=-1;
  while(previous!==rows){previous=rows;for(let i=0;i<m;i++)if(rows&(1<<i))cols|=edges>>>(i*n)&fullCols;for(let i=0;i<m;i++)if((edges>>>(i*n)&fullCols)&cols)rows|=1<<i;}
  if(rows===fullRows&&cols===fullCols)count++;
 }
 return BigInt(count);
}
