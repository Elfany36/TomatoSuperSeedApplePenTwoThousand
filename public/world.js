
export const WORLD_BOUNDS = { minX: -20, maxX: 20, minZ: -15, maxZ: 15 };

export const SURFACES = [
  { id: "path", name: "Sunny Path", shape: "box", x: 0, z: 0, w: 42, d: 5, h: 0.08, color: "#D9C27A", kind: "ground" },
  { id: "red-diner", name: "Tomato Diner", shape: "box", x: 0, z: -10, w: 11, d: 3.5, h: 3.2, color: "#E94F64", kind: "building" },
  { id: "cyan-kiosk", name: "Blue Kiosk", shape: "box", x: -12, z: -3, w: 4.5, d: 5, h: 3.5, color: "#38C7EE", kind: "kiosk" },
  { id: "purple-tent", name: "Plum Tent", shape: "box", x: 10, z: 1, w: 6, d: 5.5, h: 3.5, color: "#9B6DF5", kind: "tent" },
  { id: "orange-cart", name: "Orange Cart", shape: "box", x: -11, z: 7, w: 5, d: 2.5, h: 2.3, color: "#F98B4A", kind: "cart" },
  { id: "mint-stage", name: "Mint Stage", shape: "box", x: 12, z: 9, w: 5, d: 4, h: 2.8, color: "#43AA8B", kind: "stage" },
  { id: "waffle-stand", name: "Waffle Stand", shape: "box", x: 4, z: 9, w: 4, d: 3, h: 2, color: "#FFD166", kind: "waffle" },
  { id: "wood-shop", name: "Wood Shop", shape: "box", x: -16, z: -9, w: 3.5, d: 4.5, h: 2.6, color: "#8B6B4D", kind: "wood" },
  { id: "vending", name: "Vending Machine", shape: "box", x: 15.5, z: -6, w: 2.4, d: 2.2, h: 3.2, color: "#48A6E5", kind: "vending" },
  { id: "bench", name: "Wooden Bench", shape: "box", x: -16, z: 8.5, w: 4.5, d: 1.2, h: 1.4, color: "#9A6A45", kind: "bench" },
  { id: "throne", name: "Tiny Throne", shape: "box", x: 6.5, z: -7.2, w: 2.8, d: 2.4, h: 2.6, color: "#E8B24A", kind: "throne" },
  { id: "traffic-cone", name: "Traffic Cone", shape: "cone", x: -4.5, z: -6.5, w: 1.3, d: 1.3, h: 2.2, color: "#FF7043", kind: "cone" },
  { id: "candy-tree-a", name: "Candy Tree A", shape: "tree", x: -7, z: 11, w: 2.4, d: 2.4, h: 5.4, color: "#F15BB5", kind: "tree" },
  { id: "candy-tree-b", name: "Candy Tree B", shape: "tree", x: 16, z: 3.5, w: 2.6, d: 2.6, h: 5.8, color: "#90BE6D", kind: "tree" },
  { id: "tomato-box", name: "Tomato Crate", shape: "box", x: 8, z: 5.8, w: 2.1, d: 2.1, h: 1.8, color: "#EF476F", kind: "crate" },
  { id: "seafoam-stack", name: "Seafoam Stack", shape: "box", x: -2.5, z: 6.6, w: 2.5, d: 2.3, h: 2.6, color: "#55C7A5", kind: "stack" }
];

export const STATIC_WORLD = {
  floorColor: "#79C86A",
  skyColor: "#8AD8F2"
};

export const PLAYER_SPAWNS = [
  [-15, 12], [-10, 12], [-5, 12], [0, 12], [5, 12],
  [10, 12], [15, 12], [-15, -12], [0, -12], [15, -12]
];

export function pointAabbDistance(px, pz, item) {
  const hx = item.w * 0.5;
  const hz = item.d * 0.5;
  const dx = Math.max(Math.abs(px - item.x) - hx, 0);
  const dz = Math.max(Math.abs(pz - item.z) - hz, 0);
  return Math.hypot(dx, dz);
}

export function hexToRgb(hex) {
  const value = String(hex).replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

export function colorSimilarity(a, b) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const d = Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b) / 441.67295593;
  return Math.max(0, Math.min(1, 1 - d));
}
