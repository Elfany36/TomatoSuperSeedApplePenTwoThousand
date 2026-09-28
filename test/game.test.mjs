import assert from "node:assert/strict";
import { GameManager, GameRoom, CONFIG, sanitizeName, makeRoomCode } from "../server.mjs";

assert.equal(sanitizeName("<bad>!"), "bad");
const rooms = new Map();
const code = makeRoomCode(rooms);
assert.match(code, /^[A-Z0-9]{6}$/);

const room = new GameRoom("TEST01", true);
const gm = new GameManager({ SETUP_MS: 30, SEARCH_MS: 50, RESULTS_MS: 30, RECONNECT_MS: 80, BROADCAST_MS: 20, TICK_MS: 10 });
for (let i = 0; i < 4; i++) {
  const p = gm.makePlayer("p" + i, "Player " + i);
  room.addPlayer(p);
}
room.startRound();
assert.equal(room.phase, "setup");
assert.equal(room.players.size, 4);
assert.equal([...room.players.values()].filter(p => p.role === "seeker").length, 1);
assert.equal([...room.players.values()].filter(p => p.role === "hider").length, 3);

const seeker = [...room.players.values()].find(p => p.role === "seeker");
const hider = [...room.players.values()].find(p => p.role === "hider");
const customize = room.customize(hider.id, { color: "#E94F64", pose: "crouch", surfaceId: "red-diner" });
assert.equal(customize.ok, true);
assert.equal(hider.color, "#E94F64");
assert.equal(hider.pose, "crouch");

room.transitionToSearch();
assert.equal(room.phase, "search");
hider.x = seeker.x;
hider.z = seeker.z - 3;
seeker.yaw = Math.PI;
const spot = room.spot(seeker.id, hider.id);
assert.equal(spot.ok, true);
assert.equal(hider.found, true);

gm.detach({}); // no-op
console.log("server gameplay checks passed");


const createPlayer = gm.makePlayer("creator", "Creator");
gm.connections.set({ readyState: 1 }, createPlayer);
const createRoomResult = gm.createRoom("Creator", false, "creator");
assert.equal(createRoomResult.room.players.has("creator"), true);
assert.equal(createRoomResult.player.roomCode, createRoomResult.room.code);

const privacyRoom = new GameRoom("PRIV01", true);
for (const id of ["seeker","hider"]) privacyRoom.addPlayer(gm.makePlayer(id, id));
privacyRoom.startRound();
const pSeeker = [...privacyRoom.players.values()].find(p => p.role === "seeker");
const pHider = [...privacyRoom.players.values()].find(p => p.role === "hider");
pHider.x = pSeeker.x + 100;
pHider.z = pSeeker.z + 100;
const hiddenForSeeker = privacyRoom.stateFor(pSeeker.id).players.find(p => p.id === pHider.id);
assert.equal(hiddenForSeeker.x, null);
assert.equal(hiddenForSeeker.color, null);

const custom2 = privacyRoom.customize(pHider.id, { color: "#5ED7FF", pose: "freeze", brushSize: 3, paintCoverage: .72, surfaceId: "water" });
assert.equal(custom2.brushSize, 3);
assert.equal(custom2.paintCoverage, .22);
assert.equal(pHider.pose, "freeze");
assert.ok(pHider.frozenUntil > Date.now());

privacyRoom.transitionToSearch();
const scanSeeker = [...privacyRoom.players.values()].find(p => p.role === "seeker");
scanSeeker.lastAbilityAt = 0;
for (const p of privacyRoom.players.values()) if (p.role === "hider") { p.x = scanSeeker.x + 3; p.z = scanSeeker.z; }
assert.ok([...privacyRoom.players.values()].some(p => p.role === "hider"));
console.log("extended room, privacy, camouflage and ability state checks passed");
