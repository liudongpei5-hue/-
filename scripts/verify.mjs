import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const main = fs.readFileSync("src/main.js", "utf8");
const geometry = JSON.parse(fs.readFileSync("public/geometry-export.json", "utf8"));
const cameras = JSON.parse(fs.readFileSync("references/几何数据/camera-presets.json", "utf8"));
const artifactAssets = ["public/assets/artifacts/guardian-warrior-m2338-1.png", "public/assets/artifacts/tomb-beast-m2338-2.png"];

const requiredIds = ["scene", "menu-trigger", "menu-page", "artifacts-page", "data-page", "structure-list", "transition-veil"];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required interface layer: #${id}`);
}

if (cameras.presets.length !== 9) throw new Error(`Expected 9 screenshot camera presets, got ${cameras.presets.length}`);
const presetIndices = new Set(cameras.presets.map(item => item.geometryIndex));
for (let index = 0; index <= 8; index++) {
  if (!presetIndices.has(index)) throw new Error(`Missing camera preset for geometry ${index}`);
  if (!main.includes(`${index}: { position:`)) throw new Error(`Runtime camera preset missing for geometry ${index}`);
}
for (const preset of cameras.presets) {
  if (preset.position.length !== 3 || preset.target.length !== 3 || preset.fov !== 48) throw new Error(`Invalid camera preset: ${preset.name}`);
}

const vertexCount = geometry.geometries.reduce((sum, item) => sum + item.vertices.length, 0);
const edgeCount = geometry.geometries.reduce((sum, item) => sum + item.edges.length, 0);
if (vertexCount !== geometry.summary.vertex_count || edgeCount !== geometry.summary.edge_count) {
  throw new Error(`Geometry summary mismatch: ${vertexCount}/${edgeCount}`);
}
if (!main.includes("cultivationThickness: .32") || !main.includes("loessThickness: .30")) {
  throw new Error("Measured soil-layer thicknesses are missing");
}
if (!main.includes("CubicBezierCurve3") || !main.includes("easeBreath")) {
  throw new Error("Camera path or breathing easing is missing");
}
for (const niche of ["东壁龛", "西壁龛"]) {
  if (!geometry.geometries.some(item => item.name === niche)) throw new Error(`Missing niche geometry: ${niche}`);
  if (!main.includes(`"${niche}"`)) throw new Error(`Missing niche dimension or navigation data: ${niche}`);
}
if (!main.includes("STRUCTURE_ORDER") || !main.includes("controls.touches.TWO = THREE.TOUCH.DOLLY_PAN")) {
  throw new Error("Spatial axis order or two-finger pan is missing");
}
if (!main.includes("createWestNicheInterior") || !main.includes("PDF fig.6") || !main.includes("12: { position:")) {
  throw new Error("West niche reconstruction, evidence note or frontal camera is missing");
}
if (!main.includes("Only the two true ends are closed") || !main.includes("Internal geometry partitions stay hidden")) {
  throw new Error("Continuous overall shell invariant is missing");
}
if (!html.includes("176°") || !html.includes("北 N") || !html.includes("南 S")) {
  throw new Error("Report-based north/south orientation is missing");
}
for (let index = 0; index < geometry.geometries.length; index++) {
  if (!main.includes(`${index}: [`)) throw new Error(`Missing report dimension entry for geometry ${index}`);
}
if (!main.includes("addMeasurement") || !main.includes("dimensionLabel") || html.includes('id="dimension-callout"')) {
  throw new Error("Edge-aligned 3D dimension lines are missing or obsolete page callout remains");
}
if (!html.includes("report-page") || !html.includes("lady-lu-excavation-report.docx")) {
  throw new Error("Long-form report page or source-document download is missing");
}
for (const asset of artifactAssets) {
  if (!fs.existsSync(asset) || fs.statSync(asset).size < 20_000) throw new Error(`Missing or invalid archaeological artifact asset: ${asset}`);
}

console.log(`VERIFY_OK: ${geometry.geometries.length} geometries, ${vertexCount} vertices, ${edgeCount} edges, ${cameras.presets.length} camera nodes, ${artifactAssets.length} verified artifact assets.`);
