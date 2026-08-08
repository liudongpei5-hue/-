import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const main = fs.readFileSync("src/main.js", "utf8");
const style = fs.readFileSync("src/style.css", "utf8");
const narrativeCardLayout = JSON.parse(fs.readFileSync("src/narrative-card-layout.json", "utf8"));
const geometry = JSON.parse(fs.readFileSync("public/geometry-export.json", "utf8"));
const cameras = JSON.parse(fs.readFileSync("references/几何数据/camera-presets.json", "utf8"));
const artifactAssets = ["public/assets/artifacts/guardian-warrior-m2338-1.png", "public/assets/artifacts/tomb-beast-m2338-2.png"];
const overviewModels = ["lu_1", "lu_2", "lu_3", "lu_4", "lu_7", "lu_28", "lu_32", "lu_37", "lu_38", "lu_39", "lu_44", "lu_45"];
const artifactSequence = ["镇墓兽", "镇墓武士俑", "墓志", "铜钱", "玻璃串珠", "贝壳", "银环", "铜钵", "骑马俑"];

const requiredIds = ["app", "home-page", "scene", "artifacts-page", "structure-list", "structure-hotspots", "transition-veil", "report-narrative", "narrative-list", "narrative-card", "export-narrative-layout", "narrative-artifacts", "start-artifacts-playback", "return-space", "artifact-progress", "artifact-spatial-inset", "artifact-scene-host", "artifact-location-index", "artifact-location-caption", "artifact-location-certainty"];
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
if (JSON.stringify(cameras.route) !== JSON.stringify([8, 6, 4, 3, 11, 1, 0, 9, 10])) {
  throw new Error("Competition camera route is missing or out of sync");
}
const narrativeRoute = ["hongduyuan", "ramp", "shaft-sequence", "niches", "threshold", "chamber", "epitaph", "theft"];
const narrativeRouteSource = main.match(/const\s+DEMO_ROUTE\s*=\s*\[([\s\S]*?)\]\s*;/)?.[1] || "";
const runtimeNarrativeRoute = [...narrativeRouteSource.matchAll(/["'`]([^"'`]+)["'`]/g)].map(match => match[1]);
if (JSON.stringify(runtimeNarrativeRoute) !== JSON.stringify(narrativeRoute)) {
  throw new Error(`Narrative playback route mismatch: ${runtimeNarrativeRoute.join(" -> ")}`);
}
if (!main.includes("const NARRATIVE_ENTRIES") || !main.includes("setupNarrativeAxis") || !main.includes("syncNarrativeAxis")) {
  throw new Error("Excavation-brief narrative axis is missing");
}
for (const id of narrativeRoute) {
  if (!main.includes(`id: "${id}"`)) throw new Error(`Missing narrative node: ${id}`);
}
if (!main.includes("focusIndices: [2, 3, 4, 5, 6, 7]") || !main.includes("focusIndices: [9, 10]")) {
  throw new Error("Narrative must support combined spatial structures");
}
if ((main.match(/cameraIndex:\s*0/g) || []).length < 2 || !main.includes("primary: false")) {
  throw new Error("The chamber must support more than one narrative point");
}
const narrativeHeader = html.match(/<header\b[^>]*class="narrative-head"[^>]*>([\s\S]*?)<\/header>/)?.[1] || "";
if (!narrativeHeader.includes("EXCAVATION BRIEF") || !narrativeHeader.includes("《陕西咸阳唐李将军魏公故卢夫人墓发掘简报》") || !narrativeHeader.includes("考古简报空间叙事")) {
  throw new Error("The shared excavation-brief source heading is incomplete");
}
if (/<article\b[^>]*id="narrative-card"[\s\S]*?<cite>/.test(html)) {
  throw new Error("Narrative cards must not repeat the shared report citation");
}
if (html.includes("narrative-card-drag-handle") || html.includes("DRAG · 拖动")) {
  throw new Error("Narrative cards must be directly draggable without a dedicated drag header");
}
if (!style.includes(".narrative-card{position:fixed") || !style.includes(".narrative-head cite{")) {
  throw new Error("Narrative card must be independently positioned beside the shared source heading");
}
if (narrativeCardLayout.version !== 1 || narrativeCardLayout.coordinateSpace !== "viewport-ratio") {
  throw new Error("Narrative card layout config has an unsupported format");
}
for (const id of narrativeRoute) {
  const position = narrativeCardLayout.positions?.[id];
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)
    || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) {
    throw new Error(`Narrative card layout is missing a position for ${id}`);
  }
}
for (const marker of ["NARRATIVE_LAYOUT_STORAGE_KEY", "localStorage.setItem", "setupNarrativeCardDragging", "exportNarrativeCardLayout", "new Blob", 'link.download = "narrative-card-layout.json"']) {
  if (!main.includes(marker)) throw new Error(`Narrative card layout feature is missing: ${marker}`);
}

for (const marker of ["autoDemoPhase", "artifactAutoStep", "spatialReturnState", "activateArtifactByName", '#narrative-artifacts', '#start-artifacts-playback', '#return-space', '#artifact-progress']) {
  if (!main.includes(marker)) throw new Error(`Missing model/artifact linkage marker: ${marker}`);
}
for (const marker of ["ARTIFACT_SPATIAL_LOCATIONS", "createArtifactLocationLayer", "updateArtifactSpatialLocation", "focusArtifactTopDown", "enterArtifactMiniView", "exitArtifactMiniView", "artifactLocationRegion"]) {
  if (!main.includes(marker)) throw new Error(`Missing artifact spatial-location feature: ${marker}`);
}
for (const marker of ["sceneMorphActive", "animateSharedSceneMorph", "applyViewLayerState", "canvas.animate", "scene-morphing"]) {
  if (!main.includes(marker) && !style.includes(marker)) throw new Error(`Missing shared-scene morph transition: ${marker}`);
}
if (!main.includes("cameraUp: camera.up.toArray()") || !main.includes("camera.up.fromArray(snapshot.cameraUp || [0, 0, 1])")) {
  throw new Error("Returning from artifacts must restore the complete spatial camera orientation");
}
if (!main.includes('restoreSpatialContext(spatialReturnState, { preserveCamera: true })')) {
  throw new Error("Returning from artifacts must initially preserve the artifact camera");
}
if (!main.includes("const SPATIAL_CAMERA_UP = new THREE.Vector3(0, 0, 1)") || !main.includes("camera.up.lerpVectors(startUp, endUp, t).normalize()") || !main.includes("viewUp = SPATIAL_CAMERA_UP")) {
  throw new Error("First-act camera navigation must smoothly restore the canonical spatial up axis");
}
if (!style.includes("#app.scene-morphing #scene") || !style.includes("will-change:left,top,width,height")) {
  throw new Error("Shared WebGL canvas has no continuous layout-transition styling");
}
if (/scene-morphing #scene\{[^}]*inset:auto!important/.test(style)) {
  throw new Error("Morph styling must not override the animated left/top coordinates");
}
if (!/function resize\(\)\s*\{\s*if \(sceneMorphActive\) return;/.test(main)) {
  throw new Error("Renderer resizing must stay frozen while the shared scene canvas is moving");
}
if (!main.includes("new THREE.Vector3(0, 0, 6.2)") || !main.includes("const endUp = new THREE.Vector3(0, 1, 0)")) {
  throw new Error("Artifact hover camera must move vertically above the selected burial plane");
}
const artifactHoverWindow = main.match(/button\.addEventListener\(["']pointerenter["'][\s\S]{0,300}/)?.[0] || "";
if (!artifactHoverWindow.includes("activateArtifact(button)")) {
  throw new Error("Artifact hover must activate the selected object and its top-down camera");
}
if ((main.match(/new THREE\.WebGLRenderer/g) || []).length !== 1) {
  throw new Error("Artifact spatial inset must reuse the existing renderer instead of loading a second WebGL scene");
}
for (const artifactName of artifactSequence) {
  if (!new RegExp(`["']${artifactName}["']\\s*:\\s*\\{[\\s\\S]{0,220}anchor\\s*:`).test(main)) {
    throw new Error(`Missing spatial anchor for artifact: ${artifactName}`);
  }
}
if (!main.includes("host.append(canvas)") || !main.includes("sceneHomeParent.insertBefore(canvas, sceneHomeNextSibling)")) {
  throw new Error("The shared scene canvas must move into and out of the artifact spatial inset");
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
if (!main.includes("function captureSpatialContext()") || !main.includes("cameraPosition: snapshotPosition.toArray()") || !main.includes("activeNarrativeId") || !main.includes("spatialReturnState = captureSpatialContext()")) {
  throw new Error("Narrative-to-artifact navigation must preserve the spatial and narrative return context");
}
if (!main.includes('artifacts: ARTIFACT_SEQUENCE.filter(name => name !== "墓志")') || !main.includes('artifacts: ["墓志"]') || !main.includes('artifacts: ["骑马俑"]') || !main.includes('document.querySelector("#narrative-artifacts")')) {
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
if (!main.includes("navigateToNarrativeEntry(narrativeEntryById(narrativeId), { source: \"auto\" })")) {
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
