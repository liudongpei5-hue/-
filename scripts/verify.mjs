import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const main = fs.readFileSync("src/main.js", "utf8");
const geometry = JSON.parse(fs.readFileSync("public/geometry-export.json", "utf8"));
const cameras = JSON.parse(fs.readFileSync("references/几何数据/camera-presets.json", "utf8"));
const artifactAssets = ["public/assets/artifacts/guardian-warrior-m2338-1.png", "public/assets/artifacts/tomb-beast-m2338-2.png"];
const overviewModels = ["lu_1", "lu_2", "lu_3", "lu_4", "lu_7", "lu_28", "lu_32", "lu_37", "lu_38", "lu_39", "lu_44", "lu_45"];
const artifactSequence = ["镇墓兽", "镇墓武士俑", "墓志", "铜钱", "玻璃串珠", "贝壳", "银环", "铜钵", "骑马俑"];

const requiredIds = ["app", "home-page", "scene", "artifacts-page", "structure-list", "structure-hotspots", "transition-veil", "report-narrative", "narrative-list", "narrative-card", "narrative-artifacts", "start-artifacts-playback", "return-space", "artifact-progress"];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required interface layer: #${id}`);
}
const removedIds = ["menu-trigger", "menu-page", "data-page", "artifact-popover"];
for (const id of removedIds) {
  if (html.includes(`id="${id}"`)) throw new Error(`Obsolete interface layer must be removed: #${id}`);
}

const artifactNav = html.match(/<nav\b[^>]*class="[^"]*\bartifact-list\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
if (!artifactNav) throw new Error("Artifact navigation is missing");
const artifactButtonOrder = [...artifactNav.matchAll(/<button\b[^>]*data-artifact="([^"]+)"[^>]*>/g)].map(match => match[1]);
if (JSON.stringify(artifactButtonOrder) !== JSON.stringify(artifactSequence)) {
  throw new Error(`Artifact navigation order mismatch: ${artifactButtonOrder.join(" -> ")}`);
}

const artifactSequenceSource = main.match(/const\s+ARTIFACT_SEQUENCE\s*=\s*\[([\s\S]*?)\]\s*;/)?.[1];
if (!artifactSequenceSource) throw new Error("Explicit ARTIFACT_SEQUENCE is missing");
const runtimeArtifactSequence = [...artifactSequenceSource.matchAll(/["'`]([^"'`]+)["'`]/g)].map(match => match[1]);
if (JSON.stringify(runtimeArtifactSequence) !== JSON.stringify(artifactSequence)) {
  throw new Error(`Runtime artifact sequence mismatch: ${runtimeArtifactSequence.join(" -> ")}`);
}

if (!/<main\b[^>]*id="app"[^>]*data-view="home"/.test(html)) {
  throw new Error("The application must open on the home page");
}
if (!main.includes("const enterModel") || !main.includes('setView("model", event)') || !main.includes('homePage.addEventListener("click", enterModel)')) {
  throw new Error("Home-page activation must enter the spatial model directly");
}

if (cameras.presets.length !== 13) throw new Error(`Expected 13 competition camera presets, got ${cameras.presets.length}`);
const presetIndices = new Set(cameras.presets.map(item => item.geometryIndex));
for (let index = 0; index <= 12; index++) {
  if (!presetIndices.has(index)) throw new Error(`Missing camera preset for geometry ${index}`);
  if (!main.includes(`${index}: { position:`)) throw new Error(`Runtime camera preset missing for geometry ${index}`);
}
for (const preset of cameras.presets) {
  if (preset.position.length !== 3 || preset.target.length !== 3 || preset.fov !== 40 || !preset.focus?.length) throw new Error(`Invalid camera preset: ${preset.name}`);
}
const viewVectors = cameras.presets.map(preset => {
  const vector = preset.position.map((value, index) => value - preset.target[index]);
  const length = Math.hypot(...vector);
  return vector.map(value => value / length);
});
if (viewVectors[0][0] >= 0 || viewVectors[0][1] <= 0) {
  throw new Error("Camera route must look from the opposite side with the chamber projecting screen-left");
}
for (const vector of viewVectors.slice(1)) {
  const dot = vector.reduce((sum, value, index) => sum + value * viewVectors[0][index], 0);
  if (dot < .998) throw new Error("Camera presets must retain one stable viewing direction");
}
if (JSON.stringify(cameras.route) !== JSON.stringify([8, 6, 4, 3, 11, 1, 0, 9, 10]) || !main.includes("const DEMO_ROUTE = [8, 6, 4, 3, 11, 1, 0, 9, 10]")) {
  throw new Error("Competition camera route is missing or out of sync");
}
if (!main.includes("const NARRATIVE_ENTRIES") || !main.includes("setupNarrativeAxis") || !main.includes("syncNarrativeAxis")) {
  throw new Error("Excavation-brief narrative axis is missing");
}
for (const index of [8, 6, 4, 3, 11, 1, 0]) {
  if (!main.includes(`index: ${index}, no:`)) throw new Error(`Missing narrative node for camera ${index}`);
}

for (const marker of ["autoDemoPhase", "artifactAutoStep", "spatialReturnState", "activateArtifactByName", '#narrative-artifacts', '#start-artifacts-playback', '#return-space', '#artifact-progress']) {
  if (!main.includes(marker)) throw new Error(`Missing model/artifact linkage marker: ${marker}`);
}
if (!main.includes('autoDemoPhase = "artifacts"') || !main.includes('autoDemoPhase = "model"')) {
  throw new Error("Automatic playback must expose explicit model and artifacts phases");
}
if (main.includes("DEMO_ROUTE[autoDemoStep % DEMO_ROUTE.length]")) {
  throw new Error("Spatial playback must cross into artifacts instead of looping with modulo");
}

const spatialBoundary = main.match(/autoDemoStep\s*>=\s*DEMO_ROUTE\.length/);
if (!spatialBoundary) throw new Error("Spatial playback has no explicit end-of-route boundary");
const spatialBoundaryWindow = main.slice(spatialBoundary.index, spatialBoundary.index + 1100);
if (!/autoDemoPhase\s*=\s*["']artifacts["']/.test(spatialBoundaryWindow) || !/setView\(["']artifacts["']/.test(spatialBoundaryWindow)) {
  throw new Error("End of spatial playback must switch the phase and view to artifacts");
}

const artifactBoundary = main.match(/artifactAutoStep\s*>=\s*ARTIFACT_SEQUENCE\.length/);
if (!artifactBoundary) throw new Error("Artifact playback has no explicit end-of-sequence boundary");
const artifactBoundaryWindow = main.slice(artifactBoundary.index, artifactBoundary.index + 1100);
if (!/autoDemoPhase\s*=\s*["']model["']/.test(artifactBoundaryWindow) || !/setView\(["']model["']/.test(artifactBoundaryWindow)) {
  throw new Error("End of artifact playback must return to the spatial phase and model view");
}

const directArtifactControl = main.match(/querySelector\(["']#start-artifacts-playback["']\)([\s\S]{0,700})/);
if (!directArtifactControl || !/addEventListener\(["']click["']/.test(directArtifactControl[1]) || !/artifact/i.test(directArtifactControl[1])) {
  throw new Error("The direct artifact-playback control is not wired to the artifact phase");
}
const returnSpaceControl = main.match(/querySelector\(["']#return-space["']\)([\s\S]{0,900})/);
if (!returnSpaceControl || !/addEventListener\(["']click["']/.test(returnSpaceControl[1]) || !/(spatialReturnState|setView\(["']model["'])/.test(returnSpaceControl[1])) {
  throw new Error("The artifact view has no wired return-to-space control");
}
if (!main.includes("function captureSpatialContext()") || !main.includes("cameraPosition: snapshotPosition.toArray()") || !main.includes("activeNarrativeIndex") || !main.includes("spatialReturnState = captureSpatialContext()")) {
  throw new Error("Narrative-to-artifact navigation must preserve the spatial and narrative return context");
}
if (!main.includes("const NARRATIVE_ARTIFACTS") || !main.includes('[0, ARTIFACT_SEQUENCE]') || !main.includes('document.querySelector("#narrative-artifacts")')) {
  throw new Error("Narrative entries must expose linked artifact terms in the narrative card");
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
if (!main.includes("applyResponsiveShotOffset") || !main.includes("narrowFactor") || !main.includes("narrativeFactor")) {
  throw new Error("Responsive close-up safe-area compensation is missing");
}
if (!main.includes("if (options.auto) openNarrativeCard(narrativeEntryForStructure(index))")) {
  throw new Error("Automatic camera demo must reveal the narrative card");
}
if (!main.includes("new THREE.Vector3(-radius * .85, radius * 1.25, radius * .7)")) {
  throw new Error("Overall camera must keep the chamber end on screen-left");
}
for (const niche of ["东壁龛", "西壁龛"]) {
  if (!geometry.geometries.some(item => item.name === niche)) throw new Error(`Missing niche geometry: ${niche}`);
  if (!main.includes(`"${niche}"`)) throw new Error(`Missing niche dimension or navigation data: ${niche}`);
}
if (!main.includes("STRUCTURE_ORDER") || !main.includes("controls.touches.TWO = THREE.TOUCH.DOLLY_PAN")) {
  throw new Error("Spatial axis order or two-finger pan is missing");
}
if (!html.includes("/assets/report/tomb-plan.png") || !main.includes("PLAN_HOTSPOTS")) {
  throw new Error("Report-plan structure navigation is missing");
}
if (!main.includes('placement.secondary ? `盗洞${label.slice(1)}` : label')) {
  throw new Error("Theft-shaft plan labels must use 盗洞1 / 盗洞2");
}
if (main.includes("await loadBurialGoods()") || !main.includes("loadBurialGoods().then")) {
  throw new Error("Burial-goods models must load without blocking the spatial interface");
}
if (!main.includes("/models/burial-goods-overview")) {
  throw new Error("The spatial overview must use lightweight burial-goods models");
}
for (const modelId of overviewModels) {
  const modelPath = `public/models/burial-goods-overview/${modelId}.glb`;
  if (!fs.existsSync(modelPath)) throw new Error(`Missing overview model: ${modelId}`);
  const size = fs.statSync(modelPath).size;
  if (size < 50_000 || size > 500_000) throw new Error(`Unexpected overview model size: ${modelId} (${size})`);
}
if (!main.includes("createWestNicheInterior") || !main.includes("PDF fig.6") || !main.includes("12: { position:")) {
  throw new Error("West niche reconstruction, evidence note or frontal camera is missing");
}
if (!main.includes("Only the two true ends are closed") || !main.includes("Internal geometry partitions stay hidden")) {
  throw new Error("Continuous overall shell invariant is missing");
}
for (let index = 0; index < geometry.geometries.length; index++) {
  if (!main.includes(`${index}: [`)) throw new Error(`Missing report dimension entry for geometry ${index}`);
}
if (!main.includes("addMeasurement") || !main.includes("dimensionLabel") || html.includes('id="dimension-callout"')) {
  throw new Error("Edge-aligned 3D dimension lines are missing or obsolete page callout remains");
}
for (const asset of artifactAssets) {
  if (!fs.existsSync(asset) || fs.statSync(asset).size < 20_000) throw new Error(`Missing or invalid archaeological artifact asset: ${asset}`);
}

console.log(`VERIFY_OK: ${geometry.geometries.length} geometries, ${vertexCount} vertices, ${edgeCount} edges, ${cameras.presets.length} camera nodes, ${artifactSequence.length} linked artifacts, two-phase playback.`);
