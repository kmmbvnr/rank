// Heron and all three corners, independent of the vector x,y,z layout.
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
int main(int argc,char**argv){
    int n=argc>1?std::atoi(argv[1]):1803;
    long double total=0;long long count=0;
    for(int a=1;a<=n/2;a++)for(int b=a;b<=n-a;b++)for(int c=b;c<a+b;c++){
        long double s=(a+b+c)/2.L;
        long double radius2=(s-a)*(s-b)*(s-c)/s;
        const long double sides[]={static_cast<long double>(a),static_cast<long double>(b),static_cast<long double>(c)};
        long double ratios[3];
        for(int i=0;i<3;i++){
            long double sine=std::sqrt((s-sides[(i+1)%3])*(s-sides[(i+2)%3])/(sides[(i+1)%3]*sides[(i+2)%3]));
            ratios[i]=(1-sine)/(1+sine);
        }
        std::sort(ratios,ratios+3,std::greater<long double>());
        long double next=std::max(ratios[1],ratios[0]*ratios[0]);
        total+=radius2*(1+ratios[0]*ratios[0]+next*next);count++;
    }
    std::cout<<std::setprecision(20)<<"{\"n\":"<<n<<",\"count\":"<<count<<",\"mean\":"<<total*acosl(-1.L)/count<<"}\n";
}
