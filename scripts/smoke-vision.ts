// Real inference test. First run an isolated Ollama at 127.0.0.1:11435.
// Downloads about 1.04 GB. Does not stop models on the user's normal port 11434.
import { createBridge } from "../apps/bridge/server.ts";
import { models } from "../packages/model-registry/index.ts";
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const originalFetch = globalThis.fetch;
// Test-only transport routing to a real isolated Ollama; no mocked responses.
globalThis.fetch = (input, init) => originalFetch(typeof input === "string" ? input.replace("http://127.0.0.1:11434/", "http://127.0.0.1:11435/") : input, init);
await fetch("http://127.0.0.1:11435/api/version").then(r => {if (!r.ok) throw Error("Start isolated Ollama first");});
const dataDir = path.resolve(process.env.CANIRUN_VISION_SMOKE_DIR ?? "../../work/vision-smoke-data");
const b = await createBridge({dataDir,port:31420});
await new Promise<void>(r => b.server.listen(31420,"127.0.0.1",r));
let token = "";
async function call(route:string, body?:unknown) {
 const r = await fetch("http://127.0.0.1:31420"+route,{method:body?"POST":"GET",headers:{Origin:"http://localhost:3000",...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});
 const data:any=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;
}
function crc32(b:Buffer){let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
const head=Buffer.alloc(13);head.writeUInt32BE(256,0);head.writeUInt32BE(256,4);head[8]=8;head[9]=2;
const pixels=Buffer.alloc(256*(1+256*3));for(let y=0;y<256;y++)for(let x=0;x<256;x++)pixels[y*769+1+x*3]=255;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",head),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
const report:any={date:new Date().toISOString(),model:"qwen3.5-0.8b",digest:models.find(m=>m.id==="qwen3.5-0.8b")!.variants[0].digest,transport:"HTTP Bridge to real isolated local Ollama on port 11435",fixture:"256x256 red square PNG"};
try {
 const c=await call("/challenge",{});token=(await call("/pair",{challenge:c.challenge,code:b.getPairCode()})).token;
 const started=await call("/action",{action:"deploy",model_id:report.model});let d:any,last="";
 const deadline=Date.now()+900000;
 while(Date.now()<deadline){const s=await call("/status");d=s.deployments.find((x:any)=>x.id===started.result.id);const progress=d.stage+" "+Math.round(d.download.completed/Math.max(1,d.download.total)*100)+"%";if(progress!==last){console.log(progress);last=progress;}if(d.stage==="running")break;if(d.stage==="failed")throw Error(JSON.stringify(d.error));await new Promise(r=>setTimeout(r,2000));}
 assert.equal(d.stage,"running"); report.deployment=d;
 const body={model:report.model,messages:[{role:"user",content:[{type:"text",text:"这张图片的主要颜色是什么？只用一个中文颜色词回答。"},{type:"image_url",image_url:{url:"data:image/png;base64,"+png.toString("base64")}}]}],stream:false,max_tokens:256};
 const reply=await call("/v1/chat/completions",body);report.reply=reply;
 console.log("Real vision answer:",reply.choices[0].message.content);assert.match(reply.choices[0].message.content,/红|red/i);
 const response=await fetch("http://127.0.0.1:31420/v1/chat/completions",{method:"POST",headers:{Origin:"http://localhost:3000","Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({...body,stream:true})});
 const stream=await response.text();assert.ok(response.ok);assert.ok(stream.includes("[DONE]"));assert.ok(!stream.includes('"error"'));report.streaming=true;
 report.result="passed";console.log("Real image HTTP + SSE passed.");
}finally{
 try{await call("/action",{action:"stop_model",model_id:report.model});}catch{}
 await mkdir(path.dirname(dataDir),{recursive:true});await writeFile(path.join(path.dirname(dataDir),"vision-smoke-result.json"),JSON.stringify(report,null,2));
 b.server.closeAllConnections();await new Promise<void>(r=>b.server.close(()=>r()));globalThis.fetch=originalFetch;
}
