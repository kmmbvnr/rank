#include <cstdint>
#include <iostream>
#include <chrono>
#include <algorithm>
using U=uint64_t;
const U Q=1ULL<<60, MK=Q-1;
U nodes=0,expanded=0,N;
U estimate(U k,U x,U p,int steps){
 if(k>=N)return x;
 if(steps>0)return MK-std::max(estimate(k*2,(3*x+2*p)&MK,x,steps-1),estimate(k*2+1,(2*x+3*p)&MK,x,steps-1));
 U z=k;int h=0;while(z<N){z*=2;++h;}
 return h%2?MK-x:x;
}
U search(U k,U x,U p,U a,U b,int order){
 ++nodes;
 if(k>=N)return x;
 ++expanded;
 U l=(3*x+2*p)&MK,r=(2*x+3*p)&MK;
 bool swap=false;
 if(order){
  // Prefer the larger estimated child value.
  U z=k;int h=0;while(z<N){z*=2;++h;}
  swap=order==1?((h%2)?r>l:r<l):estimate(2*k+1,r,x,order-1)>estimate(2*k,l,x,order-1);
 }
 U best=MK;
 for(int i=0;i<2;++i){
  int side=i^swap;
  U v=MK-search(2*k+side,side?r:l,x,MK-b,MK-a,order);
  best=std::min(best,v);b=std::min(b,v);
  if(b<=a)break;
 }
 return best;
}
U tree(U x,U p,int d,U a,U b){
 ++nodes;if(!d)return x;
 ++expanded;
 U l=(3*x+2*p)&MK,r=(2*x+3*p)&MK;
 bool mx=d%2;U f=mx?std::max(l,r):std::min(l,r),other=mx?std::min(l,r):std::max(l,r);
 if(d==1)return f;
 U v=tree(f,x,d-1,a,b);
 if(mx)a=std::max(a,v);else b=std::min(b,v);
 if(a>=b)return mx?a:b;
 U w=tree(other,x,d-1,a,b);
 return mx?std::max(a,w):std::min(b,w);
}
U at(U k,int d){
 U x=1,p=0;int h=63-__builtin_clzll(k);
 for(int i=h-1;i>=0;--i){bool bit=(k>>i)&1;U nx=((3-bit)*x+(2+bit)*p)&MK;p=x;x=nx;}
 return tree(x,p,d,0,MK);
}
U block(U s,int d,U bs,U ll){
 if(s+(1ULL<<d)<=ll)return at((bs+s)>>d,d);
 int dk=std::max(d,1);return MK-at((bs+s)>>dk,dk-1);
}
U original(){
 if(N==1)return 1;
 int h=63-__builtin_clzll(2*N-1),d=h;U bs=1ULL<<h,ll=2*N-bs,s=0,sv[64];
 while(!(s+(1ULL<<d)<=ll||s>=ll)){
  U sn=s+(1ULL<<(d-1));
  if(ll<=sn)sv[d]=block(sn,d-1,bs,ll);else {sv[d]=block(s,d-1,bs,ll);s=sn;}
  --d;
 }
 U z=block(s,d,bs,ll);
 for(int e=d+1;e<=h;++e)z=e%2?std::max(z,sv[e]):std::min(z,sv[e]);
 return h%2?MK-z:z;
}
int main(int argc,char**argv){N=std::stoull(argv[1]);int order=argc>2?std::stoi(argv[2]):1;auto t=std::chrono::steady_clock::now();auto v=order<0?original():search(1,1,0,0,MK,order);std::cout<<"{\"n\":"<<N<<",\"order\":"<<order<<",\"answer\":\""<<v<<"\",\"nodes\":"<<nodes<<",\"expanded\":"<<expanded<<",\"ms\":"<<std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-t).count()<<"}\n";}
