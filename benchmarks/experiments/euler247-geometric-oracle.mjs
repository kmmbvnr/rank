const side=(x,y)=>2*(1-x*y)/(Math.sqrt((x-y)**2+4)+x+y);
for(const [r,u] of [[0,0],[1,0],[0,1],[1,1],[2,1],[1,2],[2,2],[3,3]]) {
 let min=Infinity;
 function target(x,y,a,b){if(a===r&&b===u){min=Math.min(min,side(x,y));return;}const s=side(x,y);if(a<r)target(x+s,y,a+1,b);if(b<u)target(x,y+s,a,b+1);}
 target(1,0,0,0); const small=min*(1-1e-12),stack=[[1,0]];let n=0,visits=0,max=1;
 while(stack.length){const [x,y]=stack.pop(),s=side(x,y);visits++;if(s>=small){n++;stack.push([x+s,y],[x,y+s]);max=Math.max(max,stack.length);}}
 console.log(JSON.stringify({r,u,small,n,visits,max}));
}
