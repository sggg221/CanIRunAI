// Maintainer refresh: official manifests + small metadata byte ranges; never pulls full models.
import {readFile,writeFile,rename} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import path from 'node:path';import {createHash} from 'node:crypto';import {parseMetadata} from './registry/gguf.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'packages/model-registry'),seeds=JSON.parse(await readFile(path.join(dir,'catalog-seeds.json'),'utf8')),previous=JSON.parse(await readFile(path.join(dir,'models.json'),'utf8'));
const results=[],failures=[],evidence=[],verifiedAt=new Date().toISOString();
async function get(url,headers){const r=await fetch(url,{headers,signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(`${r.status} ${url}`);return r}
async function refresh(seed){
 const [family,tag]=seed.tag.split(':');if(!/^[a-z0-9.-]+$/.test(family)||!tag||/cloud|latest|mlx|nvfp/i.test(tag))throw Error('Explicit local GGUF tag required');
 const base=`https://registry.ollama.ai/v2/library/${family}`;
 const response=await get(`${base}/manifests/${tag}`),raw=Buffer.from(await response.arrayBuffer()),manifest=JSON.parse(raw);
 const configResponse=await get(`${base}/blobs/${manifest.config.digest}`),configRaw=Buffer.from(await configResponse.arrayBuffer());if('sha256:'+createHash('sha256').update(configRaw).digest('hex')!==manifest.config.digest)throw Error('Config checksum mismatch');const config=JSON.parse(configRaw);
 if(config.model_format!=='gguf'||config.remote_host||!manifest.layers?.length)throw Error('Not a local GGUF model');
 const layer=manifest.layers.find(l=>l.mediaType==='application/vnd.ollama.image.model');if(!layer)throw Error('Missing local model layer');
 const r=await get(`${base}/blobs/${layer.digest}`,{Range:'bytes=0-4194303'});if(r.status!==206)throw Error('Registry did not honor bounded range request');
 const meta=parseMetadata(Buffer.from(await r.arrayBuffer())),arch=meta['general.architecture'];
 const layers=meta[`${arch}.block_count`],heads=meta[`${arch}.attention.head_count_kv`],headCount=meta[`${arch}.attention.head_count`],embedding=meta[`${arch}.embedding_length`],key=meta[`${arch}.attention.key_length`]??embedding/(Array.isArray(headCount)?Math.max(...headCount):headCount),context=meta[`${arch}.context_length`];
 if(!arch||!layers||!heads||!key||!context)throw Error('Incomplete architecture metadata');
 let license=meta['general.license'];if(!license){const l=manifest.layers.find(l=>l.mediaType==='application/vnd.ollama.image.license');if(l&&l.size<200000){const t=await(await get(`${base}/blobs/${l.digest}`)).text();license=/Apache License[\s\S]{0,100}2\.0/.test(t)?'Apache-2.0':/MIT License/.test(t)?'MIT':/gemma/i.test(t)?'Gemma terms':seed.license;}}
 const bytes=manifest.layers.reduce((n,l)=>n+l.size,0)+manifest.config.size;
 const old=previous.find(m=>m.id===seed.id),oldVariant=old?.variants.find(v=>v.tag===seed.tag);
 const paramString=config.model_type?.match(/([\d.]+)([BM])/),parameters=meta['general.parameter_count']?meta['general.parameter_count']/1e9:paramString?Number(paramString[1])*(paramString[2]==='M'?.001:1):null;if(!parameters)throw Error('Missing parameter count');
 const hybrid=Array.isArray(heads)&&heads.includes(0)||/qwen35|qwen3next|lfm2/.test(arch);
 const variant={id:oldVariant?.id??`${seed.id}-${config.file_type.toLowerCase()}`,tag:seed.tag,quantization:config.file_type,runtime:'ollama',bytes,weightGB:bytes/1073741824,digest:createHash('sha256').update(raw).digest('hex'),modelDigest:layer.digest,layers,kvHeads:Array.isArray(heads)?Math.max(...heads):heads,headDim:key,...(Array.isArray(heads)?{kvHeadsByLayer:heads}:{}),stateMemoryGB:hybrid?.5:0};
 const result={id:seed.id,name:seed.name,developer:seed.developer,family,architecture:arch,parameters,activeParameters:seed.activeParameters,category:seed.category,description:seed.description,context,capabilities:seed.capabilities,officialSource:`https://ollama.com/library/${seed.tag}`,license:license??seed.license,releaseDate:seed.releaseDate,quality:seed.quality,variants:[variant],verifiedAt,minimumRuntimeVersion:config.requires??null,memoryEstimateNote:hybrid?'按注意力层计算 KV，并额外预留混合架构状态内存；仍为保守估算。':'按模型头部计算 KV；滑动窗口按全上下文保守估算。',metadataSource:`${base}/manifests/${tag}`,validation:old?.validation==='inference_tested'&&oldVariant?.digest===variant.digest?'inference_tested':'metadata_verified'};
 // Preserve previous audited revisions so existing installations remain recognized.
 if(oldVariant&&oldVariant.digest!==variant.digest)result.variants.push({...oldVariant,id:oldVariant.id+'-revision-'+oldVariant.digest.slice(0,8),archived:true});
 for(const v of old?.variants??[])if(v.digest!==variant.digest&&!result.variants.some(x=>x.digest===v.digest))result.variants.push({...v,archived:true});
 evidence.push({id:seed.id,tag:seed.tag,config,metadata:meta,manifest});return result;
}
for(let i=0;i<seeds.length;i+=3){await Promise.all(seeds.slice(i,i+3).map(async seed=>{try{const m=await refresh(seed);results.push(m);console.log(`Verified ${seed.tag}: ${(m.variants[0].bytes/1e9).toFixed(2)} GB · ${m.variants[0].quantization}`)}catch(error){failures.push({id:seed.id,message:error.message});console.error(`Failed ${seed.tag}: ${error.message}`)}}))}
if(failures.length){console.error('No catalog files were changed. Resolve all refresh failures before publishing.');process.exit(1)}
results.sort((a,b)=>seeds.findIndex(s=>s.id===a.id)-seeds.findIndex(s=>s.id===b.id));
const report={version:'0.2.0',verifiedAt,modelCount:results.length,familyCount:new Set(results.map(m=>m.family)).size,source:'https://ollama.com/library?sort=newest',scope:'精选本地模型；不等同于官方全量目录',excluded:[{name:'qwen3.8-flash-next',reason:'实验预览；GGUF 约 120GB，暂未纳入本版部署支持'},{name:'云端专用与无本地权重模型',reason:'本应用仅提供本机推理'}]};
for(const [name,value]of [['models.json',results],['catalog-info.json',report],['catalog-evidence.json',evidence]]){const f=path.join(dir,name);await writeFile(f+'.tmp',JSON.stringify(value,null,2)+'\n');await rename(f+'.tmp',f)}
console.log(`Updated ${report.modelCount} entries across ${report.familyCount} families. ${verifiedAt}`);
