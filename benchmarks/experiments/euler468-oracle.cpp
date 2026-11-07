#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <vector>
using U=uint64_t;
constexpr U Mod=1000000993;
U power(U a,int e){U v=1;for(;e;e>>=1,a=a*a%Mod)if(e&1)v=v*a%Mod;return v;}
int main(int argc,char**argv){const int n=argc>1?std::atoi(argv[1]):11111111;
if(!n){std::cout<<0<<"\n";return 0;}
auto start=std::chrono::steady_clock::now();
std::vector<int> sp(n+1),primes,index(n+1,-1);
for(int i=2;i<=n;i++){if(!sp[i]){sp[i]=i;index[i]=primes.size();primes.push_back(i);}for(int p:primes){if(p>sp[i]||int64_t(p)*i>n)break;sp[p*i]=p;}}
int width=1;while(width<int(primes.size()))width*=2;
std::vector<U> product(2*width,1),total(2*width,0);
std::vector<int> exponent(primes.size(),0);
for(int i=0;i<int(primes.size());i++)total[width+i]=(i+1<int(primes.size())?primes[i+1]:n+1)-primes[i];
auto combine=[&](int slot){product[slot]=product[2*slot]*product[2*slot+1]%Mod;total[slot]=(total[2*slot]+product[2*slot]*total[2*slot+1])%Mod;};
for(int i=width-1;i;i--)combine(i);
auto update=[&](int value,int sign){while(value>1){int p=sp[value],delta=0;do{delta++;value/=p;}while(value>1&&sp[value]==p);const int leaf=index[p];exponent[leaf]+=sign*delta;if(exponent[leaf]<0)std::abort();int slot=width+leaf;U v=power(p,exponent[leaf]);product[slot]=v;U gap=(leaf+1<int(primes.size())?primes[leaf+1]:n+1)-p;total[slot]=v*gap%Mod;while((slot/=2))combine(slot);}};
U sum=(1+total[1])%Mod,last=sum;
for(int r=1;r<=n/2;r++){update(n-r+1,1);update(r,-1);last=(1+total[1])%Mod;sum=(sum+last)%Mod;}
U answer=(2*sum+(n%2?0:Mod-last))%Mod;
std::cout<<answer<<"\n";std::cerr<<"milliseconds="<<std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count()<<"\n";
}
