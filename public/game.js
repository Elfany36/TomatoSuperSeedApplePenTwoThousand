
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";
import { SURFACES, WORLD_BOUNDS, STATIC_WORLD } from "./world.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MAPS = [
  { id:"grove", label:"GROVE", url:"https://cdn.3dassets.dev/assets/38765/v1/model.glb", sky:"#8fb7bd" },
  { id:"backrooms", label:"BACKROOMS", url:"https://cdn.3dassets.dev/assets/25333/v1/model.glb", sky:"#b4a76d" },
  { id:"gallery", label:"GALLERY", url:"https://cdn.3dassets.dev/assets/35871/v1/model.glb", sky:"#e7e9e7" },
  { id:"restaurant", label:"RESTAURANT", url:"https://cdn.3dassets.dev/assets/16541/v1/model.glb", sky:"#8b776b" },
  { id:"supermarket", label:"SUPERMARKET", url:"https://cdn.3dassets.dev/assets/26952/v1/model.glb", sky:"#91a6b1" },
  { id:"hotel", label:"HOTEL", url:"https://cdn.3dassets.dev/assets/25950/v1/model.glb", sky:"#82939f" },
  { id:"sewer", label:"SEWER", url:"https://cdn.3dassets.dev/assets/27259/v1/model.glb", sky:"#39464d" },
  { id:"city", label:"CITY", url:"https://cdn.3dassets.dev/assets/29075/v1/model.glb", sky:"#6f879b" },
  { id:"farm", label:"FARM", url:"https://cdn.3dassets.dev/assets/16895/v1/model.glb", sky:"#91a77a" }
];

const $ = (id) => document.getElementById(id);
const CLIENT_KEY = "cameleon.clientId";
const NAME_KEY = "cameleon.name";
const clientId = localStorage.getItem(CLIENT_KEY) || crypto.randomUUID();
localStorage.setItem(CLIENT_KEY, clientId);

const COLORS = SURFACES.filter(s => s.kind !== "ground").map(s => s.color).concat([
  "#FFFFFF", "#101522", "#FF6B6B", "#4D96FF", "#65E6BA", "#FF9F43"
]).filter((v, i, a) => a.indexOf(v) === i);

const state = {
  socket: null,
  reconnectTimer: null,
  reconnectAttempt: 0,
  room: null,
  selfId: clientId,
  scene: null,
  camera: null,
  renderer: null,
  worldGroup: null,
  assetGroup: null,
  playerGroup: null,
  effectGroup: null,
  mapDressGroup: null,
  ambientPoints: null,
  ambientVelocities: [],
  sampleMeshes: [],
  players: new Map(),
  effects: [],
  lastFrame: performance.now(),
  lastInputAt: 0,
  input: { x: 0, z: 0, yaw: 0 },
  lastSentInput: { x: 0, z: 0, yaw: 0 },
  lastPhase: null,
  timerSecond: -1,
  audio: null,
  noiseUntil: 0,
  mouseLook: false,
  brushMode: "brush",
  brushSize: 1,
  selectedColor: COLORS[0],
  assetKey: "grove",
  assetCache: new Map(),
  mixers: [],
  mixerCache: new Map(),
  paintTextureCache: new Map(),
  adjustBrush: false,
  hopUntil: 0,
  scanCooldownUntil: 0,
  cameraMode: "third",
  pitch: -0.05,
  stamina: 100,
  lastRound: -1,
  pointerLocked: false,
  paintModeOpen: false,
  fps: 60,
  frameSamples: [],
  lastPerfHud: 0,
  ping: 0,
  pingTimer: null,
  painting: false,
  lastPaintAt: 0,
  assetLoadToken: 0
};

function apiSocketUrl() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return protocol + "://" + location.host + "/ws";
}

function send(message) {
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(message));
    return true;
  }
  return false;
}

function toast(text, ttl = 2200) {
  const item = document.createElement("div");
  item.className = "event";
  item.textContent = text;
  $("eventFeed").appendChild(item);
  setTimeout(() => item.remove(), ttl);
}

function setConnection(text, good = false) {
  $("connection").textContent = text;
  $("connection").style.color = good ? "#65e6ba" : "#ffffff80";
}

window.addEventListener("error",event=>{
  console.error("[CAMELEON]",event.error||event.message);
  if($("bootStatus"))$("bootStatus").textContent="Runtime error · "+String(event.message||"unknown").slice(0,72);
});
window.addEventListener("unhandledrejection",event=>{
  console.error("[CAMELEON]",event.reason);
  if($("bootStatus"))$("bootStatus").textContent="Async error · "+String(event.reason?.message||event.reason||"unknown").slice(0,72);
});
function connect() {
  if (state.socket && state.socket.readyState <= WebSocket.OPEN) return;
  setConnection("Connecting…");
  const ws = new WebSocket(apiSocketUrl());
  state.socket = ws;

  ws.addEventListener("open", () => {
    state.reconnectAttempt = 0;
    clearInterval(state.pingTimer);
    state.pingTimer = setInterval(() => {
      if (state.socket?.readyState === WebSocket.OPEN) send({type:"ping",t:performance.now()});
    }, 2000);
    setConnection("Connected", true);
    send({
      type: "hello",
      clientId,
      name: localStorage.getItem(NAME_KEY) || $("name").value || "Player"
    });
  });

  ws.addEventListener("message", event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    handleMessage(message);
  });

  ws.addEventListener("close", () => {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
    state.socket = null;
    if (state.room) {
      setConnection("Reconnecting…");
      const delay = Math.min(5000, 600 + state.reconnectAttempt * 600);
      state.reconnectAttempt += 1;
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(connect, delay);
    } else {
      setConnection("Offline — retrying…");
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(connect, 1200);
    }
  });

  ws.addEventListener("error", () => setConnection("Connection error"));
}

function handleMessage(message) {
  if (message.type === "welcome") {
    state.selfId = message.self || state.selfId;
    renderPublicRooms(message.rooms || []);
    return;
  }

  if (message.type === "rooms") {
    renderPublicRooms(message.rooms || []);
    return;
  }

  if (message.type === "pong") {
    state.ping = Math.max(0, Math.round(performance.now() - Number(message.t || performance.now())));
    if ($("netReadout")) $("netReadout").textContent = state.ping + " ms";
    return;
  }

  if (message.type === "joined" || message.type === "reconnected") {
    state.selfId = message.self;
    state.room = message.room;
    $("lobby").hidden = true;
    $("game").hidden = false;
    ensureScene();
    updateRoom(message.room);
    if(message.room?.round && state.scene) loadMapForRound(message.room.round);
    toast(message.type === "reconnected" ? "Reconnected to your round." : "Joined room " + message.room.code);
    return;
  }

  if (message.type === "state") {
    updateRoom(message.room);
    return;
  }

  if (message.type === "clone_created") { toast("Decoy clone deployed.", 1400); playPoseSound(); return; }

  if (message.type === "customized") {
    state.selectedColor = message.color || state.selectedColor;
    state.brushSize = message.brushSize || state.brushSize;
    buildPalette(state.selectedColor);
    toast("Painted " + (message.surface || "surface").toLowerCase());
    playSampleSound();
    return;
  }

  if (message.type === "spot_effect") {
    spawnSpotEffect(message.x, message.z, message.success);
    if (message.success) {
      playSpotSound();
      const target = state.room?.players.find(p => p.id === message.targetId);
      toast(message.clone ? "Decoy clone destroyed." : ((target?.name || "A hider") + " was spotted!"), 2800);
    }
    return;
  }

  if (message.type === "spot_miss") {
    playMissSound();
    toast("Miss — " + (message.reason === "wrong_direction" ? "turn toward the creature" : "too far / blocked"), 1100);
    return;
  }

  if (message.type === "scan_effect") {
    spawnScanEffect(message.x,message.z);
    $("scanFx")?.classList.remove("active");
    void $("scanFx")?.offsetWidth;
    $("scanFx")?.classList.add("active");
    tone(260,0.08,"sine",0.03);
    return;
  }
  if (message.type === "taunt_effect") { toast((message.name||"Player")+" used TAUNT.",1600); return; }
  if (message.type === "footstep") {
    state.noiseUntil = performance.now() + 900;
    if (state.room?.phase === "search" && state.room?.players.some(p => p.id === state.selfId && p.role === "seeker")) {
      playFootstep(message.strength);
      $("noiseReadout").textContent = message.strength > 0.65 ? "LOUD FOOTSTEPS nearby" : "Faint footsteps nearby";
      spawnNoiseEffect(message.x, message.z, message.strength);
      setTimeout(() => {
        if (performance.now() > state.noiseUntil) $("noiseReadout").textContent = "No footsteps";
      }, 950);
    }
    return;
  }

  if (message.type === "error") {
    toast(message.message, 3000);
    return;
  }

  if (message.type === "left") {
    leaveToLobby(false);
  }
}

function renderPublicRooms(rooms) {
  const list = $("publicRooms");
  list.innerHTML = "";
  if (!rooms.length) {
    list.innerHTML = '<div class="muted">No public rooms yet — create one.</div>';
    return;
  }
  rooms.slice(0, 8).forEach(room => {
    const row = document.createElement("div");
    row.className = "room-item";
    row.innerHTML =
      "<div><b>" + room.code + "</b><br><span>" + room.players + "/" + room.maxPlayers + " players</span></div>";
    const button = document.createElement("button");
    button.textContent = "JOIN";
    button.addEventListener("click", () => {
      $("code").value = room.code;
      joinRoom();
    });
    row.appendChild(button);
    list.appendChild(row);
  });
}

function ensureScene() {
  if (state.scene) return;
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(STATIC_WORLD.skyColor);
  state.scene.fog = new THREE.Fog(STATIC_WORLD.skyColor, 24, 84);
  state.camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.08, 120);
  state.camera.rotation.order = "YXZ";
  state.renderer = new THREE.WebGLRenderer({
    canvas: $("scene"),
    antialias: Math.min(devicePixelRatio, 1.5) < 1.3,
    powerPreference: "high-performance"
  });
  state.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  state.renderer.setSize(innerWidth, innerHeight);
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = 1.12;
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  state.renderer.shadowMap.autoUpdate = true;
  state.renderer.info.autoReset = true;

  const hemi = new THREE.HemisphereLight("#F2FBFF", "#385545", 2.2);
  state.scene.add(hemi);
  const sun = new THREE.DirectionalLight("#FFF0CF", 3.4);
  sun.position.set(-14, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
  state.scene.add(sun);
  const fill = new THREE.DirectionalLight("#9CC6FF", .9);
  fill.position.set(18, 12, -10);
  state.scene.add(fill);

  // Always preload the default environment as soon as the renderer exists.
  // This makes the game visually useful before a round starts and removes
  // the need to manually choose/upload a map for normal play.
  loadMapForRound({ mapId: state.assetKey || "grove" });

  state.worldGroup = new THREE.Group();
  state.assetGroup = new THREE.Group();
  state.playerGroup = new THREE.Group();
  state.effectGroup = new THREE.Group();
  state.mapDressGroup = new THREE.Group();
  state.scene.add(state.worldGroup, state.assetGroup, state.playerGroup, state.effectGroup, state.mapDressGroup);

  buildWorld();
  buildAtmosphere("lobby");
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
}

function material(color, roughness = 0.86, transparent = false) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.03,
    flatShading: true,
    transparent,
    opacity: transparent ? 0.9 : 1
  });
}

function tagSample(mesh, surface) {
  mesh.userData.sampleColor = surface.color;
  mesh.userData.surfaceId = surface.id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  state.sampleMeshes.push(mesh);
}

function addBox(parent, x, y, z, w, h, d, color, surface, extra = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  if (surface) tagSample(mesh, surface);
  if (extra.rotationY) mesh.rotation.y = extra.rotationY;
  return mesh;
}

function indexSampleMeshes(root){
  state.sampleMeshes=[];
  root.traverse(o=>{ if(o.isMesh && o.userData?.sampleColor) state.sampleMeshes.push(o); });
}

function importAssetSurface(mesh){
  let color="#B8B8B8";
  const m=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
  if(m?.color){const v=m.color;color="#"+[v.r*255,v.g*255,v.b*255].map(n=>Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,"0")).join("");}
  mesh.userData.sampleColor=color;
  mesh.userData.surfaceId=mesh.userData.surfaceId||("asset:"+mesh.uuid);
  mesh.userData.surfaceName=mesh.name||"Environment surface";
  mesh.castShadow=true; mesh.receiveShadow=true;
}

function attachMap(root,key){
  state.assetGroup.clear();
  state.mapDressGroup.clear();
  const clone=root.clone(true);
  clone.traverse(o=>{if(o.isMesh)importAssetSurface(o)});
  indexSampleMeshes(clone);
  normalizeMapAsset(clone,38,28,10);
  state.assetGroup.add(clone);
  state.assetGroup.visible=true;
  state.worldGroup.visible=false;
  buildMapDressing(key);
  buildAtmosphere(key);
  $("mapLabel").textContent=MAPS.find(m=>m.id===key)?.label||key;
  if($("assetBtn"))$("assetBtn").innerHTML=`MAP <b>${MAPS.find(m=>m.id===key)?.label||key}</b>`;
  toast(`${MAPS.find(m=>m.id===key)?.label||key} map ready`);
}

function playGltfAnimations(root,animations,key=null){
  if(!animations?.length) return;
  if(key && state.mixerCache.has(key)) return;
  const mixer=new THREE.AnimationMixer(root);
  for(const clip of animations){try{mixer.clipAction(clip).play();}catch{}}
  state.mixers.push(mixer);
  if(key) state.mixerCache.set(key,mixer);
}

function addDressingBox(parent,x,y,z,w,h,d,color,emissive=null){
  const mat=new THREE.MeshStandardMaterial({color,roughness:.72,metalness:.05,emissive:emissive||"#000000",emissiveIntensity:emissive?1.8:0});
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function addDressingCylinder(parent,x,y,z,r,h,color,sides=8){
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r*.88,h,sides),material(color,.78));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function addGlowOrb(parent,x,y,z,color,scale=.12){
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(scale,10,8),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9}));mesh.position.set(x,y,z);parent.add(mesh);return mesh;
}
function buildMapDressing(key){
  const g=state.mapDressGroup;
  const themes={grove:["#8CF29A","#F7D774"],backrooms:["#FFE38A","#D7C7A2"],gallery:["#B7D7FF","#FFFFFF"],restaurant:["#FF8A6B","#FFD166"],supermarket:["#7DE5FF","#FF78B8"],hotel:["#D6B7FF","#8ED8FF"],sewer:["#55E0B3","#6A8BFF"],city:["#7CD7FF","#FF7BC8"],farm:["#B9F27C","#FFD166"]};
  const [accent,secondary]=themes[key]||themes.grove;
  for(let i=0;i<11;i++){const x=-20+i*4,z=key==="sewer"?-14.2:14.2;addDressingBox(g,x,2.05,z,.06,4.1,.06,accent);if(i%2===0)addGlowOrb(g,x,4.35,z-.08,secondary,.075);}
  if(key==="backrooms"||key==="hotel")for(let i=-3;i<=3;i++)addDressingBox(g,i*5.1,4.02,-14.3,2.8,.05,.05,accent,accent);
  if(key==="sewer")for(let i=-16;i<=16;i+=4){addDressingCylinder(g,i,.12,0,.18,.05,"#1B2C30",12);addGlowOrb(g,i,.2,0,accent,.045);}
  if(key==="farm"||key==="grove")for(let i=0;i<7;i++){const x=-17+i*5.6,z=i%2?-12.3:12.1;addDressingCylinder(g,x,.7,z,.1,1.4,"#6E4D36",7);addDressingCylinder(g,x,1.65,z,.5,.55,secondary,7);}
  if(key==="gallery")for(let i=0;i<5;i++){const x=-12+i*6;addDressingBox(g,x,2.15,-14.18,2.2,3.4,.12,"#F1F4F7");addDressingBox(g,x,2.25,-14.25,1.7,2.4,.06,accent);}
  if(key==="restaurant")for(const x of[-12,-6,6,12]){addDressingBox(g,x,1.7,-14,.9,3.4,.9,"#6A4A35");addDressingBox(g,x,3.45,-14,1.3,.08,1.3,accent,accent);}
  if(key==="supermarket"||key==="city")for(let i=0;i<5;i++){const x=-12+i*6;addDressingBox(g,x,1,-14,.18,2,.18,"#343B47");addDressingBox(g,x,1.95,-14,1.8,.7,.08,accent,accent);}
}
function buildAtmosphere(key){
  if(state.ambientPoints)state.effectGroup.remove(state.ambientPoints);
  const count=key==="sewer"?90:70;const positions=new Float32Array(count*3);state.ambientVelocities=[];
  for(let i=0;i<count;i++){positions[i*3]=THREE.MathUtils.randFloat(-21,21);positions[i*3+1]=THREE.MathUtils.randFloat(.3,8);positions[i*3+2]=THREE.MathUtils.randFloat(-16,16);state.ambientVelocities.push(THREE.MathUtils.randFloat(.08,.28));}
  const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.BufferAttribute(positions,3));
  const color=key==="sewer"?"#66E6C2":key==="backrooms"?"#FFF0B0":"#FFFFFF";
  state.ambientPoints=new THREE.Points(geo,new THREE.PointsMaterial({color,size:key==="sewer"?.055:.045,transparent:true,opacity:key==="sewer"?.24:.18,depthWrite:false}));state.effectGroup.add(state.ambientPoints);
}
function normalizeMapAsset(root,targetWidth=38,targetDepth=28,targetHeight=10){
  root.updateMatrixWorld(true);
  const before=new THREE.Box3().setFromObject(root);
  const size=before.getSize(new THREE.Vector3());
  const fit=Math.min(targetWidth/Math.max(size.x,1),targetDepth/Math.max(size.z,1),targetHeight/Math.max(size.y,1));
  const safeFit=Math.min(2.5,Math.max(.012,fit));
  root.scale.setScalar(safeFit);
  root.updateMatrixWorld(true);
  const after=new THREE.Box3().setFromObject(root);
  const center=after.getCenter(new THREE.Vector3());
  root.position.x+=-center.x;root.position.z+=-center.z;root.position.y+=-after.min.y;
  root.updateMatrixWorld(true);
  root.traverse(o=>{
    if(!o.isMesh)return;
    o.castShadow=true;o.receiveShadow=true;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const mat of mats){
      if(mat?.map){mat.map.anisotropy=Math.min(8,state.renderer?.capabilities.getMaxAnisotropy?.()||1);mat.map.needsUpdate=true;}
      if(mat){mat.roughness=Math.max(.18,mat.roughness??.6);mat.needsUpdate=true;}
    }
  });
  return safeFit;
}
function loadMapForRound(round){
  const map=MAPS[Math.max(0,(round||1)-1)%MAPS.length];
  state.assetKey=map.id;
  state.scene.background.set(map.sky);
  state.scene.fog.color.set(map.sky);
  $("mapLabel").textContent=map.label;
  const cached=state.assetCache.get(map.id);
  if(cached){ attachMap(cached.scene,map.id); return; }
  if($("assetBtn"))$("assetBtn").innerHTML='<b>LOADING…</b>';
  const token=++state.assetLoadToken;
  const timeout=setTimeout(()=>{
    if(token!==state.assetLoadToken)return;
    state.assetGroup.visible=false;state.worldGroup.visible=true;indexSampleMeshes(state.worldGroup);
    if($("bootStatus"))$("bootStatus").textContent=map.label+" timed out · fallback scene active";
    if($("assetBtn"))$("assetBtn").innerHTML='<b>FALLBACK</b>';
    toast(map.label+" asset timed out; fallback scene active.",3200);
  },12000);
  new GLTFLoader().load(map.url,g=>{clearTimeout(timeout);
    state.assetCache.set(map.id,{scene:g.scene,animations:g.animations||[]});
    playGltfAnimations(g.scene,g.animations||[],map.id);
    attachMap(g.scene,map.id);
    if($("bootStatus"))$("bootStatus").textContent=map.label+" environment loaded";
  },xhr=>{
    if($("bootStatus")&&xhr?.total)$("bootStatus").textContent=map.label+" "+Math.round(xhr.loaded/xhr.total*100)+"%";
  },()=>{clearTimeout(timeout);
    state.assetGroup.visible=false;
    state.worldGroup.visible=true;
    indexSampleMeshes(state.worldGroup);
    if($("bootStatus"))$("bootStatus").textContent=map.label+" fallback scene active";
    toast(map.label+" asset unavailable — fallback scene active.",3200);
    if($("assetBtn"))$("assetBtn").innerHTML='<b>FALLBACK</b>';
  });
}

function loadLocalMap(file){
  if(!file||!state.scene) return;
  const reader=new FileReader();
  reader.onload=()=>{
    const buffer=reader.result;
    new GLTFLoader().parse(buffer,"/",g=>{
      state.assetKey="local";
      state.scene.background.set("#6E7E86");
      state.scene.fog.color.set("#6E7E86");
      state.assetGroup.clear();
      const clone=g.scene.clone(true);
      clone.traverse(o=>{if(o.isMesh)importAssetSurface(o)});
      indexSampleMeshes(clone);
      normalizeMapAsset(clone,38,28,10);
      state.assetGroup.add(clone);
      state.assetGroup.visible=true; state.worldGroup.visible=false;
      playGltfAnimations(clone,g.animations||[]);
      $("mapLabel").textContent=file.name.replace(/\.(glb|gltf)$/i,"").slice(0,16).toUpperCase();
      $("assetBtn").innerHTML='<b>LOCAL</b>';
      $("bootStatus").textContent="Local environment loaded";
      toast("Local map loaded.");
    },undefined,()=>toast("Could not read this GLB/GLTF.",3200));
  };
  reader.readAsArrayBuffer(file);
}

function buildWorld() {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(42, 0.6, 32),
    material(STATIC_WORLD.floorColor)
  );
  floor.position.y = -0.32;
  floor.receiveShadow = true;
  state.worldGroup.add(floor);
  floor.userData.sampleColor = STATIC_WORLD.floorColor;
  floor.userData.surfaceId = "floor";
  state.sampleMeshes.push(floor);

  for (const surface of SURFACES) {
    if (surface.kind === "ground") {
      const path = new THREE.Mesh(
        new THREE.BoxGeometry(surface.w, surface.h, surface.d),
        material(surface.color)
      );
      path.position.set(surface.x, 0.03, surface.z);
      path.receiveShadow = true;
      tagSample(path, surface);
      state.worldGroup.add(path);
      continue;
    }

    const group = new THREE.Group();
    group.position.set(surface.x, 0, surface.z);
    state.worldGroup.add(group);

    if (surface.kind === "tree") {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.55, 2.1, 7),
        material("#8F6B4C")
      );
      trunk.position.y = 1.05;
      trunk.castShadow = trunk.receiveShadow = true;
      group.add(trunk);
      const crown = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.7, 1),
        material(surface.color)
      );
      crown.position.y = 3.25;
      tagSample(crown, surface);
      group.add(crown);
    } else if (surface.kind === "tent") {
      const base = addBox(group, 0, surface.h * 0.48, 0, surface.w, surface.h, surface.d, surface.color, surface);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(surface.w * 0.6, 1.8, 5),
        material(surface.color)
      );
      roof.position.y = surface.h + 0.7;
      tagSample(roof, surface);
      group.add(roof);
      base.scale.y = 0.88;
    } else if (surface.kind === "cone") {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.62, surface.h, 7),
        material(surface.color)
      );
      cone.position.y = surface.h * 0.5;
      tagSample(cone, surface);
      group.add(cone);
      addBox(group, 0, 0.35, 0, 1.4, 0.2, 1.4, "#F7F2DC", null);
    } else if (surface.kind === "vending") {
      addBox(group, 0, surface.h * 0.5, 0, surface.w, surface.h, surface.d, surface.color, surface);
      addBox(group, 0, 2.05, surface.d * 0.51, 1.35, 0.85, 0.08, "#BDF3FF", null);
      addBox(group, 0, 1.1, surface.d * 0.52, 1.4, 0.09, 0.08, "#FF6B9E", null);
    } else if (surface.kind === "waffle") {
      addBox(group, 0, 0.95, 0, surface.w, 1.9, surface.d, surface.color, surface);
      for (let i = -1; i <= 1; i++) addBox(group, i * 0.95, 2.15, 0, 0.62, 0.48, 0.62, "#FFF0B2", null);
    } else if (surface.kind === "stage") {
      addBox(group, 0, 1.35, 0, surface.w, 2.7, surface.d, surface.color, surface);
      addBox(group, 0, 2.85, 0, surface.w * 0.85, 0.25, surface.d * 0.8, "#FDF5E6", null);
      addBox(group, -1.2, 3.15, 0, 0.18, 0.7, 0.18, "#E94F64", null);
      addBox(group, 1.2, 3.15, 0, 0.18, 0.7, 0.18, "#E94F64", null);
    } else {
      addBox(group, 0, surface.h * 0.5, 0, surface.w, surface.h, surface.d, surface.color, surface);
      if (surface.kind === "crate") {
        addBox(group, 0, surface.h * 0.5 + 0.18, 0, surface.w * 0.74, 0.18, surface.d * 0.74, "#FFB4B4", null);
      }
      if (surface.kind === "bench") {
        addBox(group, 0, 0.85, 0, surface.w * 0.94, 0.25, surface.d * 0.8, surface.color, null);
        addBox(group, -1.35, 0.38, 0, 0.22, 0.85, surface.d * 0.72, "#664832", null);
        addBox(group, 1.35, 0.38, 0, 0.22, 0.85, surface.d * 0.72, "#664832", null);
      }
      if (surface.kind === "throne") {
        addBox(group, 0, 1.0, -0.65, 2.4, 2.0, 0.36, surface.color, null);
        addBox(group, -0.85, 0.85, 0, 0.34, 1.7, 1.35, surface.color, null);
        addBox(group, 0.85, 0.85, 0, 0.34, 1.7, 1.35, surface.color, null);
      }
    }
  }

  // Small decorative props inspired by the extracted asset names.
  const propColors = ["#FF8FAB", "#FFE066", "#6EE7B7", "#8EC5FF"];
  const props = [
    [-17, -3, 0.8, 1.5], [-8, -1.5, 0.65, 1.1], [3, -3, 0.65, 1.5],
    [17, -1, 0.72, 1.2], [13, -11, 0.55, 1.0], [-4, 11.5, 0.55, 1.4]
  ];
  props.forEach((p, i) => {
    const [x, z, r, h] = p;
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.3, h, 6), material("#7A6045"));
    stem.position.y = h / 2;
    g.add(stem);
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), material(propColors[i % propColors.length]));
    top.position.y = h;
    g.add(top);
    g.position.set(x, 0, z);
    g.userData = { decorative: true };
    stem.castShadow = top.castShadow = true;
    state.worldGroup.add(g);
  });
}

function addGroundDetails() {
  for (let i = -18; i <= 18; i += 4) {
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 8), material("#F3E1A2"));
    dot.rotation.x = Math.PI / 2;
    dot.position.set(i, 0.09, 0);
    state.worldGroup.add(dot);
  }
}

function makePlayerMesh(player) {
  const group=new THREE.Group();group.userData.playerId=player.id;
  const skin=material(player.role==="seeker"?"#7566D8":(player.color||"#FFFFFF"),.62),skinDark=material("#26353C",.48),shell=material(player.role==="seeker"?"#BEB5FF":"#DCE9E4",.58),shellDark=material("#879B92",.7);
  const eye=new THREE.MeshStandardMaterial({color:"#F7FFFF",roughness:.2,metalness:.05,emissive:"#8DEBFF",emissiveIntensity:.35}),pupil=material("#10151D",.2);
  const body=new THREE.Mesh(new THREE.SphereGeometry(.76,24,16),skin);body.scale.set(1.2,.88,1.38);body.position.y=.88;body.castShadow=true;group.add(body);
  const belly=new THREE.Mesh(new THREE.SphereGeometry(.62,20,14),shell);belly.scale.set(1.02,.48,1.05);belly.position.set(0,.72,-.48);belly.castShadow=true;group.add(belly);
  const shellTop=new THREE.Mesh(new THREE.SphereGeometry(.5,20,12),shell.clone());shellTop.scale.set(1.55,.52,1.72);shellTop.position.set(0,1.18,.16);shellTop.castShadow=true;group.add(shellTop);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.5,22,14),skin.clone());head.scale.set(1.02,.95,1.08);head.position.set(0,1.83,-.17);head.castShadow=true;group.add(head);
  const snout=new THREE.Mesh(new THREE.CapsuleGeometry(.22,.38,6,14),shell.clone());snout.rotation.x=Math.PI/2;snout.scale.set(1,.62,1);snout.position.set(0,1.72,-.6);snout.castShadow=true;group.add(snout);
  const jaw=new THREE.Mesh(new THREE.CapsuleGeometry(.12,.28,5,10),skinDark);jaw.rotation.x=Math.PI/2;jaw.scale.set(1.15,.42,1);jaw.position.set(0,1.57,-.59);group.add(jaw);
  const crest=[];for(let i=0;i<5;i++){const fin=new THREE.Mesh(new THREE.ConeGeometry(.11,.34-i*.025,5),shellDark.clone());fin.rotation.x=Math.PI;fin.position.set((i-2)*.16,2.24,-.02+Math.abs(i-2)*.035);fin.castShadow=true;group.add(fin);crest.push(fin);}
  const eyes=[],pupils=[];for(const x of[-.2,.2]){const e=new THREE.Mesh(new THREE.SphereGeometry(.145,16,10),eye.clone());e.position.set(x,1.94,-.52);group.add(e);eyes.push(e);const p=new THREE.Mesh(new THREE.SphereGeometry(.065,10,7),pupil.clone());p.position.set(x,1.94,-.65);group.add(p);pupils.push(p);}
  const arms=[],legs=[],feet=[];for(const x of[-1,1]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.09,.42,5,10),shell.clone());arm.position.set(x*.73,1.02,-.02);arm.rotation.z=x<0?-.18:.18;arm.castShadow=true;group.add(arm);arms.push(arm);}
  for(const x of[-1,1])for(const z of[-1,1]){const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.11,.36,5,10),shell.clone());leg.position.set(x*.55,.43,z*.67);leg.rotation.z=x<0?-.1:.1;leg.castShadow=true;group.add(leg);legs.push(leg);const foot=new THREE.Mesh(new THREE.SphereGeometry(.18,12,8),skin.clone());foot.scale.set(1,.48,1.35);foot.position.set(x*.55,.17,z*.82);foot.castShadow=true;group.add(foot);feet.push(foot);}
  for(const x of[-1,1])for(const z of[-1,1])for(let t=-1;t<=1;t+=2){const toe=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),skinDark.clone());toe.position.set(x*.55+t*.07,.13,z*.93);group.add(toe);}
  const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,.72,.75),new THREE.Vector3(.22,.58,1.18),new THREE.Vector3(.48,.46,1.52),new THREE.Vector3(.22,.34,1.82),new THREE.Vector3(-.3,.29,1.7),new THREE.Vector3(-.52,.34,1.48)]);
  const tail=new THREE.Mesh(new THREE.TubeGeometry(curve,28,.105,9,false),skin.clone());tail.castShadow=true;group.add(tail);
  const tailTip=new THREE.Mesh(new THREE.SphereGeometry(.14,12,8),skinDark.clone());tailTip.position.set(-.52,.34,1.48);tailTip.castShadow=true;group.add(tailTip);
  const band=new THREE.Mesh(new THREE.TorusGeometry(.98,.035,8,40),new THREE.MeshBasicMaterial({color:player.role==="seeker"?"#FFD166":"#65E6BA",transparent:true,opacity:.9}));band.rotation.x=Math.PI/2;band.position.y=.16;group.add(band);
  const aura=new THREE.Mesh(new THREE.SphereGeometry(1.12,16,12),new THREE.MeshBasicMaterial({color:"#65E6BA",transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));aura.position.y=.9;group.add(aura);
  state.playerGroup.add(group);
  const entry={group,mats:[skin,head.material,tail.material,tailTip.material,body.material],accent:shell,shell,shellDark,band,aura,target:new THREE.Vector3(player.x||0,0,player.z||0),lastX:player.x||0,lastZ:player.z||0,body,head,tail,legs,arms,feet,eyes,pupils,crest};
  state.players.set(player.id,entry);return entry;
}
function paintTexture(color,pattern){
  const key=color+"|"+(pattern||"solid");
  if(state.paintTextureCache.has(key)) return state.paintTextureCache.get(key);
  const size=48, canvas=document.createElement("canvas"); canvas.width=canvas.height=size;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle=color; ctx.fillRect(0,0,size,size);
  if(pattern==="bands"){
    ctx.globalAlpha=.18; ctx.fillStyle="#ffffff";
    for(let y=0;y<size;y+=12) ctx.fillRect(0,y,size,4);
  }else if(pattern==="edge"){
    ctx.globalAlpha=.25; ctx.strokeStyle="#ffffff"; ctx.lineWidth=5; ctx.strokeRect(2.5,2.5,size-5,size-5);
  }else if(pattern==="dither"){
    ctx.globalAlpha=.16; ctx.fillStyle="#ffffff";
    for(let y=3;y<size;y+=8) for(let x=(y%16)/2;x<size;x+=8) ctx.fillRect(x,y,2,2);
  }
  ctx.globalAlpha=1;
  const tex=new THREE.CanvasTexture(canvas);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  state.paintTextureCache.set(key,tex);
  return tex;
}

function setPlayerStyle(entry, player) {
  const color=player.role==="seeker"?"#8E7CFF":(player.color||"#FFFFFF");
  entry.mats.forEach(mat=>{
    mat.color.set("#FFFFFF");
    if(player.role!=="seeker") mat.map=paintTexture(color,player.pattern||"solid");
    else mat.map=null;
    if(player.metallic!=null) mat.metalness=player.metallic;
    if(player.roughness!=null) mat.roughness=player.roughness;
    mat.needsUpdate=true;
  });
  entry.accent.color.set(player.role==="seeker"?"#CEC7FF":"#DDEBE6");
  entry.shellDark.color.set(player.role==="seeker"?"#9C92D8":"#879B92");
  entry.band.material.color.set(player.found?"#FF667D":player.role==="seeker"?"#FFD166":"#65E6BA");
  entry.aura.material.color.set(player.found?"#FF667D":player.role==="seeker"?"#FFD166":"#65E6BA");
  entry.aura.material.opacity=player.found?.14:(player.role==="seeker"?.035:.018);
  const pose=player.pose||"stand";
  const ground=["starfish","lieflat","ball"].includes(pose);
  entry.group.scale.set(1,ground?.82:(pose==="crouch"?.72:pose==="curl"?.56:pose==="freeze"?.48:1),ground?1.1:(pose==="prone"?1.15:1));
  entry.group.position.y=ground?.15:(pose==="sit"?-.32:pose==="wallflat"?.18:0);
  entry.group.rotation.x=ground?Math.PI/2:(pose==="backbend"?-.28:0);
  entry.group.rotation.z=pose==="curl"?.18:pose==="lean"?.24:pose==="slant"?-.18:0;
  entry.arms[0].rotation.set(0,0,-.16); entry.arms[1].rotation.set(0,0,.16);
  entry.legs.forEach((leg,i)=>{leg.rotation.set(0,0,i%2? .1:-.1);});
  const armZ={tpose:[-1.45,1.45],armsup:[-2.88,2.88],armsfwd:[-.16,-.16],legsout:[-.47,.47],star:[-2.18,2.18],starfish:[-2.18,2.18],ball:[-.2,-.2],sit:[-.08,-.08]};
  if(armZ[pose]){entry.arms[0].rotation.z=armZ[pose][0];entry.arms[1].rotation.z=armZ[pose][1];}
  if(pose==="armsfwd"){entry.arms.forEach(a=>a.rotation.x=-Math.PI/2);}
  if(["legsout","star","starfish"].includes(pose)){entry.legs[0].rotation.z=-.5;entry.legs[1].rotation.z=.5;}
  if(pose==="ball"){entry.legs[0].rotation.x=-2.3;entry.legs[1].rotation.x=-2.3;}
}

function animatePlayer(entry,player,time){
  const dx=(player.x??entry.lastX)-entry.lastX, dz=(player.z??entry.lastZ)-entry.lastZ;
  const moving=Math.hypot(dx,dz)>0.003&&!player.found&&!["freeze","wallflat","starfish","lieflat","ball"].includes(player.pose);
  entry.lastX=player.x??entry.lastX; entry.lastZ=player.z??entry.lastZ;
  const rate=player.role==="seeker"?8:7;
  const wave=Math.sin(time*.001*rate);
  const bob=moving?Math.abs(wave)*.045:Math.sin(time*.001*2.5)*.012;
  entry.body.position.y=.82+bob;
  entry.head.position.y=1.74+bob*.65;
  entry.tail.rotation.y=moving?wave*.22:wave*.04;
  entry.head.rotation.z=moving?wave*.025:Math.sin(time*.0017)*.008;
  entry.legs.forEach((leg,i)=>{if(i<4&&!["starfish","lieflat","ball"].includes(player.pose))leg.rotation.x=moving?((i%2?-1:1)*wave*.34):0;});
  entry.feet.forEach((foot,i)=>{if(moving)foot.rotation.z=(i%2?-1:1)*wave*.08;});
  entry.eyes.forEach((e,i)=>{e.material.emissiveIntensity=.24+.08*Math.sin(time*.004+i);});
}

function updatePlayers(room) {
  const entities=[...room.players,...(room.clones||[])];
  const liveIds = new Set(entities.map(p => p.id));

  for (const player of entities) {
    let entry = state.players.get(player.id);
    if (!entry) {
      makePlayerMesh(player);
      entry = state.players.get(player.id);
    }
    entry.player = player;

    const hasPosition = Number.isFinite(player.x) && Number.isFinite(player.z);
    entry.group.visible = hasPosition && (room.phase !== "lobby");
    if (hasPosition) {
      entry.target.set(player.x,0,player.z);
      entry.group.position.lerp(entry.target,0.42);
      entry.group.rotation.y = player.yaw || 0;
    }
    setPlayerStyle(entry, player);
    animatePlayer(entry,player,performance.now());

    const isSelf = player.id === state.selfId;
    const isHiderInSetup = room.phase === "setup" && player.role === "hider";
    const isClone=String(player.id).startsWith("clone:");
    entry.group.renderOrder = isSelf ? 3 : isClone ? 2 : isHiderInSetup ? 2 : 1;
    if(isClone) entry.group.scale.multiplyScalar(.94);
    entry.group.visible = entry.group.visible && !(isSelf && player.role === "seeker" && state.cameraMode === "first");
    entry.group.traverse(obj => {
      if (obj.material) obj.material.depthWrite = true;
    });
  }

  for (const [id, entry] of state.players) {
    if (!liveIds.has(id)) {
      state.playerGroup.remove(entry.group);
      state.players.delete(id);
    }
  }
}

function updateRoom(room) {
  const previousPhase = state.room?.phase;
  state.room = room;

  const self = room.players.find(p => p.id === state.selfId);
  if (!self) return;

  $("roomCode").textContent = room.code;
  $("roundLabel").textContent = "Round " + room.round;
  $("rolePill").textContent = self.role.toUpperCase();
  $("rolePill").style.background = self.role === "seeker" ? "#FFD166" : "#65E6BA";
  $("phaseLabel").textContent =
    room.phase === "setup" ? (self.role === "seeker" ? "LOCKED SETUP" : "PAINT & HIDE")
    : room.phase === "search" ? "SEARCH"
    : room.phase === "results" ? "RESULTS"
    : "LOBBY";
  $("score").textContent = self.score;
  $("timer").textContent = formatMs(room.leftMs);
  const coach=room.aiCoach;
  if(coach){
    $("aiTitle").textContent=coach.title||"AI DIRECTOR";
    $("aiHint").textContent=coach.hint||"Adaptive coaching online.";
    $("aiConfidence").textContent=Math.round((coach.confidence??0)*100)+"%";
    const icons={hide:"◆",paint:"✦",danger:"!",move:"➜",scan:"◎",hunt:"⌁",clear:"✓",ready:"◆"};
    $("aiIcon").textContent=icons[coach.mode]||"◆";
    $("aiPanel").dataset.mode=coach.mode||"ready";
  }
  $("playerList").innerHTML = room.players.map(player =>
    '<div class="player-row"><div class="meta"><i class="status-dot' + (player.connected ? "" : " off") + '"></i><b>' +
    escapeHtml(player.name) + '</b></div><span class="role-mark">' +
    player.role.toUpperCase() + " · " + player.score + "</span></div>"
  ).join("");

  const host = room.hostId === state.selfId;
  $("startBtn").hidden = !(room.phase === "lobby" && host);
  $("startBtn").disabled = room.players.filter(p => p.connected).length < 2;

  if (room.phase === "setup" && self.role === "hider" && previousPhase !== "setup") state.paintModeOpen = true;
  if (room.phase !== "setup") state.paintModeOpen = false;
  $("camoPanel").hidden = !(room.phase === "setup" && self.role === "hider" && state.paintModeOpen);
  $("seekerPanel").hidden = !(room.phase === "search" && self.role === "seeker");
  $("crosshair").hidden = !(room.phase === "search" && self.role === "seeker");
  if($("cloneCreate")) $("cloneCreate").disabled=!(room.phase==="setup"&&self.role==="hider");
  if($("cloneDelete")) $("cloneDelete").disabled=!(room.phase==="setup"&&self.role==="hider");
  if($("metallicSlider")){
    $("metallicSlider").value=Math.round((self.metallic??.03)*100);
    $("metallicValue").textContent=Math.round((self.metallic??.03)*100)+"%";
  }
  if($("roughnessSlider")){
    $("roughnessSlider").value=Math.round((self.roughness??.86)*100);
    $("roughnessValue").textContent=Math.round((self.roughness??.86)*100)+"%";
  }

  if (room.phase === "setup" && self.role === "hider") {
    $("centerPrompt").textContent = "Click a colorful surface to paint · 1/2/3 pose · explore and hide";
    const score = self.blendScore || 0;
    $("camoScore").textContent = score + "%";
    $("camoFill").style.width = score + "%";
    const best = findSurface(room, self.x, self.z);
    $("camoSurface").textContent = best?.name || "Open ground";
    $("paintCoverageValue").textContent = Math.round((self.paintCoverage||0)*100)+"%";
    $("inkFill").style.width = Math.round((self.paintCoverage||0)*100)+"%";
    state.stamina = Number.isFinite(self.stamina) ? self.stamina : 100;
    $("staminaValue").textContent = Math.round(state.stamina) + "%";
    $("staminaFill").style.width = Math.round(state.stamina) + "%";
    buildPalette(self.color);
  } else if (room.phase === "setup") {
    $("centerPrompt").textContent = "Hiders are setting up. Stay in the gate until the timer reaches zero.";
  } else if (room.phase === "search" && self.role === "seeker") {
    $("centerPrompt").textContent = "Move, listen for footsteps, and click a creature to attempt a spot.";
  } else if (room.phase === "search") {
    $("centerPrompt").textContent = "Stay blended. Keep moving only when it helps.";
  } else if (room.phase === "results") {
    $("centerPrompt").textContent = host ? "Round complete — Play Again starts a fresh round." : "Round complete — waiting for the host to rematch.";
  } else {
    $("centerPrompt").textContent = host ? "Start the round when everyone is ready." : "Waiting for the host to start.";
  }
  if (room.phase !== "setup") {
    $("paintCoverageValue").textContent = "—";
    if($("inkFill"))$("inkFill").style.width = "100%";
  }

  if (room.round !== state.lastRound) {
    state.lastRound = room.round;
    if (state.scene) loadMapForRound(room.round);
    $("results").hidden = true;
  }

  if (previousPhase !== room.phase) {
    if (room.phase === "results") {
      showResults(room, self);
      playResultSound(room);
    }
    if (room.phase === "setup" && previousPhase === "results") {
      $("results").hidden = true;
      toast("New round — roles rotated.");
    }
    state.lastPhase = room.phase;
  }

  updatePlayers(room);
}

function findSurface(room, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const surface of SURFACES) {
    const dx = Math.max(Math.abs(x - surface.x) - surface.w * 0.5, 0);
    const dz = Math.max(Math.abs(z - surface.z) - surface.d * 0.5, 0);
    const d = Math.hypot(dx, dz);
    if (d < bestDistance) {
      bestDistance = d;
      best = surface;
    }
  }
  return best;
}

function buildPalette(selectedColor) {
  const palette = $("palette");
  if (palette.childElementCount === COLORS.length) {
    for (const button of palette.children) button.classList.toggle("selected", button.dataset.color === selectedColor);
    return;
  }
  palette.innerHTML = "";
  COLORS.forEach(color => {
    const button = document.createElement("button");
    button.className = "swatch";
    button.dataset.color = color;
    button.style.background = color;
    button.title = "Paint " + color;
    button.addEventListener("click", () => {
      state.selectedColor=color;
      const self=currentSelf();
      if(self) send({type:"customize",color,pose:self.pose||"stand",brushSize:state.brushSize,surfaceId:"palette"});
      buildPalette(color);
    });
    palette.appendChild(button);
  });
  for (const button of palette.children) button.classList.toggle("selected", button.dataset.color === selectedColor);
}

function currentSelf() {
  return state.room?.players.find(p => p.id === state.selfId);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[char]));
}

function formatMs(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  return min + ":" + sec;
}

function resize() {
  if (!state.camera || !state.renderer) return;
  state.camera.aspect = innerWidth / innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(innerWidth, innerHeight);
}

function getKeyboardAxes() {
  const forward = (key("KeyS") || key("ArrowDown") ? 1 : 0) - (key("KeyW") || key("ArrowUp") ? 1 : 0);
  const strafe = (key("KeyD") || key("ArrowRight") ? 1 : 0) - (key("KeyA") || key("ArrowLeft") ? 1 : 0);
  return { forward, strafe };
}

function key(code) {
  return keys[code] ? 1 : 0;
}

const keys = Object.create(null);
window.addEventListener("keydown", event => {
  keys[event.code] = true;

  if (event.code === "Digit1") choosePose("stand");
  if (event.code === "Digit2") choosePose("crouch");
  if (event.code === "Digit3") choosePose("curl");
  if (event.code === "Digit4") choosePose("freeze");
  if (event.code === "KeyR") cyclePose();
  if (event.code === "Space") {
    initAudio();
    if(currentSelf()?.role==="hider" && state.room?.phase==="setup") sampleCenterSurface();
    else state.hopUntil=performance.now()+280;
  }
  if (event.code === "ControlLeft" || event.code === "ControlRight") choosePose("crouch");
  if (event.code === "KeyE") useAbility();
  if (event.code === "KeyQ") sendTaunt();
  if (event.code === "KeyV") {
    state.cameraMode=state.cameraMode==="first"?"third":"first";
    toast("Camera: "+state.cameraMode.toUpperCase());
  }
  if (event.code === "KeyF" && currentSelf()?.role==="hider" && state.room?.phase==="setup") { state.paintModeOpen=!state.paintModeOpen; $("camoPanel").hidden=!state.paintModeOpen; toast(state.paintModeOpen?"Paint mode ON":"Paint mode OFF"); }
});
window.addEventListener("keyup", event => { keys[event.code] = false; });

// Give clear feedback instead of making disconnected buttons appear dead.
function guardConnection() {
  if (state.socket?.readyState === WebSocket.OPEN) return true;
  toast("Connecting to game server…", 1800);
  connect();
  return false;
}
$("privateBtn").addEventListener("click", () => { if (guardConnection()) createRoom(false); });
$("publicBtn").addEventListener("click", () => { if (guardConnection()) createRoom(true); });
$("joinBtn").addEventListener("click", () => { if (guardConnection()) joinRoom(); });
$("code").addEventListener("keydown", event => {
  if (event.key === "Enter") joinRoom();
});
$("startBtn").addEventListener("click", () => {
  initAudio();
  if ($("startBtn").disabled) return;
  send({ type: "start" });
});
$("scanBtn")?.addEventListener("click", useAbility);
$("tauntBtn")?.addEventListener("click", sendTaunt);
$("brushTool")?.addEventListener("click",()=>{state.brushMode="brush";$("brushTool").classList.add("active");$("dropperTool").classList.remove("active")});
$("dropperTool")?.addEventListener("click",()=>{state.brushMode="dropper";$("dropperTool").classList.add("active");$("brushTool").classList.remove("active")});
document.querySelectorAll(".size-btn").forEach(button=>button.addEventListener("click",()=>{
  state.brushSize=Math.max(1,Math.min(5,Number(button.dataset.size)||1));
  document.querySelectorAll(".size-btn").forEach(b=>b.classList.toggle("active",b===button));
  toast("Brush size "+state.brushSize);
}));
document.querySelectorAll(".poses button").forEach(button=>button.addEventListener("click",()=>choosePose(button.dataset.pose)));
$("customColor")?.addEventListener("input",e=>{
  state.selectedColor=e.target.value.toUpperCase();
  buildPalette(state.selectedColor);
  const self=currentSelf();
  if(self&&state.room?.phase==="setup") send({type:"customize",color:state.selectedColor,pose:self.pose,brushSize:state.brushSize,metallic:self.metallic??.03,roughness:self.roughness??.86,pattern:self.pattern||"solid",surfaceId:"palette"});
});


$("leaveBtn").addEventListener("click", () => {
  if (state.room) send({ type: "leave" });
  else leaveToLobby(false);
});
$("resultClose").addEventListener("click", () => { leaveToLobby(false); });
$("playAgain")?.addEventListener("click", () => {
  const self=currentSelf();
  if (self?.id===state.room?.hostId) send({type:"rematch"});
  else toast("Only the host can start the next round.");
});

$("assetBtn")?.addEventListener("click",()=>{
  const index=Math.max(0,MAPS.findIndex(m=>m.id===state.assetKey));
  const next=MAPS[(index+1)%MAPS.length];
  state.assetKey=next.id;
  ensureScene();
  loadMapForRound({mapId:next.id});
  toast("Loading "+next.label+"…",1600);
});
$("metallicSlider")?.addEventListener("input",e=>{const v=Number(e.target.value)/100;$("metallicValue").textContent=Math.round(v*100)+"%";const s=currentSelf();if(s&&state.room?.phase==="setup")send({type:"customize",color:s.color,pose:s.pose,brushSize:state.brushSize,metallic:v,roughness:s.roughness??.86,pattern:s.pattern||"solid",surfaceId:"material"});});
$("roughnessSlider")?.addEventListener("input",e=>{const v=Number(e.target.value)/100;$("roughnessValue").textContent=Math.round(v*100)+"%";const s=currentSelf();if(s&&state.room?.phase==="setup")send({type:"customize",color:s.color,pose:s.pose,brushSize:state.brushSize,metallic:s.metallic??.03,roughness:v,pattern:s.pattern||"solid",surfaceId:"material"});});
document.querySelectorAll(".pattern-btn").forEach(btn=>btn.addEventListener("click",()=>{state.pattern=btn.dataset.pattern;document.querySelectorAll(".pattern-btn").forEach(b=>b.classList.toggle("active",b===btn));const s=currentSelf();if(s&&state.room?.phase==="setup")send({type:"customize",color:s.color,pose:s.pose,brushSize:state.brushSize,metallic:s.metallic??.03,roughness:s.roughness??.86,pattern:state.pattern,surfaceId:"pattern"});}));
$("cloneCreate")?.addEventListener("click",()=>send({type:"clone_create"}));
$("cloneDelete")?.addEventListener("click",()=>send({type:"clone_delete"}));
$("localMap")?.addEventListener("change",e=>loadLocalMap(e.target.files?.[0]));
$("name").value = localStorage.getItem(NAME_KEY) || "";
$("name").addEventListener("input", () => localStorage.setItem(NAME_KEY, $("name").value));

function createRoom(isPublic) {
  initAudio();
  const name = $("name").value.trim() || "Player";
  localStorage.setItem(NAME_KEY, name);
  if (!send({ type: "create", public: isPublic, name })) toast("Waiting for connection…");
}

function joinRoom() {
  initAudio();
  const code = $("code").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) {
    toast("Enter a room code.");
    return;
  }
  const name = $("name").value.trim() || "Player";
  localStorage.setItem(NAME_KEY, name);
  if (!send({ type: "join", code, name })) toast("Waiting for connection…");
}

function leaveToLobby(showToast = true) {
  state.room = null;
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    // socket stays connected so a new room can be joined immediately.
  }
  $("game").hidden = true;
  $("lobby").hidden = false;
  $("results").hidden = true;
  $("eventFeed").innerHTML = "";
  if (showToast) toast("Left the room.");
  send({ type: "rooms" });
}

function choosePose(pose) {
  const self = currentSelf();
  if (!self || self.role !== "hider" || state.room.phase !== "setup") return;
  send({ type: "customize", pose, color: self.color, surfaceId: "pose" });
  playPoseSound();
}

function sampleAtPointer(event) {
  if (!state.room) return;
  const self = currentSelf();
  if (!self || self.role !== "hider" || state.room.phase !== "setup") return;

  const rect = $("scene").getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, state.camera);
  const hit = ray.intersectObjects(state.sampleMeshes, true).find(x => x.object.userData.sampleColor);
  if (!hit) return;

  const color = hit.object.userData.sampleColor || "#FFFFFF";
  const surfaceId = hit.object.userData.surfaceId || "painted";
  if (state.brushMode === "dropper") {
    state.selectedColor = color;
    buildPalette(color);
    $("camoSurface").textContent = hit.object.userData.surfaceName || "Surface";
    toast("Eye Drop: "+(hit.object.userData.surfaceName || "Surface"));
    playSampleSound();
    return;
  }
  send({ type: "customize", color: state.selectedColor || color, pose: self.pose, brushSize: state.brushSize, metallic:self.metallic??.03, roughness:self.roughness??.86, pattern:self.pattern||"solid", surfaceId });
  spawnSampleEffect(hit.point,state.selectedColor||color);
}

function sampleCenterSurface(){
  const self=currentSelf(); if(!self||self.role!=="hider"||state.room?.phase!=="setup") return;
  const ray=new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0,0),state.camera);
  const hit=ray.intersectObjects(state.sampleMeshes,true).find(x=>x.object.userData?.sampleColor);
  if(hit){
    const color=hit.object.userData.sampleColor||"#FFFFFF";
    state.selectedColor=color; buildPalette(color);
    $("camoSurface").textContent=hit.object.userData.surfaceName||"Surface";
    playSampleSound(); toast("3D Eye Dropper: "+(hit.object.userData.surfaceName||"Surface"));
  }
}

function spotAtPointer(event) {
  if (!state.room || state.room.phase !== "search") return;
  const self = currentSelf();
  if (!self || self.role !== "seeker") return;

  const rect = $("scene").getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  let candidate = null;
  let nearest = 0.13;
  const targets=[...state.room.players,...(state.room.clones||[])];
  for (const player of targets) {
    if (player.role !== "hider" || player.found || !Number.isFinite(player.x)) continue;
    const projected = new THREE.Vector3(player.x, 1.1, player.z).project(state.camera);
    const distance = Math.hypot(projected.x - pointer.x, projected.y - pointer.y);
    if (distance < nearest) {
      nearest = distance;
      candidate = player;
    }
  }
  if (candidate) {
    initAudio();
    send({ type: "spot", targetId: candidate.id });
  }
}

$("scene").addEventListener("pointerdown",event=>{
  if(event.button===2){
    if(currentSelf()?.role==="hider" && state.room?.phase==="setup"){state.adjustBrush=true;initAudio();return;}
    state.mouseLook=true;initAudio();return;
  }
  if(event.button===1 && currentSelf()?.role==="hider" && state.room?.phase==="setup"){state.brushMode="dropper";$("dropperTool")?.classList.add("active");$("brushTool")?.classList.remove("active");sampleAtPointer(event);event.preventDefault();return;}
  if(event.button===0 && currentSelf()?.role==="seeker" && state.room?.phase==="search"){
    try{$("scene").requestPointerLock();}catch{}
  }
  if(event.button===0 && currentSelf()?.role==="hider" && state.room?.phase==="setup"){
    state.painting=true;
  }
  initAudio();
  if (state.room?.phase === "setup" && currentSelf()?.role === "hider") sampleAtPointer(event);
  if (state.room?.phase === "search" && currentSelf()?.role === "seeker") spotAtPointer(event);
});

window.addEventListener("pointerup",event=>{
  if(event.button===0) state.painting=false;
  if(event.button===2){state.adjustBrush=false;state.mouseLook=false;}
});
$("scene").addEventListener("wheel",event=>{
  if(currentSelf()?.role==="hider" && state.room?.phase==="setup"){
    state.brushSize=Math.max(1,Math.min(5,state.brushSize+(event.deltaY>0?-1:1)));
    document.querySelectorAll(".size-btn").forEach(b=>b.classList.toggle("active",Number(b.dataset.size)===state.brushSize));
    toast("Brush size: "+state.brushSize);
    event.preventDefault();
  }
},{passive:false});
window.addEventListener("contextmenu", event => {
  if (event.target === $("scene")) event.preventDefault();
});
window.addEventListener("pointermove",event=>{
  if(!currentSelf()) return;
  if(state.adjustBrush && state.room?.phase==="setup"){
    if(Math.abs(event.movementX)>2){
      state.brushSize=Math.max(1,Math.min(5,state.brushSize+(event.movementX>0?1:-1)));
      document.querySelectorAll(".size-btn").forEach(b=>b.classList.toggle("active",Number(b.dataset.size)===state.brushSize));
    }
    return;
  }
  if(state.pointerLocked||state.mouseLook){
    state.input.yaw+=event.movementX*0.0045;
    state.pitch=Math.max(-1.1,Math.min(0.55,state.pitch-event.movementY*0.0032));
  }
  if(state.painting && currentSelf()?.role==="hider" && state.room?.phase==="setup" && state.brushMode==="brush" && performance.now()-state.lastPaintAt>120){
    state.lastPaintAt=performance.now();
    sampleAtPointer(event);
  }
});
document.addEventListener("pointerlockchange",()=>{
  state.pointerLocked=document.pointerLockElement===$("scene");
});


function pollGamepad() {
  const pads = navigator.getGamepads?.() || [];
  const pad = [...pads].find(Boolean);
  if (!pad) return null;
  const x = Math.abs(pad.axes?.[0] || 0) > 0.14 ? pad.axes[0] : 0;
  const y = Math.abs(pad.axes?.[1] || 0) > 0.14 ? pad.axes[1] : 0;
  if (state.room?.phase === "search" && currentSelf()?.role === "seeker" && pad.buttons?.[0]?.pressed) {
    const nowTime = performance.now();
    if (nowTime - state.lastInputAt > 520) {
      state.lastInputAt = nowTime;
      const candidates = state.room.players.filter(p => p.role === "hider" && !p.found && Number.isFinite(p.x));
      candidates.sort((a,b) => Math.hypot(a.x - (currentSelf()?.x || 0), a.z - (currentSelf()?.z || 0)) - Math.hypot(b.x - (currentSelf()?.x || 0), b.z - (currentSelf()?.z || 0)));
      if (candidates[0]) send({ type: "spot", targetId: candidates[0].id });
    }
  }
  if (state.room?.phase === "setup" && currentSelf()?.role === "hider") {
    if (pad.buttons?.[2]?.pressed) choosePose("crouch");
    if (pad.buttons?.[3]?.pressed) choosePose("curl");
  }
  return { forward: -y, strafe: x };
}

function updateInput(nowTime) {
  const self = currentSelf();
  if (!self || !state.room || (state.room.phase !== "setup" && state.room.phase !== "search")) return;

  const keysInput = getKeyboardAxes();
  const pad = pollGamepad();
  const sprintKey = key("ShiftLeft") || key("ShiftRight");
  const movingInput = Math.hypot(keysInput.forward, keysInput.strafe) > 0.05;
  if (sprintKey && movingInput && state.stamina > 0) state.stamina = Math.max(0, state.stamina - 28 * (1/60));
  else state.stamina = Math.min(100, state.stamina + 18 * (1/60));
  if (Number.isFinite(self.stamina)) state.stamina += (self.stamina - state.stamina) * .08;
  $("staminaValue").textContent = Math.round(state.stamina) + "%";
  $("staminaFill").style.width = Math.round(state.stamina) + "%";
  let forward = keysInput.forward;
  let strafe = keysInput.strafe;
  if (pad && (Math.abs(pad.forward) + Math.abs(pad.strafe) > 0.08)) {
    forward = pad.forward;
    strafe = pad.strafe;
  }

  let x = 0;
  let z = 0;
  const length = Math.hypot(forward, strafe);
  if (length > 0.05 && !(state.room.phase === "setup" && self.role === "seeker")) {
    forward /= length;
    strafe /= length;
    x = Math.cos(state.input.yaw) * strafe + Math.sin(state.input.yaw) * forward;
    z = -Math.sin(state.input.yaw) * strafe + Math.cos(state.input.yaw) * forward;
    if (!state.mouseLook) {
      state.input.yaw = Math.atan2(x, z);
    }
  }

  state.input.x = x;
  state.input.z = z;

  if (nowTime - state.lastSentInput.t > 60 ||
      x !== state.lastSentInput.x || z !== state.lastSentInput.z ||
      Math.abs(state.input.yaw - state.lastSentInput.yaw) > 0.03) {
    send({ type: "input", x, z, yaw: state.input.yaw, sprint: !!sprintKey && state.stamina > 0 });
    state.lastSentInput = { x, z, yaw: state.input.yaw, t: nowTime };
  }
}

function updateCamera(dt) {
  const self=currentSelf();
  if(!self||!state.camera) return;
  const yaw=self.yaw??state.input.yaw;
  const hop=performance.now()<state.hopUntil?Math.sin((performance.now()-(state.hopUntil-280))/280*Math.PI)*.2:0;
  const smoothing=1-Math.pow(0.001,dt);
  if(self.role==="seeker" && state.cameraMode==="first"){
    const cosPitch=Math.cos(state.pitch), sinPitch=Math.sin(state.pitch);
    const lookX=Math.sin(yaw)*cosPitch, lookY=sinPitch, lookZ=Math.cos(yaw)*cosPitch;
    const desired=new THREE.Vector3(self.x,1.58+hop*.4,self.z);
    state.camera.position.lerp(desired,smoothing);
    state.camera.lookAt(self.x+lookX*8,1.58+lookY*8,self.z+lookZ*8);
    return;
  }
  const distance=self.role==="seeker"?6.2:7.4;
  const desired=new THREE.Vector3(self.x+Math.sin(yaw)*distance,4.8+hop,self.z+Math.cos(yaw)*distance);
  state.camera.position.lerp(desired,smoothing);
  state.camera.lookAt(self.x,1.0,self.z);
}

function spawnSampleEffect(point, color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.24, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(point.x, point.y + 0.04, point.z);
  state.effectGroup.add(ring);
  state.effects.push({ mesh: ring, start: performance.now(), ttl: 800, mode: "sample" });
}

function spawnSpotEffect(x, z, success) {
  const color = success ? "#FFD166" : "#FF667D";
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.62, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.08, z);
  state.effectGroup.add(ring);
  state.effects.push({ mesh: ring, start: performance.now(), ttl: 900, mode: "spot" });
}

function spawnNoiseEffect(x, z, strength) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.3, 24),
    new THREE.MeshBasicMaterial({ color: "#FFD166", transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.07, z);
  state.effectGroup.add(ring);
  state.effects.push({ mesh: ring, start: performance.now(), ttl: 700, mode: "noise", strength });
}

function spawnScanEffect(x=0,z=0){
  const ring=new THREE.Mesh(new THREE.RingGeometry(.24,.38,32),new THREE.MeshBasicMaterial({color:"#6EDCFF",transparent:true,opacity:.8,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.set(x,.08,z);state.effectGroup.add(ring);state.effects.push({mesh:ring,start:performance.now(),ttl:1100});
}
function updateEffects(time) {
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const e = state.effects[i];
    const t = (time - e.start) / e.ttl;
    if (t >= 1) {
      state.effectGroup.remove(e.mesh);
      state.effects.splice(i, 1);
      continue;
    }
    const s = e.mode === "noise" ? 1 + t * (2 + (e.strength || 0.3)) : 1 + t * 2.2;
    e.mesh.scale.setScalar(s);
    e.mesh.material.opacity = (1 - t) * (e.mode === "spot" ? 0.9 : 0.55);
  }
}

function showResults(room, self) {
  $("results").hidden = false;
  const hidersWon = room.winnerRole === "hiders";
  $("resultTitle").textContent = hidersWon ? "HIDERS SURVIVED" : "SEEKERS FOUND THEM ALL";
  $("resultReason").textContent = room.reason || "";
  $("resultRows").innerHTML = room.roundStats.map(stat =>
    '<div class="result-row"><span>' + escapeHtml(stat.name) + ' <small>' + stat.role.toUpperCase() +
    '</small></span><span>' + escapeHtml(stat.detail) + '</span><b>+' + stat.delta + '</b></div>'
  ).join("");
}

function playResultSound(room) {
  initAudio();
  if (!state.audio) return;
  const won = room.winnerRole === (currentSelf()?.role === "hider" ? "hiders" : "seekers");
  const sequence = won ? [523, 659, 784] : [392, 330, 262];
  sequence.forEach((freq, i) => {
    const time = state.audio.ctx.currentTime + i * 0.12;
    const osc = state.audio.ctx.createOscillator();
    const gain = state.audio.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.08, time + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
    osc.connect(gain).connect(state.audio.master);
    osc.start(time);
    osc.stop(time + 0.13);
  });
}

function initAudio() {
  if (state.audio) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  state.audio = { ctx, master };
}

function tone(freq, duration = 0.07, type = "sine", volume = 0.06) {
  if (!state.audio) return;
  const t = state.audio.ctx.currentTime;
  const osc = state.audio.ctx.createOscillator();
  const gain = state.audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(state.audio.master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function playSampleSound() { tone(880, 0.12, "triangle", 0.08); setTimeout(() => tone(1175, 0.1, "triangle", 0.06), 55); }
function playSpotSound() { tone(180, 0.16, "sawtooth", 0.055); setTimeout(() => tone(620, 0.12, "triangle", 0.07), 35); }
function playMissSound() { tone(140, 0.09, "square", 0.035); }
function playPoseSound() { tone(340, 0.04, "square", 0.02); }
function playFootstep(strength) { tone(80 + 35 * strength, 0.055, "square", 0.015 + strength * 0.015); }

function useAbility() {
  const self=currentSelf();
  if(!self) return;
  if(self.role==="seeker" && state.room?.phase==="search"){
    if(performance.now()<state.scanCooldownUntil){toast("Scanner cooling down.");return}
    state.scanCooldownUntil=performance.now()+6500;
    send({type:"ability",ability:"scan"});
  } else if(self.role==="hider" && state.room?.phase==="setup"){
    send({type:"customize",color:self.color,pose:"freeze",brushSize:state.brushSize,surfaceId:"freeze"});
  }
}
function sendTaunt(){if(currentSelf())send({type:"ability",ability:"taunt"})}

function updateMinimap(room,self){
  const canvas=$("minimap"); if(!canvas) return;
  const ctx=canvas.getContext("2d"); if(!ctx) return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle="#07101a"; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle="#ffffff20"; ctx.strokeRect(1,1,canvas.width-2,canvas.height-2);
  const sx=canvas.width/40, sz=canvas.height/30;
  for(const p of room.players){
    if(!Number.isFinite(p.x)||!Number.isFinite(p.z)) continue;
    if(p.id!==self.id && self.role==="seeker" && p.role==="hider" && !p.found) continue;
    const x=(p.x+20)*sx, y=(p.z+15)*sz;
    ctx.beginPath(); ctx.arc(x,y,p.id===self.id?4:3,0,Math.PI*2);
    ctx.fillStyle=p.id===self.id?"#ffffff":p.role==="seeker"?"#ffd166":(p.found?"#ff667d":"#65e6ba");
    ctx.fill();
  }
}

function frame(time) {
  requestAnimationFrame(frame);
  const dt=Math.min(0.05,(time-state.lastFrame)/1000);state.lastFrame=time;
  state.frameSamples.push(dt);if(state.frameSamples.length>45)state.frameSamples.shift();
  if(time-state.lastPerfHud>800){const avg=state.frameSamples.reduce((a,b)=>a+b,0)/Math.max(1,state.frameSamples.length);state.fps=Math.round(1/Math.max(.001,avg));state.lastPerfHud=time;if($("bootStatus")&&state.renderer)$("bootStatus").textContent="LIVE · "+state.fps+" FPS · "+state.renderer.info.render.calls+" draws";}

  if (state.room) {
    updateInput(time);
    updateCamera(dt);

    const second = Math.ceil((state.room.leftMs || 0) / 1000);
    if (second !== state.timerSecond) {
      state.timerSecond = second;
      $("timer").textContent = formatMs(state.room.leftMs);
      if (state.room.phase === "search" && second <= 10 && second > 0) tone(520, 0.04, "square", 0.02);
    }

    updateEffects(time);
    const self=currentSelf();
    if(self) updateMinimap(state.room,self);
  }

  for(const mixer of state.mixers)mixer.update(dt);
  if(state.ambientPoints){const pos=state.ambientPoints.geometry.attributes.position;for(let i=0;i<state.ambientVelocities.length;i++){let y=pos.getY(i)+state.ambientVelocities[i]*dt*.18;if(y>8)y=.3;pos.setY(i,y);}pos.needsUpdate=true;state.ambientPoints.rotation.y+=dt*.012;}
  if(state.renderer&&state.scene&&state.camera)state.renderer.render(state.scene,state.camera);
}

connect();
