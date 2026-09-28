import express from "express";import{createServer}from"http";import{WebSocketServer}from"ws";import crypto from"crypto";
const app=express();app.use(express.static("public"));app.get("/health",(_,r)=>r.json({ok:true}));const s=createServer(app),w=new WebSocketServer({server:s}),rooms=new Map(),MAX=10,SETUP=25000,ROUND=90000;
const id=()=>crypto.randomUUID(),code=()=>crypto.randomBytes(3).toString("hex").toUpperCase(),send=(p,m)=>p.ws?.readyState===1&&p.ws.send(JSON.stringify(m)),now=()=>Date.now(),cl=(v,a,b)=>Math.max(a,Math.min(b,v)),safe=n=>String(n||"Player").slice(0,18).replace(/[^\w -]/g,"")||"Player";
const sp=[[-12,1,10],[-4,1,10],[4,1,10],[12,1,10],[-12,1,-10],[-4,1,-10],[4,1,-10],[12,1,-10],[0,1,12],[0,1,-12]];
function out(r){return{code:r.code,phase:r.phase,left:Math.max(0,r.end-now()),players:[...r.p.values()].map(x=>({...x,ws:undefined}))}}function emit(r){let m=JSON.stringify({type:"state",room:out(r)});r.p.forEach(x=>x.ws?.readyState===1&&x.ws.send(m))}
function reset(r,rot=false){let p=[...r.p.values()].filter(x=>x.on);if(rot){let h=p.filter(x=>x.role==="hider").map(x=>x.id);p.forEach((x,i)=>x.role=h.includes(x.id)?"seeker":"hider")}else{p.sort(()=>Math.random()-.5);let n=Math.max(1,Math.floor(p.length/3));p.forEach((x,i)=>x.role=i<n?"seeker":"hider")}p.forEach((x,i)=>Object.assign(x,{x:sp[i][0],y:1,z:sp[i][2],found:false,color:"#fff",pose:"stand"}));r.phase="setup";r.end=now()+SETUP;r.roundEnd=r.end+ROUND;emit(r)}
function finish(r){let h=[...r.p.values()].filter(x=>x.on&&x.role==="hider"),s=[...r.p.values()].filter(x=>x.on&&x.role==="seeker"),alive=h.filter(x=>!x.found);alive.forEach(x=>x.score+=2);s.forEach(x=>x.score+=h.length-alive.length);r.phase="results";r.end=now()+6500;r.next=r.end;emit(r);setTimeout(()=>rooms.has(r.code)&&reset(r,true),7000)}
function join(q,r){if(r.p.size>=MAX&&!r.p.has(q.id))return send(q,{type:"error",message:"Room full"});q.room=r.code;q.on=true;r.p.set(q.id,q);send(q,{type:"joined",self:q.id,room:out(r)});emit(r)}
w.on("connection",ws=>{let q={id:id(),name:"Player",role:"hider",score:0,x:0,y:1,z:0,color:"#fff",pose:"stand",on:true,ws,room:null,input:{x:0,z:0}};
send(q,{type:"welcome",id:q.id,rooms:[...rooms.values()].filter(r=>r.public).map(r=>({code:r.code,players:r.p.size}))});
ws.on("message",raw=>{let m;try{m=JSON.parse(raw)}catch{return}
if(m.type==="hello"){q.name=safe(m.name);if(m.clientId)q.id=m.clientId;let old=[...rooms.values()].find(r=>r.p.get(q.id));if(old){q={...old.p.get(q.id),ws,on:true};old.p.set(q.id,q);return send(q,{type:"joined",self:q.id,room:out(old)})}}
if(m.type==="create"){let c=code();while(rooms.has(c))c=code();let r={code:c,public:!!m.public,p:new Map(),phase:"lobby",end:0,roundEnd:0};rooms.set(c,r);return join(q,r)}
if(m.type==="join"){let r=rooms.get(String(m.code||"").toUpperCase());if(!r)return send(q,{type:"error",message:"Room not found"});return join(q,r)}
if(!q.room)return;let r=rooms.get(q.room);if(!r)return;
if(m.type==="start"&&r.phase==="lobby"&&r.p.size>=2)return reset(r);
if(m.type==="input")q.input={x:cl(+m.x||0,-1,1),z:cl(+m.z||0,-1,1)};
if(m.type==="customize"&&r.phase==="setup"&&q.role==="hider"){if(/^#[0-9a-f]{6}$/i.test(m.color||""))q.color=m.color;if(["stand","crouch","curl"].includes(m.pose))q.pose=m.pose;emit(r)}
if(m.type==="spot"&&r.phase==="search"&&q.role==="seeker"){let t=r.p.get(m.targetId);if(t&&t.role==="hider"&&!t.found&&Math.hypot(q.x-t.x,q.z-t.z)<3.5){t.found=true;q.score+=3;emit(r);if([...r.p.values()].filter(x=>x.role==="hider").every(x=>x.found))finish(r)}}});
ws.on("close",()=>{q.on=false;q.drop=now()})});
setInterval(()=>{for(let r of rooms.values()){let p=[...r.p.values()].filter(x=>x.on);if(r.phase==="lobby"&&p.length>=2&&p.some(x=>x.autostart))reset(r);if(r.phase==="setup"&&now()>=r.end){r.phase="search";r.end=r.roundEnd;emit(r)}if(r.phase==="search"&&now()>=r.end)finish(r);if(r.phase==="setup"||r.phase==="search"){p.forEach(x=>{x.x=cl(x.x+x.input.x*.22,-18,18);x.z=cl(x.z+x.input.z*.22,-14,14)});emit(r)}for(let x of r.p.values())if(!x.on&&now()-x.drop>15000)r.p.delete(x.id)}},50);
s.listen(process.env.PORT||3000);