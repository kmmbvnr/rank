#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <vector>
using I = int64_t;
using W = __int128_t;
I divide(I a,I b){I q=a/b,r=a%b;return q-((r!=0)&&((r<0)!=(b<0)));}
I mod(I a,I b){return a-divide(a,b)*b;}
I root(I n){I r=std::sqrt((long double)n);while(W(r+1)*(r+1)<=n)++r;while(W(r)*r>n)--r;return r;}
I eight(I n){
 I r=root(n);std::vector<I>lo(r+1),hi(r+1),ps;
 for(I v=1;v<=r;++v){lo[v]=v-1;hi[v]=n/v-1;}
 for(I p=2;p<=r;++p)if(lo[p]>lo[p-1]){
  ps.push_back(p);I old=lo[p-1],p2=p*p;
  for(I i=1;i<=std::min(r,n/p2);++i)hi[i]-=(i*p<=r?hi[i*p]:lo[n/(i*p)])-old;
  for(I v=r;v>=p2;--v)lo[v]-=lo[v/p]-old;
 }
 auto pi=[&](I x){return x<=r?lo[x]:hi[n/x];};I out=0;
 for(I p:ps){
  W p3=W(p)*p*p;if(p3<=n)out+=pi(n/I(p3))-(W(p)*p*p*p<=n);
  W p7=1;for(int j=0;j<7&&p7<=n;++j)p7*=p;if(p7<=n)++out;
 }
 for(size_t i=0;i<ps.size()&&W(ps[i])*ps[i]*ps[i]<=n;++i)
  for(size_t j=i+1;j<ps.size()&&W(ps[i])*ps[j]*ps[j]<=n;++j)out+=pi(n/(ps[i]*ps[j]))-I(j)-1;
 return out;
}
using V=std::array<I,3>;
I norm(V a){return std::abs(a[0])+std::abs(a[1])+std::abs(a[2]);}
V minus(V b,I t,V a){for(int i=0;i<3;++i)b[i]-=t*a[i];return b;}
I shortest(V a,V b){
 for(;;){
  if(norm(b)<norm(a))std::swap(a,b);
  if(!norm(a))return norm(b);
  struct Ratio{I num,den,weight;};std::array<Ratio,3>ratios;
  for(int i=0;i<3;++i)ratios[i]={a[i]<0?-b[i]:b[i],a[i]?std::abs(a[i]):1,std::abs(a[i])};
  std::stable_sort(ratios.begin(),ratios.end(),[](Ratio x,Ratio y){return W(x.num)*y.den<W(y.num)*x.den;});
  I total=norm(a),acc=0,t=0;
  for(auto q:ratios){acc+=q.weight;if(W(acc)*2>=total){t=divide(q.num,q.den);break;}}
  V one=minus(b,t,a),two=minus(b,t+1,a);V next=norm(two)<norm(one)?two:one;
  if(norm(next)>=norm(b))return norm(a);
  b=next;
 }
}
I lattices(I n){
 I a=0,b=1,c=1,total=0;
 for(I j=0;j<n;++j){I r[12];for(auto &v:r){v=a;I next=(a+b+c)%10000000;a=b;b=c;c=next;}
  V x={r[0]-r[1],r[2]+r[3],r[4]*r[5]},y={r[6]-r[7],r[8]+r[9],r[10]*r[11]};total+=shortest(x,y);
 }return total;
}
// Port of the old trapezoid reciprocity, independent of the new floor-sum loop.
I trap(I a,I b,I d,I l,I u,bool boundary){
 I out=0;
 while(std::abs(u-l)>8){
  out+=(u-l)*divide(b,d);b=mod(b,d);
  out+=(u-l)*(u+l+1)/2*divide(a,d);a=mod(a,d);
  if(!a){if(!b&&!boundary)out-=u-l;return out;}
  I up=divide(a*u+b,d),lp=divide(a*l+b,d);out+=u*up-l*lp;
  std::swap(a,d);b=-b;l=up;u=lp;boundary=!boundary;
 }
 I step=u>=l?1:-1;for(I x=std::min(l,u)+1;x<=std::max(l,u);++x)out+=step*divide(a*x+b-(boundary?0:1),d);
 return out;
}
I trap2(I a,I b,I d,I l,I u,bool boundary,I x,I y){I xo=mod(x,2);return trap(2*a,b+mod(y,2)*d-xo*a,2*d,divide(l+xo,2),divide(u+xo,2),boundary);}
I fvalue(I v){
 I r=root(v+v/2),out=0;I cs[6]={0,1,1,0,1,1};
 for(int ci=0;ci<3;++ci){I i=cs[2*ci],j=cs[2*ci+1];
  for(I s=2;s<r;++s)if(s%2==0||i==j){
   I tm=std::max(I(1),root(s*s/3)),t0=(s-1)%2+1;
   for(I t=t0;t<=tm;t+=2){I vm=t*v/((s-t)*(s+t)),vx=v*(s+t)/(s*s+2*s*t-t*t);
    out+=trap2(s,0,t,0,vm,true,j,i);
    out+=trap2(t,v,s,vm,vx,true,j,i);
    out-=trap2(s+3*t,0,s+t,0,vx,false,j,i);
   }
  }
  I um=(v+v/2)/r,u0=1+(i+1)%2,v0=1+(j+1)%2;
  for(I u=u0;u<=um;u+=2)for(I w=v0;w<=std::min(v/2,u-1);w+=2){
   int repeats=i==j?2:1;
   for(int sr=0;sr<repeats;++sr){bool lt=u*u<3*w*w;I dw=2*u*w+w*w-u*u;
    I ma=v*(3*w-u)/std::max(I(1),dw),mb=v*u/((u-w)*(u+w)),mx=lt?ma:mb;
    I mc=std::max(r,(u+w-1)/w),mn=lt?r:mc,a0=lt?u-w:w,a1=lt?3*w-u:u;
    if(mx<mn)continue;
    out+=trap2(a0,0,a1,mn-1,mx,true,sr,sr);
    I md=(w+v)/u;if(md<mx)out-=trap2(u,-v,w,std::max(md,mn-1),mx,false,sr,sr);
   }
  }
 }return out;
}
I triangles(I n){
 std::vector<I>vs,fd(n+1);for(I k=1;k<=n;k+=2)vs.push_back(n/k);
 std::sort(vs.begin(),vs.end());vs.erase(std::unique(vs.begin(),vs.end()),vs.end());
 for(I x:vs){I val=fvalue(x);for(I k=3;k<=x;k+=2)val-=fd[x/k];fd[x]=val;}
 return fd[n];
}
int main(int argc,char**argv){int id=std::atoi(argv[1]);I n=std::stoll(argv[2]);I answer=id==501?eight(n):id==507?lattices(n):triangles(n);std::cout<<"{\"id\":"<<id<<",\"n\":"<<n<<",\"answer\":\""<<answer<<"\"}\n";}
