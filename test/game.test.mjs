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
