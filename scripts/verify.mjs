import fs from "node:fs";
import assert from "node:assert/strict";
import {
  ARTIFACT_SEQUENCE,
  CHAMBER_AUTOPLAY_EXCLUSIONS,
  DEMO_ROUTE,
  NARRATIVE_ARTIFACTS,
  buildNarrativePlaybackSequence,
  normalizeArtifactLink,
  playbackResumeIndex
} from "../src/narrative-playback.js";

const html = fs.readFileSync("index.html", "utf8");
const main = fs.readFileSync("src/main.js", "utf8");
const style = fs.readFileSync("src/style.css", "utf8");
const narrativeCardLayout = JSON.parse(fs.readFileSync("src/narrative-card-layout.json", "utf8"));
const geometry = JSON.parse(fs.readFileSync("public/geometry-export.json", "utf8"));
const burialGoods = JSON.parse(fs.readFileSync("public/data/burial-goods-points.json", "utf8"));
const cameras = JSON.parse(fs.readFileSync("references/几何数据/camera-presets.json", "utf8"));
const artifactAssets = ["public/assets/artifacts/guardian-warrior-m2338-1.png", "public/assets/artifacts/tomb-beast-m2338-2.png"];
const overviewModels = ["lu_1", "lu_2", "lu_3", "lu_4", "lu_7", "lu_28", "lu_32", "lu_37", "lu_38", "lu_39", "lu_44", "lu_45"];
const artifactSequence = ["镇墓兽", "镇墓武士俑", "墓志", "铜钱", "玻璃串珠", "贝壳", "银环", "铜钵", "骑马俑", "风帽俑", "笼冠俑", "女侍俑", "陶羊"];
const narrativeRoute = ["hongduyuan", "ramp", "shaft-sequence", "niches", "threshold", "chamber", "epitaph", "theft"];

const requiredIds = ["app", "home-page", "scene", "structure-list", "structure-hotspots", "overall-view", "auto-play", "transition-veil", "report-narrative", "narrative-list", "narrative-card", "narrative-photo-primary", "narrative-photo-secondary", "export-narrative-layout", "narrative-artifact-branch", "narrative-artifact-list", "artifact-detail", "artifact-detail-close", "artifact-progress", "artifact-model-canvas", "artifact-spatial-inset", "artifact-scene-host", "artifact-location-index", "artifact-location-caption", "artifact-location-certainty"];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Missing required interface layer: #${id}`);
}
const removedIds = ["menu-trigger", "menu-page", "data-page", "artifact-popover", "artifacts-page", "narrative-artifacts", "start-artifacts-playback", "return-space"];
for (const id of removedIds) {
  if (html.includes(`id="${id}"`)) throw new Error(`Obsolete interface layer must be removed: #${id}`);
}

const hasLegacyArtifactList = [...html.matchAll(/class="([^"]*)"/g)]
  .some(match => match[1].split(/\s+/).includes("artifact-list"));
if (hasLegacyArtifactList || html.includes("02 / ARTIFACTS") || html.includes("返回空间")) {
  throw new Error("The obsolete second-act navigation must not remain in the page");
}

assert.deepEqual(ARTIFACT_SEQUENCE, artifactSequence, "Runtime artifact sequence is out of order");

const branchIndex = html.indexOf('id="narrative-artifact-branch"');
const narrativeCardStart = html.indexOf('<article id="narrative-card"');
const narrativeCardEnd = html.indexOf("</article>", narrativeCardStart);
if (branchIndex < 0 || narrativeCardStart < 0 || (branchIndex > narrativeCardStart && branchIndex < narrativeCardEnd)) {
  throw new Error("The artifact branch must be outside the narrative summary card");
}
if (!/<aside id="report-narrative"[\s\S]*?<div class="narrative-rail">[\s\S]*?<aside id="narrative-artifact-branch"/.test(html)) {
  throw new Error("The artifact branch must be a sibling of the primary narrative rail");
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
assert.deepEqual(DEMO_ROUTE, narrativeRoute, "Narrative playback route is out of order");
if (!main.includes("const NARRATIVE_ENTRIES") || !main.includes("setupNarrativeAxis") || !main.includes("syncNarrativeAxis")) {
  throw new Error("Excavation-brief narrative axis is missing");
}
if (!main.includes('const GUIDE_ORDER = ["epitaph", "chamber", "niches", "threshold", "shaft-sequence", "ramp", "theft"]')
  || !main.includes('name: "墓主与墓志"') || !main.includes('name: "甬道", title: "封门')) {
  throw new Error("The scrolling guide must use the requested north-to-south structure order");
}
for (const marker of ['button.scrollIntoView({ block: "center"', 'list.addEventListener("scroll"', 'source: "scroll"', 'document.querySelector("#overall-view")', 'document.querySelector("#auto-play")']) {
  if (!main.includes(marker)) throw new Error(`Missing scroll-led guide behavior: ${marker}`);
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

for (const marker of ["artifactDetailOpen", "spatialReturnState", "activateArtifactByName", "showNarrativeArtifact", "closeArtifactDetail", "syncNarrativeArtifactBranch", '#narrative-artifact-branch', '#artifact-progress']) {
  if (!main.includes(marker)) throw new Error(`Missing merged narrative/artifact marker: ${marker}`);
}
for (const marker of ["ARTIFACT_SPATIAL_LOCATIONS", "createArtifactLocationLayer", "updateArtifactSpatialLocation", "focusArtifactTopDown", "enterArtifactMiniView", "exitArtifactMiniView", "artifactLocationRegion"]) {
  if (!main.includes(marker)) throw new Error(`Missing artifact spatial-location feature: ${marker}`);
}
if (!main.includes("cameraUp: snapshotUp.toArray()") || !main.includes("camera.up.fromArray(snapshot.cameraUp || [0, 0, 1])")) {
  throw new Error("Closing an inline artifact detail must restore the complete spatial camera orientation");
}
if (!main.includes("const SPATIAL_CAMERA_UP = new THREE.Vector3(0, 0, 1)") || !main.includes("camera.up.lerpVectors(startUp, endUp, t).normalize()") || !main.includes("viewUp = SPATIAL_CAMERA_UP")) {
  throw new Error("Spatial camera navigation must smoothly restore the canonical up axis");
}
if (!main.includes("new THREE.Vector3(0, 0, 6.2)") || !main.includes("const endUp = new THREE.Vector3(0, 1, 0)")) {
  throw new Error("Artifact detail camera must move vertically above the selected burial plane");
}
const branchBuilderSource = main.match(/function syncNarrativeArtifactBranch\(entry\) \{[\s\S]*?function renderNarrativeCard/)?.[0] || "";
if (!branchBuilderSource.includes('button.className = "narrative-artifact-option"')
  || !branchBuilderSource.includes('button.addEventListener("click", event =>')
  || !branchBuilderSource.includes("showNarrativeArtifact(entry, { name, locationKey }")
  || !branchBuilderSource.includes("trigger: event.currentTarget")) {
  throw new Error("Narrative artifact options must activate the inline object detail");
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
for (const obsolete of ["autoDemoPhase", "artifactAutoStep", "animateSharedSceneMorph", "#start-artifacts-playback", "#return-space"]) {
  if (main.includes(obsolete)) throw new Error(`Obsolete two-act logic must be removed: ${obsolete}`);
}
if (/setView\s*\(\s*["']artifacts["']/.test(main)) {
  throw new Error("Inline artifact playback must never switch to an artifacts view");
}
for (const marker of ["function buildAutoDemoSequence()", "buildNarrativePlaybackSequence(NARRATIVE_ENTRIES, DEMO_ROUTE)", "rememberPlaybackPosition", "playbackResumeIndex", "keepCurrentDetail", 'if (item.type === "narrative")', 'item.type === "epitaph-open"', 'item.type === "epitaph-close"', "openEpitaphModal({ auto: true })", "showNarrativeArtifact(entry, item"] ) {
  if (!main.includes(marker)) throw new Error(`Merged in-narrative playback is missing: ${marker}`);
}
if (!main.includes("function captureSpatialContext()") || !main.includes("cameraPosition: snapshotPosition.toArray()") || !main.includes("activeNarrativeId") || !main.includes("spatialReturnState = captureSpatialContext()")) {
  throw new Error("Inline artifact navigation must preserve the spatial and narrative return context");
}
if (!main.includes("artifacts: NARRATIVE_ARTIFACTS.niches")
  || !main.includes("artifacts: NARRATIVE_ARTIFACTS.chamber")
  || !main.includes("artifacts: NARRATIVE_ARTIFACTS.epitaph")) {
  throw new Error("Narrative entries must expose their own ordered artifact branches");
}
if (main.includes('#narrative-artifacts') || /id="narrative-artifacts"/.test(html)) {
  throw new Error("Artifact links must not be rendered inside the narrative summary card");
}
const expectedNarrativeArtifacts = {
  hongduyuan: [],
  ramp: [],
  "shaft-sequence": [],
  niches: ["骑马俑", "风帽俑", "笼冠俑", "女侍俑", "陶羊"]
    .map(name => ({ name, locationKey: `niches:${name}` })),
  threshold: [],
  chamber: artifactSequence.filter(name => name !== "墓志").map(name => ({ name, locationKey: "" })),
  epitaph: [{ name: "墓志", locationKey: "" }],
  theft: []
};
const runtimeNarrativeArtifacts = Object.fromEntries(narrativeRoute.map(id => [
  id,
  NARRATIVE_ARTIFACTS[id].map(normalizeArtifactLink)
]));
assert.deepEqual(runtimeNarrativeArtifacts, expectedNarrativeArtifacts, "Per-chapter artifact branches are incorrect");

const playbackEntries = narrativeRoute.map(id => ({ id, artifacts: NARRATIVE_ARTIFACTS[id] }));
const expectedPlayback = narrativeRoute.flatMap(narrativeId => {
  const steps = [{ type: "narrative", narrativeId }];
  expectedNarrativeArtifacts[narrativeId]
    .filter(link => narrativeId !== "chamber" || !CHAMBER_AUTOPLAY_EXCLUSIONS.includes(link.name))
    .forEach(link => {
    steps.push({ type: "artifact", narrativeId, ...link });
    if (narrativeId === "epitaph" && link.name === "墓志") {
      steps.push(
        { type: "epitaph-open", narrativeId },
        { type: "epitaph-close", narrativeId }
      );
    }
    });
  return steps;
});
const runtimePlayback = buildNarrativePlaybackSequence(playbackEntries);
assert.deepEqual(runtimePlayback, expectedPlayback, "Playback must show each chapter summary before its ordered artifacts");
assert.equal(runtimePlayback.length, 23, "Merged playback should contain 8 summaries, 13 non-repeated artifacts and 2 epitaph modal steps");

assert.deepEqual(
  runtimePlayback.filter(step => step.type === "artifact" && step.narrativeId === "chamber").map(step => step.name),
  ["镇墓兽", "镇墓武士俑", "铜钱", "玻璃串珠", "贝壳", "银环", "铜钵"],
  "Chamber autoplay must skip artifacts already introduced in the niches"
);

const stepAtResume = currentStep => runtimePlayback[playbackResumeIndex(runtimePlayback, currentStep)];
assert.deepEqual(
  stepAtResume({ type: "narrative", narrativeId: "niches" }),
  { type: "artifact", narrativeId: "niches", name: "骑马俑", locationKey: "niches:骑马俑" },
  "Playback must continue with the first artifact after a selected chapter"
);
assert.deepEqual(
  stepAtResume({ type: "artifact", narrativeId: "niches", name: "风帽俑", locationKey: "niches:风帽俑" }),
  { type: "artifact", narrativeId: "niches", name: "笼冠俑", locationKey: "niches:笼冠俑" },
  "Playback must continue with the artifact after the manually selected object"
);
assert.deepEqual(
  stepAtResume({ type: "artifact", narrativeId: "chamber", name: "骑马俑", locationKey: "" }),
  { type: "narrative", narrativeId: "epitaph" },
  "A manually selected duplicate chamber artifact must resume at the next chapter"
);
assert.deepEqual(
  stepAtResume({ type: "artifact", narrativeId: "epitaph", name: "墓志", locationKey: "" }),
  { type: "epitaph-open", narrativeId: "epitaph" },
  "The epitaph artifact must be followed by opening the full inscription"
);
assert.deepEqual(
  stepAtResume({ type: "epitaph-open", narrativeId: "epitaph" }),
  { type: "epitaph-close", narrativeId: "epitaph" },
  "The full inscription must close automatically after its dwell"
);
assert.deepEqual(
  stepAtResume({ type: "epitaph-close", narrativeId: "epitaph" }),
  { type: "narrative", narrativeId: "theft" },
  "Playback must continue to the next chapter after closing the epitaph"
);
for (const [name, asset] of [["风帽俑", "fengmao-figurine.png"], ["笼冠俑", "longguan-figurine.png"], ["陶羊", "sheep.png"]]) {
  if (!main.includes(`"${name}": { en:`) || !main.includes(`asset:"/assets/artifacts/catalog/${asset}"`)) {
    throw new Error(`Inline catalog image is missing for ${name}`);
  }
}
if (!main.includes('"女侍俑": { en:') || !main.includes('asset:"/assets/artifacts/catalog/female-mounted-figurine.png"')) {
  throw new Error("Female attendant catalog image is missing");
}
if (!main.includes("createArtifactStageViewer") || !main.includes("readRenderTargetPixels")) {
  throw new Error("Inline artifact model preview renderer is missing");
}
for (const marker of [".narrative-artifact-branch", ".narrative-artifact-option.active", ".narrative-artifact-detail", "#app.artifact-detail-open #artifact-scene-host #scene"]) {
  if (!style.includes(marker)) throw new Error(`Merged artifact layout styling is missing: ${marker}`);
}
const nicheModelByType = new Map([
  ["骑马俑", "lu_32"], ["风帽俑", "lu_7"], ["笼冠俑", "lu_28"], ["女侍俑", "lu_45"], ["陶羊", "lu_39"]
]);
for (const point of burialGoods.points.filter(item => String(item.name).startsWith("WK"))) {
  const type = point.properties?.["平面图器物类型"];
  const expectedModel = nicheModelByType.get(type);
  if (expectedModel && point.properties?.["三维模型"] !== expectedModel) {
    throw new Error(`${point.name} must reuse ${expectedModel} for ${type}`);
  }
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
if (!main.includes("if (narrativeEntry && anchorIndex >= 0) applyResponsiveShotOffset(endPosition, endTarget)")) {
  throw new Error("The opening narrative must reuse the unshifted overall navigator camera");
}
if (!main.includes('navigateToNarrativeEntry(entry, { source: "auto" })')) {
  throw new Error("Automatic playback must reveal each narrative summary before its artifacts");
}
if (!main.includes("new THREE.Vector3(-radius * .85, radius * 1.25, radius * .7)")) {
  throw new Error("Overall camera must keep the chamber end on screen-left");
}
for (const niche of ["东壁龛", "西壁龛"]) {
  if (!geometry.geometries.some(item => item.name === niche)) throw new Error(`Missing niche geometry: ${niche}`);
  if (!main.includes(`"${niche}"`)) throw new Error(`Missing niche dimension or navigation data: ${niche}`);
}
if (!main.includes("STRUCTURE_ORDER") || !main.includes("controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE")
  || !main.includes("controls.enablePan = false") || !main.includes("controls.zoomToCursor = false")) {
  throw new Error("Centered Blender-like orbit controls are missing");
}
if (!html.includes("/assets/report/tomb-plan.png") || !main.includes("PLAN_HOTSPOTS")) {
  throw new Error("Report-plan structure locator is missing");
}
const planBuilderSource = main.match(/function buildControls\(data\) \{[\s\S]*?function easeBreath/)?.[0] || "";
if (!planBuilderSource.includes('document.createElement("span")')
  || !html.includes('id="structure-hotspots" class="structure-hotspots" aria-hidden="true"')) {
  throw new Error("The report plan must remain a passive dot locator without click navigation");
}
for (const marker of ["function updateStructurePlanContrast()", '"--plan-boost"', 'classList.toggle("contrast-boosted"', "updateStructurePlanContrast();"]) {
  if (!main.includes(marker)) throw new Error(`Adaptive plan contrast is missing: ${marker}`);
}
for (const marker of [".structure-plan:before", "mix-blend-mode:screen", "backdrop-filter:blur(calc(", ".structure-plan.contrast-boosted", "@keyframes planAdaptiveGlow"]) {
  if (!style.includes(marker)) throw new Error(`Adaptive plan glow styling is missing: ${marker}`);
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
if (!main.includes("buildContinuousVolumeLayer") || !main.includes('mesh.name = "single-continuous-npr-depth-body"')) {
  throw new Error("Continuous overall shell invariant is missing");
}
for (let index = 0; index < geometry.geometries.length; index++) {
  if (!main.includes(`${index}: [`)) throw new Error(`Missing report dimension entry for geometry ${index}`);
}
if (!main.includes("addMeasurement") || !main.includes("dimensionLabel") || html.includes('id="dimension-callout"')) {
  throw new Error("Edge-aligned 3D dimension lines are missing or obsolete page callout remains");
}
const dimensionSource = main.match(/function dimensionLabel\(text\) \{[\s\S]*?function showMeasurements/)?.[0] || "";
if (dimensionSource.includes("fillRect") || dimensionSource.includes("strokeRect")
  || !dimensionSource.includes("addLineLayer([anchorA,a,anchorB,b]")
  || !dimensionSource.includes("tickA0.clone().add(handOffset)")) {
  throw new Error("Dimension labels must be unboxed and use differentiated hand-drawn line weights");
}
for (const asset of artifactAssets) {
  if (!fs.existsSync(asset) || fs.statSync(asset).size < 20_000) throw new Error(`Missing or invalid archaeological artifact asset: ${asset}`);
}

console.log(`VERIFY_OK: ${geometry.geometries.length} geometries, ${vertexCount} vertices, ${edgeCount} edges, ${cameras.presets.length} camera nodes, ${artifactSequence.length} linked artifacts, merged narrative playback.`);
