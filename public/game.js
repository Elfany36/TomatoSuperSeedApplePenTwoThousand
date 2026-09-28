
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
  hopUntil: 0,
  scanCooldownUntil: 0,
  cameraMode: "third",
  pitch: -0.05,
  stamina: 100,
  lastRound: -1,
  pointerLocked: false
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

function connect() {
  if (state.socket && state.socket.readyState <= WebSocket.OPEN) return;
  setConnection("Connecting…");
  const ws = new WebSocket(apiSocketUrl());
  state.socket = ws;

  ws.addEventListener("open", () => {
    state.reconnectAttempt = 0;
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
      toast((target?.name || "A hider") + " was spotted!", 2800);
    }
    return;
  }

  if (message.type === "spot_miss") {
    playMissSound();
    toast("Miss — " + (message.reason === "wrong_direction" ? "turn toward the creature" : "too far / blocked"), 1100);
    return;
  }

  if (message.type === "scan_effect") { spawnScanEffect(message.x,message.z); return; }
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

  const hemi = new THREE.HemisphereLight("#F2FBFF", "#385545", 2.2);
  state.scene.add(hemi);
  const sun = new THREE.DirectionalLight("#FFF0CF", 3.4);
  sun.position.set(-14, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
  state.scene.add(sun);
  const fill = new THREE.DirectionalLight("#9CC6FF", .9);
  fill.position.set(18, 12, -10);
  state.scene.add(fill);

  state.worldGroup = new THREE.Group();
  state.assetGroup = new THREE.Group();
  state.playerGroup = new THREE.Group();
  state.effectGroup = new THREE.Group();
  state.scene.add(state.worldGroup, state.assetGroup, state.playerGroup, state.effectGroup);

  buildWorld();
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
  const clone=root.clone(true);
  clone.traverse(o=>{if(o.isMesh)importAssetSurface(o)});
  indexSampleMeshes(clone);
  const box=new THREE.Box3().setFromObject(clone);
  const size=box.getSize(new THREE.Vector3());
  const center=box.getCenter(new THREE.Vector3());
  const fit=Math.min(1.6,34/Math.max(1,size.x),25/Math.max(1,size.z));
  clone.scale.setScalar(fit);
  clone.position.set(-center.x*fit,-box.min.y*fit,-center.z*fit);
  state.assetGroup.add(clone);
  state.assetGroup.visible=true;
  state.worldGroup.visible=false;
  $("mapLabel").textContent=MAPS.find(m=>m.id===key)?.label||key;
  if($("assetBtn"))$("assetBtn").innerHTML=`MAP <b>${MAPS.find(m=>m.id===key)?.label||key}</b>`;
  toast(`${MAPS.find(m=>m.id===key)?.label||key} map ready`);
}

function loadMapForRound(round){
  const key=MAPS[Math.max(0,(round||1)-1)%MAPS.length];
  state.assetKey=key.id;
  state.scene.background.set(key.sky);
  state.scene.fog.color.set(key.sky);
  $("mapLabel").textContent=key.label;
  if(state.assetCache.has(key.id)){attachMap(state.assetCache.get(key.id),key.id);return}
  if($("assetBtn"))$("assetBtn").innerHTML=`MAP <b>LOADING…</b>`;
  new GLTFLoader().load(key.url,g=>{
    state.assetCache.set(key.id,g.scene);
    attachMap(g.scene,key.id);
  },undefined,()=>{
    state.assetGroup.visible=false;
    state.worldGroup.visible=true;
    indexSampleMeshes(state.worldGroup);
    toast(`${key.label} asset unavailable — using optimized fallback scene.`,3200);
    if($("assetBtn"))$("assetBtn").innerHTML='MAP <b>FALLBACK</b>';
  });
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
  const group = new THREE.Group();
  group.userData.playerId = player.id;
  const bodyMat = material(player.role === "seeker" ? "#8E7CFF" : player.color || "#FFFFFF", .66);
  const accent = material(player.role === "seeker" ? "#D9D1FF" : "#DDEBE6", .52);
  const dark = material("#1B2832", .38);

  const body = new THREE.Mesh(new THREE.SphereGeometry(.72, 22, 16), bodyMat);
  body.scale.set(1.18,.9,1.34); body.position.y=.82; body.castShadow=true; group.add(body);

  const shell = new THREE.Mesh(new THREE.SphereGeometry(.45,20,12),accent);
  shell.scale.set(1.42,.58,1.62); shell.position.set(0,1.12,.12); shell.castShadow=true; group.add(shell);

  const head = new THREE.Mesh(new THREE.SphereGeometry(.47,20,12),bodyMat.clone());
  head.position.set(0,1.74,-.14); head.castShadow=true; group.add(head);

  const snout = new THREE.Mesh(new THREE.CapsuleGeometry(.22,.32,5,12),accent.clone());
  snout.rotation.x=Math.PI/2; snout.scale.set(1,.62,1); snout.position.set(0,1.66,-.56); snout.castShadow=true; group.add(snout);

  const crest = new THREE.Mesh(new THREE.ConeGeometry(.2,.42,5),accent.clone());
  crest.rotation.x=Math.PI; crest.position.set(0,2.15,-.02); crest.castShadow=true; group.add(crest);

  for(const x of[-.19,.19]){
    const eye=new THREE.Mesh(new THREE.SphereGeometry(.14,14,10),material("#F5FFFF",.18)); eye.position.set(x,1.88,-.49); group.add(eye);
    const pupil=new THREE.Mesh(new THREE.SphereGeometry(.06,10,7),dark); pupil.position.set(x,1.88,-.6); group.add(pupil);
  }
  for(const x of[-.5,.5]) for(const z of[-.42,.42]){
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.1,.13,.44,8),accent.clone());
    leg.position.set(x*.7,.43,z*.82); leg.rotation.z=x<0?-.1:.1; leg.castShadow=true; group.add(leg);
    const foot=new THREE.Mesh(new THREE.SphereGeometry(.17,11,8),bodyMat.clone());
    foot.scale.set(1,.54,1.25); foot.position.set(x*.7,.18,z*.9); foot.castShadow=true; group.add(foot);
  }

  const curve=new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,.7,.75),new THREE.Vector3(.22,.56,1.16),
    new THREE.Vector3(.5,.45,1.5),new THREE.Vector3(.12,.34,1.82),
    new THREE.Vector3(-.34,.28,1.7)
  ]);
  const tail=new THREE.Mesh(new THREE.TubeGeometry(curve,24,.095,8,false),bodyMat.clone());
  tail.castShadow=true; group.add(tail);

  const band=new THREE.Mesh(new THREE.TorusGeometry(.92,.028,7,32),new THREE.MeshBasicMaterial({color:player.role==="seeker"?"#FFD166":"#65E6BA"}));
  band.rotation.x=Math.PI/2; band.position.y=.18; group.add(band);

  const legs = group.children.filter(o => o.geometry?.type === "CylinderGeometry");
  state.playerGroup.add(group);
  return {group,mats:[bodyMat,head.material,tail.material],accent,band,target:new THREE.Vector3(player.x||0,0,player.z||0),
    lastX:player.x||0,lastZ:player.z||0,body,head,tail,legs};
}

function setPlayerStyle(entry, player) {
  const color = player.role==="seeker" ? "#8E7CFF" : (player.color||"#FFFFFF");
  entry.mats.forEach(mat=>mat.color.set(color));
  entry.accent.color.set(player.role==="seeker" ? "#CEC7FF" : "#DDEBE6");
  entry.band.material.color.set(player.found ? "#FF667D" : player.role==="seeker" ? "#FFD166" : "#65E6BA");
  entry.group.scale.y=player.pose==="crouch"?.72:player.pose==="curl"?.56:player.pose==="freeze"?.48:1;
  entry.group.rotation.z=player.pose==="curl"?.16:0;
}

function animatePlayer(entry, player, time){
  const dx=(player.x??entry.lastX)-entry.lastX;
  const dz=(player.z??entry.lastZ)-entry.lastZ;
  const moving=Math.hypot(dx,dz)>0.003 && !player.found;
  entry.lastX=player.x??entry.lastX;
  entry.lastZ=player.z??entry.lastZ;
  const rate=moving?(player.role==='seeker' ? 8 : 7):2.5;
  const wave=Math.sin(time*0.001*rate);
  const bob=moving?Math.abs(wave)*0.045:Math.sin(time*0.001*2.5)*0.012;
  entry.body.position.y=0.82+bob;
  entry.head.position.y=1.74+bob*0.65;
  entry.tail.rotation.y=(moving?wave*0.18:wave*0.03);
  entry.legs.forEach((leg,i)=>{if(i<4) leg.rotation.x=moving?((i%2?-1:1)*wave*0.32):0;});
}

function updatePlayers(room) {
  const liveIds = new Set(room.players.map(p => p.id));

  for (const player of room.players) {
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
    entry.group.renderOrder = isSelf ? 3 : isHiderInSetup ? 2 : 1;
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
  $("playerList").innerHTML = room.players.map(player =>
    '<div class="player-row"><div class="meta"><i class="status-dot' + (player.connected ? "" : " off") + '"></i><b>' +
    escapeHtml(player.name) + '</b></div><span class="role-mark">' +
    player.role.toUpperCase() + " · " + player.score + "</span></div>"
  ).join("");

  const host = room.hostId === state.selfId;
  $("startBtn").hidden = !(room.phase === "lobby" && host);
  $("startBtn").disabled = room.players.filter(p => p.connected).length < 2;

  $("camoPanel").hidden = !(room.phase === "setup" && self.role === "hider");
  $("seekerPanel").hidden = !(room.phase === "search" && self.role === "seeker");
  $("crosshair").hidden = !(room.phase === "search" && self.role === "seeker");

  if (room.phase === "setup" && self.role === "hider") {
    $("centerPrompt").textContent = "Click a colorful surface to paint · 1/2/3 pose · explore and hide";
    const score = self.blendScore || 0;
    $("camoScore").textContent = score + "%";
    $("camoFill").style.width = score + "%";
    const best = findSurface(room, self.x, self.z);
    $("camoSurface").textContent = best?.name || "Open ground";
    $("paintCoverageValue").textContent = Math.round((self.paintCoverage||0)*100)+"%";
    $("inkFill").style.width = Math.round((self.paintCoverage||0)*100)+"%";
    $("staminaValue").textContent = "100%";
    $("staminaFill").style.width = "100%";
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
  if (event.code === "Space") { state.hopUntil=performance.now()+280; initAudio(); }
  if (event.code === "ControlLeft" || event.code === "ControlRight") choosePose("crouch");
  if (event.code === "KeyE") useAbility();
  if (event.code === "KeyQ") sendTaunt();
  if (event.code === "KeyV") {
    state.cameraMode=state.cameraMode==="first"?"third":"first";
    toast("Camera: "+state.cameraMode.toUpperCase());
  }
  if (event.code === "KeyR") { state.input.yaw = currentSelf()?.role==="seeker" ? Math.PI : state.input.yaw; toast("Camera recentered"); }
});
window.addEventListener("keyup", event => { keys[event.code] = false; });

$("privateBtn").addEventListener("click", () => createRoom(false));
$("publicBtn").addEventListener("click", () => createRoom(true));
$("joinBtn").addEventListener("click", joinRoom);
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
document.querySelectorAll(".size-btn").forEach(button=>button.addEventListener("click",()=>{state.brushSize=Number(button.dataset.size)||1;document.querySelectorAll(".size-btn").forEach(b=>b.classList.remove("active"));button.classList.add("active")}));

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

$("assetBtn")?.addEventListener("click",()=>toast("Map rotation is synchronized to the round."));
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
  send({ type: "customize", color: state.selectedColor || color, pose: self.pose, brushSize: state.brushSize, surfaceId });
  spawnSampleEffect(hit.point,state.selectedColor||color);
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
  for (const player of state.room.players) {
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
  if(event.button===2){state.mouseLook=true;initAudio();return;}
  if(event.button===0 && currentSelf()?.role==="seeker" && state.room?.phase==="search"){
    try{$("scene").requestPointerLock();}catch{}
  }
  initAudio();
  if (state.room?.phase === "setup" && currentSelf()?.role === "hider") sampleAtPointer(event);
  if (state.room?.phase === "search" && currentSelf()?.role === "seeker") spotAtPointer(event);
});

window.addEventListener("pointerup", event => {
  if (event.button === 2) state.mouseLook = false;
});
window.addEventListener("contextmenu", event => {
  if (event.target === $("scene")) event.preventDefault();
});
window.addEventListener("pointermove",event=>{
  if(!currentSelf()) return;
  if(state.pointerLocked||state.mouseLook){
    state.input.yaw+=event.movementX*0.0045;
    state.pitch=Math.max(-1.1,Math.min(0.55,state.pitch-event.movementY*0.0032));
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

function frame(time) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (time - state.lastFrame) / 1000);
  state.lastFrame = time;

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
  }

  if (state.renderer && state.scene && state.camera) state.renderer.render(state.scene, state.camera);
}

connect();
