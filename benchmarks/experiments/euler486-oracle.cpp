#include <algorithm>
#include <cstdint>
#include <iostream>
#include <numeric>
#include <vector>
using I = int64_t;
I mod(I a,I m) { a%=m;return a<0?a+m:a; }
I power(I a,I e,I m) { I r=1;for(;e;e/=2,a=a*a%m) if(e%2) r=r*a%m;return r; }
I inverse(I a,I m) {
    I old=1,next=0,b=m;
    while(b) { I q=a/b,t=a-q*b;a=b;b=t;t=old-q*next;old=next;next=t; }
    return mod(old,m);
}
int main(int argc,char**argv) {
    I limit=argc>1?std::stoll(argv[1]):1000000000000000000LL;
    const I bias[]={182,216,252,286,318,350};
    I answer=0,period=0;std::vector<I> first;
    for(I u=0;u<6;u++) {
        std::vector<I> values={0};I ma=1;
        for(I m:{9,1997,4877}) {
            I order=1;while(power(64,order,m)!=1) order++;
            I mb=order*m,back=inverse(order,m),scale=inverse(200,m);
            std::vector<I> residues;
            for(I s=0;s<order;s++) {
                I target=mod((power(2,10+u,m)*power(64,s,m)-bias[u])*scale,m);
                residues.push_back(s+order*mod((target-s)*back,m));
            }
            I g=std::gcd(ma,mb),small=mb/g,inv=inverse(ma/g,small);
            std::vector<I> joined;
            for(I a:values) for(I b:residues) if((b-a)%g==0)
                joined.push_back(a+ma*mod((b-a)/g*inv,small));
            values=std::move(joined);ma*=small;
        }
        period=6*ma;
        for(I t:values) {
            I n=9+u+6*t;
            first.push_back(n);
            if(n<=limit) answer+=(limit-n)/period+1;
        }
    }
    std::sort(first.begin(),first.end());
    std::cout<<"{\"limit\":\""<<limit<<"\",\"answer\":\""<<answer<<"\",\"period\":\""<<period<<"\",\"residues\":"<<first.size()<<",\"first\":[";
    for(size_t i=0;i<std::min<size_t>(20,first.size());i++) std::cout<<(i?",":"")<<first[i];
    std::cout<<"]}\n";
}
