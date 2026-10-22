const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const exportsObject={};
const source=ts.transpileModule(fs.readFileSync('src/services/nearby.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(source,{exports:exportsObject,require:()=>({API_BASE_URL:''}),fetch,AbortController,Error,TypeError,URL,Date,setTimeout,clearTimeout});
(async()=>{try{const result=await exportsObject.fetchOsmExploreResult({latitude:10.7764,longitude:106.6993},1,{forceRefresh:true});console.log(JSON.stringify({live:true,count:result.places.length,requestedRadiusKm:result.requestedRadiusKm,searchedRadiusKm:result.searchedRadiusKm,warning:result.warning,examples:result.places.slice(0,3).map(p=>({id:p.id,title:p.title}))},null,2));}catch(error){console.log(JSON.stringify({live:false,error:error.message}));process.exitCode=1;}})();
