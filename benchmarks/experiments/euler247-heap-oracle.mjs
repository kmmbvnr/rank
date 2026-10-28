// Independent best-first enumeration: no target threshold or DFS stack.
const heap=[];
function push(v){let i=heap.length;heap.push(v);while(i){const p=(i-1)>>1;if(heap[p].s>=v.s)break;heap[i]=heap[p];i=p;}heap[i]=v;}
function pop(){const v=heap[0],last=heap.pop();if(heap.length){let i=0;while(2*i+1<heap.length){let c=2*i+1;if(c+1<heap.length&&heap[c+1].s>heap[c].s)c++;if(heap[c].s<=last.s)break;heap[i]=heap[c];i=c;}heap[i]=last;}return v;}
function square(x,y,r,u){return {x,y,r,u,s:2*(1-x*y)/(Math.sqrt((x-y)**2+4)+x+y)};}
let remain=20,n=0;push(square(1,0,0,0));const ranks=[];const start=performance.now();
while(remain){const v=pop();n++;if(v.r===3&&v.u===3){ranks.push(n);remain--;}
 push(square(v.x+v.s,v.y,v.r+1,v.u));push(square(v.x,v.y+v.s,v.r,v.u+1));}
console.log(JSON.stringify({answer:n,ranks,ms:performance.now()-start,queue:heap.length}));
