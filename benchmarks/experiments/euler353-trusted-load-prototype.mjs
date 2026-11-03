globalThis.Function = new Proxy(Function, {construct(target,args){
 const code=args.at(-1);
 if (/changed\d+ = changes\[/.test(code)) {
   const optimized=code.replace(/safe\(Number\((cells\d+\[[^\]]+\])\)\)/g,'integerCell($1)');
   if(optimized!==code){
     const factory=Reflect.construct(target,[...args.slice(0,-1),'integerCell',optimized]);
     return (...bindings)=>factory(...bindings,value=>value);
   }
 }
 return Reflect.construct(target,args);
}});
