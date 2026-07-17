import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const FALLBACK_NAMES = ["墓室", "甬道", "第三天井", "第三过洞", "第二天井", "第二过洞", "第一天井", "第一过洞", "墓道", "D2", "D1", "东壁龛", "西壁龛"];
const BURIAL_GOODS_OVERVIEW_PATH = "/models/burial-goods-overview";
const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.up.set(0, 0, 1);
scene.add(new THREE.HemisphereLight(0xf8efe0, 0x6f6255, 2.2));
const artifactKeyLight = new THREE.DirectionalLight(0xfff4df, 2.8);
artifactKeyLight.position.set(3.5, -5.5, 7.5);
scene.add(artifactKeyLight);
const artifactFillLight = new THREE.DirectionalLight(0xd7e8ff, .9);
artifactFillLight.position.set(-5.5, 4.5, 3.2);
scene.add(artifactFillLight);
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 500);
camera.up.set(0, 0, 1);
camera.position.set(20, -25, 18);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 5;
controls.maxDistance = 80;
controls.enablePan = true;
controls.panSpeed = .85;
controls.screenSpacePanning = true;
controls.touches.ONE = THREE.TOUCH.ROTATE;
controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

const twoFingerGesture = {
  startDistance: 0,
  lastDistance: 0,
  lastCenter: new THREE.Vector2(),
  mode: "idle"
};

function getTouchPair(event) {
  if (event.touches.length !== 2) return null;
  const a = event.touches[0];
  const b = event.touches[1];
  const dx = b.clientX - a.clientX;
  const dy = b.clientY - a.clientY;
  return {
    distance: Math.hypot(dx, dy),
    center: new THREE.Vector2((a.clientX + b.clientX) * .5, (a.clientY + b.clientY) * .5)
  };
}

function startTwoFingerGesture(event) {
  const pair = getTouchPair(event);
  if (!pair) return;
  twoFingerGesture.startDistance = pair.distance;
  twoFingerGesture.lastDistance = pair.distance;
  twoFingerGesture.lastCenter.copy(pair.center);
  twoFingerGesture.mode = "pending";
  controls.enableZoom = true;
}

function updateTwoFingerGesture(event) {
  const pair = getTouchPair(event);
  if (!pair || twoFingerGesture.mode === "idle") return;
  const centerMove = pair.center.distanceTo(twoFingerGesture.lastCenter);
  const totalDistanceChange = Math.abs(pair.distance - twoFingerGesture.startDistance);
  const frameDistanceChange = Math.abs(pair.distance - twoFingerGesture.lastDistance);

  if (twoFingerGesture.mode === "pending") {
    if (totalDistanceChange > 10 && totalDistanceChange > centerMove * .55) {
      twoFingerGesture.mode = "pinch";
    } else if (centerMove > 3 && frameDistanceChange < 9) {
      twoFingerGesture.mode = "pan";
    }
  }

  controls.enableZoom = twoFingerGesture.mode !== "pan";
  twoFingerGesture.lastDistance = pair.distance;
  twoFingerGesture.lastCenter.copy(pair.center);
}

function endTwoFingerGesture(event) {
  if (event.touches.length >= 2) {
    startTwoFingerGesture(event);
    return;
  }
  twoFingerGesture.mode = "idle";
  controls.enableZoom = true;
}

canvas.addEventListener("touchstart", startTwoFingerGesture, { passive: true, capture: true });
canvas.addEventListener("touchmove", updateTwoFingerGesture, { passive: true, capture: true });
canvas.addEventListener("touchend", endTwoFingerGesture, { passive: true, capture: true });
canvas.addEventListener("touchcancel", endTwoFingerGesture, { passive: true, capture: true });

const root = new THREE.Group();
scene.add(root);
const measurementGroup = new THREE.Group();
measurementGroup.name = "结构尺寸刻度";
scene.add(measurementGroup);
const objects = [];
const wideMaterials = [];
let selectedIndex = -1;
let perspectiveGuides;
let naturalShell;
let groundLayer;
let sketchVolumeLayer;
let burialGoodsLayer;
let groundCompass;
let overallView;
let cameraMoveToken = 0;
let autoDemoTimer = 0;
let autoDemoActive = false;
let autoDemoStep = 0;
let autoDemoPhase = "model";
let artifactAutoStep = 0;
let artifactTourButtons = [];
let activateArtifactByName = () => false;
let activeArtifactName = "";
let spatialReturnState = null;
let selectedFocusIndices = [];
let narrativeCardOpen = false;
let activeNarrativeIndex = -1;
const structureTargets = new Map();
const pointer = { x: 0, y: 0 };
const STRUCTURE_ORDER = [0, 1, 2, 3, 11, 12, 4, 5, 6, 7, 8, 9, 10];
const PLAN_HOTSPOTS = new Map([
  [0, { x: 14.23, y: 62.16, w: 20.73, h: 70.27 }],
  [1, { x: 26.68, y: 44.59, w: 4.17, h: 33.33 }],
  [2, { x: 33.54, y: 44.37, w: 9.55, h: 33.78 }],
  [3, { x: 40.85, y: 44.82, w: 5.08, h: 31.98 }],
  [11, { x: 39.99, y: 19.59, w: 5.39, h: 21.17 }],
  [12, { x: 40.75, y: 68.47, w: 5.49, h: 23.42 }],
  [4, { x: 47.92, y: 45.05, w: 9.04, h: 32.43 }],
  [5, { x: 54.57, y: 44.82, w: 4.27, h: 31.98 }],
  [6, { x: 61.38, y: 43.92, w: 9.35, h: 35.59 }],
  [7, { x: 68.45, y: 43.92, w: 4.78, h: 33.78 }],
  [8, { x: 83.64, y: 42.34, w: 25.61, h: 37.84 }],
  [9, { x: 24.29, y: 42.12, secondary: true }],
  [10, { x: 33.54, y: 44.82, secondary: true }]
]);
const DEMO_ROUTE = [8, 6, 4, 3, 11, 1, 0];
const ARTIFACT_SEQUENCE = ["镇墓兽", "镇墓武士俑", "墓志", "铜钱", "玻璃串珠", "贝壳", "银环", "铜钵", "骑马俑"];
const NARRATIVE_ARTIFACTS = new Map([
  [11, ["骑马俑"]],
  [0, ARTIFACT_SEQUENCE]
]);
const AUTO_TIMING = {
  model: 6600,
  artifact: 4800,
  transition: 1050,
  restart: 2200,
  idle: 9000
};
const NARRATIVE_ENTRIES = [
  {
    index: 8, no: "01", name: "墓道", title: "向北入地",
    summary: "墓道从最南端以 27° 斜坡向地下延伸，白灰残痕标记进入葬域的第一段。",
    quote: "墓道，位于该墓葬最南端，略呈南宽北窄梯形状……最深处距现地表 3.32 米，斜坡 27°，壁面光滑，可见白灰刷饰残留。"
  },
  {
    index: 6, no: "02", name: "第一井洞", title: "第一重 · 见天",
    summary: "第一过洞接入上下贯通的第一天井，完成从封闭斜洞到竖向开口的第一次明暗转换。",
    quote: "第一过洞进深 1.08、宽 1.24、高 1.52 米；第一天井南壁上口略有坍塌，长 1.96、宽 1.08，底部长 1.7、宽 1.34 米。"
  },
  {
    index: 4, no: "03", name: "第二井洞", title: "第二重 · 收束",
    summary: "尺度更窄的第二过洞与第二天井继续向北收束，在相似节奏中把行进引向墓室深处。",
    quote: "第二过洞进深 0.9、宽 0.92、高 1.6 米；第二天井长 1.96、南宽 1、北宽 0.96、底部长 1.8、宽 1.24～1.32 米。"
  },
  {
    index: 3, no: "04", name: "第三井洞", title: "第三重 · 转折",
    summary: "第三过洞与受损的第三天井构成最后一组井洞，早期盗洞 1 也在这里切入墓葬空间。",
    quote: "第三过洞进深 1.08、宽 1.24、高 1.76 米；第三天井东、西两壁略有损坏，长 2.04、南宽 1.16、北宽 1.28 米。"
  },
  {
    index: 11, no: "05", name: "东西壁龛", title: "双龛 · 列仪",
    summary: "第三过洞两侧展开形制不同的东、西壁龛，人物、动物与生活器物形成两组空间叙事。",
    quote: "壁龛 2 个，均位于第三过洞内，编号分别为东一号龛（EK1）和西一号龛（WK1）。东龛为拱顶平底，西龛口部小、内部大。"
  },
  {
    index: 1, no: "06", name: "甬道", title: "封门之前",
    summary: "保存完整的拱顶甬道连接第三天井与墓室，中部坍塌的土坯封门提示内外葬域的最后边界。",
    quote: "甬道，南接第三天井，北侧与墓室相连，拱顶土洞，保存完整，平底，进深 1.08、宽 1.28、高 1.92 米。"
  },
  {
    index: 0, no: "07", name: "墓室", title: "北端 · 安寝",
    summary: "最北端墓室以拱顶直壁、砖铺地面和西侧棺床容纳墓主，随葬品主要集中于东南隅及入口附近。",
    quote: "墓室，位于该墓葬最北端，单室土洞，拱顶，残存直壁平而规整，尚可观察到白灰面；墓室进深 3.68、宽 3.04、高 2.52 米。"
  }
];
const STRUCTURE_MEASURES = {
  0: [{axis:"x",label:"3.68 m"},{axis:"y",label:"3.04 m"},{axis:"z",label:"2.52 m"}],
  1: [{axis:"x",label:"1.08 m"},{axis:"y",label:"1.28 m"},{axis:"z",label:"1.92 m"}],
  2: [{axis:"x",label:"2.04 m",level:"top"},{axis:"y",label:"1.16 m",level:"top",side:"minx"},{axis:"y",label:"1.28 m",level:"top",side:"maxx"},{axis:"x",label:"1.80 m",offset:.36},{axis:"y",label:"1.40-1.48 m",offset:.36}],
  3: [{axis:"x",label:"1.08 m"},{axis:"y",label:"1.24 m"},{axis:"z",label:"1.76 m"}],
  4: [{axis:"x",label:"1.96 m",level:"top"},{axis:"y",label:"1.00 m",level:"top",side:"minx"},{axis:"y",label:"0.96 m",level:"top",side:"maxx"},{axis:"x",label:"1.80 m",offset:.36},{axis:"y",label:"1.24-1.32 m",offset:.36}],
  5: [{axis:"x",label:"0.90 m"},{axis:"y",label:"0.92 m"},{axis:"z",label:"1.60 m"}],
  6: [{axis:"x",label:"1.96 m",level:"top"},{axis:"y",label:"1.08 m",level:"top"},{axis:"x",label:"1.70 m",offset:.36},{axis:"y",label:"1.34 m",offset:.36}],
  7: [{axis:"x",label:"1.08 m"},{axis:"y",label:"1.24 m"},{axis:"z",label:"1.52 m"}],
  8: [{axis:"x",label:"5.52 m",level:"top"},{axis:"y",label:"1.52 m",level:"top",side:"minx"},{axis:"y",label:"1.20 m",level:"top",side:"maxx"},{axis:"z",label:"3.32 m"}],
  9: [{axis:"x",label:"0.60 m",level:"top"},{axis:"y",label:"0.40 m",level:"top"}],
  10: [{axis:"y",label:"Ø 1.30 m",level:"top"}],
  11: [{axis:"y",label:"1.80-1.90 m"},{axis:"x",label:"1.40 m"},{axis:"z",label:"1.40 m"}],
  12: [{axis:"y",label:"2.36-2.40 m"},{axis:"y",label:"0.50 m",side:"minx",fraction:.21,offset:.38},{axis:"x",label:"1.92 m",side:"mouth"},{axis:"x",label:"2.08 m",side:"back",offset:.32},{axis:"z",label:"1.60 m"}]
};
const CAMERA_PRESETS = {
  0: { position: [-.01, 8.23, 1.39], target: [5.83, .13, -3.63], fov: 40, focus: [0] },
  1: { position: [.84, 4.19, -.82], target: [4.07, -.30, -3.60], fov: 40, focus: [1] },
  2: { position: [-8.11, 10.48, 5.97], target: [.26, -1.15, -1.24], fov: 40, focus: [2, 3] },
  3: { position: [-8.11, 10.48, 5.97], target: [.26, -1.15, -1.24], fov: 40, focus: [2, 3] },
  4: { position: [-9.10, 8.57, 5.71], target: [-2.28, -.91, -.17], fov: 40, focus: [4, 5] },
  5: { position: [-9.10, 8.57, 5.71], target: [-2.28, -.91, -.17], fov: 40, focus: [4, 5] },
  6: { position: [-10.26, 6.93, 5.63], target: [-4.71, -.78, .84], fov: 40, focus: [6, 7] },
  7: { position: [-10.26, 6.93, 5.63], target: [-4.71, -.78, .84], fov: 40, focus: [6, 7] },
  8: { position: [-15.34, 7.67, 6.88], target: [-9.16, -.92, 1.55], fov: 40, focus: [8] },
  9: { position: [-2.68, 7.57, 5.16], target: [3.50, -1.02, -.17], fov: 40, focus: [9] },
  10: { position: [-4.59, 7.67, 5.27], target: [1.51, -.81, .01], fov: 40, focus: [10] },
  11: { position: [-5.74, 7.70, 2.83], target: [.18, -.52, -2.26], fov: 40, focus: [11, 12] },
  12: { position: [-5.74, 7.70, 2.83], target: [.18, -.52, -2.26], fov: 40, focus: [11, 12] }
};

const vertexShader = `
uniform float uJitter;
uniform float uLayer;
varying float vGrain;
float hash(vec3 p) { p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
void main(){
  float n=hash(position*7.31+vec3(uLayer*13.7));
  vec3 displaced=position+normal*0.0;
  displaced.x += (n-.5)*uJitter*uLayer;
  displaced.z += (hash(position.zyx*9.17)-.5)*uJitter*uLayer;
  vGrain=hash(position*17.9+vec3(uLayer));
  gl_Position=projectionMatrix*modelViewMatrix*vec4(displaced,1.0);
}`;
const fragmentShader = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uLayer;
varying float vGrain;
void main(){
  float graphite=.72+.28*sin(vGrain*37.0+uLayer*2.0);
  gl_FragColor=vec4(uColor,uOpacity*graphite);
}`;


function material(layer, opacity) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(layer === 0 ? 0x34332f : 0x625d54) },
      uOpacity: { value: opacity },
      uJitter: { value: layer === 0 ? 0 : 0.012 },
      uLayer: { value: layer }
    },
    vertexShader,
    fragmentShader
  });
}

function seededNoise(value) {
  return Math.sin(value * 12.9898 + 78.233) * 43758.5453 % 1;
}

function renderedEdges(item) {
  if (item.name === "墓道") {
    // The survey export closes the inner end of the ramp with a vertical rectangle.
    // It is a construction artifact rather than part of the visible sloping passage.
    const hiddenPairs = new Set(["0:1", "0:2", "1:3"]);
    return item.edges.filter(({ from_vertex_index: from, to_vertex_index: to }) => {
      const pair = `${Math.min(from, to)}:${Math.max(from, to)}`;
      return !hiddenPairs.has(pair);
    });
  }
  if (!/^(第一|第二|第三)(天井|过洞)$/.test(item.name)) return item.edges;

  // Courtyards and passages are consecutive sections of one excavation.  Their
  // exported end rectangles overlap at every junction, so render longitudinal
  // edges only and leave both internal ends open.
  const xValues = item.vertices.map(vertex => vertex.xyz_m[0]);
  const xMid = (Math.min(...xValues) + Math.max(...xValues)) / 2;
  return item.edges.filter(({ from_vertex_index: from, to_vertex_index: to }) => {
    const fromSide = item.vertices[from].xyz_m[0] < xMid;
    const toSide = item.vertices[to].xyz_m[0] < xMid;
    return fromSide !== toSide;
  });
}

function geometryFrom(item, layer = 0) {
  const positions = [];
  renderedEdges(item).forEach((edge, edgeIndex) => {
    if (layer === 1 && edgeIndex % 5 === 2) return;
    if (layer === 2 && edgeIndex % 3 !== 0) return;
    const start = new THREE.Vector3(...item.vertices[edge.from_vertex_index].xyz_m);
    const end = new THREE.Vector3(...item.vertices[edge.to_vertex_index].xyz_m);
    const direction = end.clone().sub(start);
    const length = direction.length();
    const steps = Math.max(7, Math.min(22, Math.ceil(length * 2.2)));
    const axis = direction.clone().normalize();
    const guide = Math.abs(axis.z) < .88 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(axis, guide).normalize();
    const lift = new THREE.Vector3().crossVectors(axis, side).normalize();
    const amplitude = (.008 + layer * .009) * Math.min(1.5, Math.max(.7, length / 3));
    const overshoot = .024 + layer * .012;
    const points = [];
    for (let step = 0; step <= steps; step++) {
      const raw = step / steps;
      const shortenedEnd = layer === 2 ? .72 + Math.abs(seededNoise(edgeIndex + 91)) * .23 : 1;
      const t = -overshoot + raw * (shortenedEnd + overshoot * 2);
      const point = start.clone().addScaledVector(direction, t);
      const envelope = .55 + Math.sin(raw * Math.PI) * .45;
      const seed = edgeIndex * 97 + step * 17 + layer * 311;
      const roughA = seededNoise(seed) * 2 - 1;
      const roughB = seededNoise(seed + 41) * 2 - 1;
      point.addScaledVector(side, roughA * amplitude * envelope);
      point.addScaledVector(lift, roughB * amplitude * .68 * envelope);
      points.push(point);
    }
    for (let step = 0; step < points.length - 1; step++) positions.push(...points[step].toArray(), ...points[step + 1].toArray());
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function addStructure(item, index) {
  if (!item.vertices.length || !item.edges.length) return;
  const group = new THREE.Group();
  group.userData = { index, name: item.name || FALLBACK_NAMES[index] || `结构 ${index + 1}` };
  const main = new THREE.LineSegments(geometryFrom(item, 0), material(0, .9));
  const echoA = new THREE.LineSegments(geometryFrom(item, 1), material(1, .32));
  const echoB = new THREE.LineSegments(geometryFrom(item, 2), material(2, .2));
  const accent = item.name === "D1" ? 0x8f574a : item.name === "D2" ? 0x4d6f78 : 0x37342f;
  if (item.name === "D1" || item.name === "D2") {
    main.material.uniforms.uColor.value.setHex(accent);
    echoA.material.uniforms.uColor.value.setHex(accent);
    echoB.material.uniforms.uColor.value.setHex(accent);
  }
  const wideGeometry = new LineSegmentsGeometry();
  wideGeometry.setPositions(main.geometry.attributes.position.array);
  const wideMaterial = new LineMaterial({ color: accent, linewidth: 1.75, transparent: true, opacity: .38, depthWrite: false });
  const understroke = new LineSegments2(wideGeometry, wideMaterial);
  understroke.computeLineDistances();
  wideMaterials.push(wideMaterial);
  main.material.uniforms.uJitter.value = .003;
  group.userData.lines = { understroke, main, echoA, echoB };
  group.add(understroke, main, echoA, echoB);
  if (index === 0) {
    group.userData.interior = createTombInterior(item);
    group.add(group.userData.interior);
  }
  if (index === 12) {
    group.userData.interior = createWestNicheInterior(item);
    group.add(group.userData.interior);
  }
  root.add(group);
  objects.push(group);
}

function annotationLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(246,242,232,.92)";
  ctx.strokeStyle = "rgba(154,73,59,.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(24, 9, 80, 38, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#4b4339";
  ctx.font = "bold 24px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 29);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(.28, .14, 1);
  sprite.renderOrder = 24;
  sprite.userData.opacityMaterial = material;
  return sprite;
}

function createPointMarker(annotation) {
  const group = new THREE.Group();
  const height = Number(annotation.properties?.["高度"]) || .22;
  const ringGeometry = new THREE.RingGeometry(.045, .07, 32);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x9a493b, transparent: true, opacity: .86, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.renderOrder = 18;
  group.add(ring);

  const stemGeometry = new THREE.BufferGeometry();
  stemGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, .02, 0, 0, height + .08], 3));
  const stemMaterial = new THREE.LineBasicMaterial({ color: 0x9a493b, transparent: true, opacity: .32, depthWrite: false });
  const stem = new THREE.Line(stemGeometry, stemMaterial);
  group.add(stem);

  const label = annotationLabel(annotation.properties?.["平面图编号"] || "");
  label.position.set(0, 0, height + .16);
  group.add(label);
  group.userData.opacityMaterials = [ringMaterial, stemMaterial, label.userData.opacityMaterial];
  return group;
}

function normalizeArtifactModel(model, targetHeight) {
  model.rotation.x = Math.PI / 2;
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(center.x, center.y, box.min.z));
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  const normalizedHeight = box.getSize(new THREE.Vector3()).z || size.y || 1;
  const scale = targetHeight / normalizedHeight;
  model.scale.multiplyScalar(scale);
}

function tuneArtifactMaterials(model, opacityMaterials) {
  model.traverse(child => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
    const source = child.material || new THREE.MeshStandardMaterial();
    const material = source.clone();
    material.transparent = true;
    material.opacity = .96;
    material.depthWrite = true;
    material.depthTest = true;
    material.roughness = Math.max(material.roughness ?? .75, .64);
    material.metalness = Math.min(material.metalness ?? 0, .08);
    if (material.color && !material.map) material.color.lerp(new THREE.Color(0xb98f66), .28);
    if ("envMapIntensity" in material) material.envMapIntensity = .8;
    child.material = material;
    opacityMaterials.push(material);
  });
}

async function loadBurialGoods() {
  const [pointsResponse] = await Promise.all([
    fetch("/data/burial-goods-points.json?v=20260713-models")
  ]);
  if (!pointsResponse.ok) throw new Error("无法读取随葬品点位数据");
  const pointData = await pointsResponse.json();
  const annotations = pointData.points
    .filter(point => point.properties?.["三维模型"] && point.worldXYZ)
    .sort((a, b) => Number(a.properties?.["平面图编号"] || 0) - Number(b.properties?.["平面图编号"] || 0));
  const modelIds = [...new Set(annotations.map(point => point.properties["三维模型"]))];
  const loader = new GLTFLoader();
  const library = new Map();
  await Promise.all(modelIds.map(async modelId => {
    const gltf = await loader.loadAsync(`${BURIAL_GOODS_OVERVIEW_PATH}/${modelId}.glb?v=20260717-overview`);
    library.set(modelId, gltf.scene);
  }));

  const layer = new THREE.Group();
  layer.name = "随葬品三维模型与点位";
  layer.userData.opacityMaterials = [];
  const chamberCenter = structureTargets.get(0) || new THREE.Vector3(7.6, .8, -4.12);
  annotations.forEach((annotation, index) => {
    const source = library.get(annotation.properties["三维模型"]);
    if (!source) return;
    const anchor = annotation.worldXYZ;
    const targetHeight = Number(annotation.properties?.["高度"]) || .22;
    const instance = new THREE.Group();
    instance.name = `${annotation.properties?.["器号"] || annotation.properties?.["平面图编号"]} ${annotation.properties?.["具体名称"] || ""}`;
    instance.position.set(anchor.x, anchor.y, anchor.z + .018);
    instance.rotation.z = Math.atan2(chamberCenter.y - anchor.y, chamberCenter.x - anchor.x) - Math.PI / 2 + (index % 5 - 2) * .045;
    const model = source.clone(true);
    normalizeArtifactModel(model, targetHeight);
    tuneArtifactMaterials(model, layer.userData.opacityMaterials);
    instance.add(model);
    const marker = createPointMarker(annotation);
    layer.userData.opacityMaterials.push(...marker.userData.opacityMaterials);
    instance.add(marker);
    layer.add(instance);
  });
  scene.add(layer);
  burialGoodsLayer = layer;
  return annotations.length;
}

function setBurialGoodsOpacity(multiplier) {
  if (!burialGoodsLayer) return;
  burialGoodsLayer.visible = multiplier > .01;
  burialGoodsLayer.userData.opacityMaterials.forEach(material => {
    const base = material.userData.baseOpacity ?? material.opacity ?? .9;
    material.userData.baseOpacity = base;
    material.opacity = base * multiplier;
  });
  burialGoodsLayer.traverse(child => {
    if (child.type === "Sprite" && child.material) child.material.opacity = .9 * multiplier;
  });
}

function boundsOf(item) {
  const box = new THREE.Box3();
  item.vertices.forEach(vertex => box.expandByPoint(new THREE.Vector3(...vertex.xyz_m)));
  return box;
}

function polylineItem(points) {
  return {
    vertices: points.map(xyz_m => ({ xyz_m })),
    edges: points.slice(1).map((_, i) => ({ from_vertex_index: i, to_vertex_index: i + 1 }))
  };
}

function naturalLine(points, opacity = .72, color = 0x403d38) {
  const group = roughObject(polylineItem(points), opacity, color);
  group.userData.baseOpacity = opacity;
  return group;
}

function buildNaturalShell(data) {
  const shell = new THREE.Group();
  shell.name = "整体连续墓穴外轮廓";
  const stations = data.geometries.slice(0, 9).map((item, index) => {
    const box = boundsOf(item);
    return { index, item, box, x: (box.min.x + box.max.x) / 2 };
  }).sort((a, b) => a.x - b.x);

  const leftFloor = [], rightFloor = [], leftCrown = [], rightCrown = [];
  stations.forEach(({ box, x }) => {
    leftFloor.push([x, box.min.y, box.min.z]);
    rightFloor.push([x, box.max.y, box.min.z]);
    leftCrown.push([x, box.min.y, box.max.z]);
    rightCrown.push([x, box.max.y, box.max.z]);
  });
  [leftFloor, rightFloor, leftCrown, rightCrown].forEach((points, i) => shell.add(naturalLine(points, i < 2 ? .82 : .68)));

  // Only the two true ends are closed in overall view. Internal geometry partitions stay hidden.
  const entrance = boundsOf(data.geometries[8]);
  const chamber = boundsOf(data.geometries[0]);
  shell.add(naturalLine([
    [entrance.min.x, entrance.min.y, entrance.min.z],
    [entrance.min.x, entrance.min.y, entrance.max.z],
    [entrance.min.x, entrance.max.y, entrance.max.z],
    [entrance.min.x, entrance.max.y, entrance.min.z]
  ], .72));
  shell.add(naturalLine([
    [chamber.max.x, chamber.min.y, chamber.min.z],
    [chamber.max.x, chamber.min.y, chamber.max.z],
    [chamber.max.x, chamber.max.y, chamber.max.z],
    [chamber.max.x, chamber.max.y, chamber.min.z]
  ], .72));

  // East and west niches remain independent selectable structures, but their mouths are open to passage 3.
  const passage = boundsOf(data.geometries[3]);
  [11, 12].forEach(index => {
    const niche = boundsOf(data.geometries[index]);
    const east = index === 11;
    const mouthY = east ? passage.min.y : passage.max.y;
    const backY = east ? niche.min.y : niche.max.y;
    const floorZ = niche.min.z;
    const crownZ = niche.max.z;
    const x0 = niche.min.x, x1 = niche.max.x;
    shell.add(naturalLine([[x0,mouthY,floorZ],[x0,backY,floorZ],[x1,backY,floorZ],[x1,mouthY,floorZ]], .78));
    shell.add(naturalLine([[x0,mouthY,crownZ],[x0,backY,crownZ],[x1,backY,crownZ],[x1,mouthY,crownZ]], .66));
    shell.add(naturalLine([[x0,backY,floorZ],[x0,backY,crownZ],[x1,backY,crownZ],[x1,backY,floorZ]], .62));
  });

  // Report-based structural profiles restored: three over-caves, corridor and chamber are arched earth caves.
  [0, 1, 3, 5, 7].forEach(index => {
    const box = boundsOf(data.geometries[index]);
    const x = (box.min.x + box.max.x) / 2;
    const wallTop = box.max.z - (index === 0 ? .78 : .48);
    const points = [];
    for (let sample = 0; sample <= 18; sample++) {
      const t = sample / 18;
      points.push([x, THREE.MathUtils.lerp(box.min.y, box.max.y, t), wallTop + Math.sin(t * Math.PI) * (box.max.z - wallTop)]);
    }
    shell.add(naturalLine(points, index === 0 ? .82 : .72));
  });

  // Only damage explicitly described by the report is shown; no freehand decorative fragments.
  [0, 2].forEach(index => {
    const box = boundsOf(data.geometries[index]);
    const x = box.max.x - (box.max.x - box.min.x) * .28;
    const points = [];
    for (let sample = 0; sample < 7; sample++) {
      const t = sample / 6;
      points.push([x, THREE.MathUtils.lerp(box.min.y, box.max.y, t), THREE.MathUtils.lerp(box.min.z, box.max.z, t)]);
    }
    shell.add(naturalLine(points, .34, 0x5e5951));
  });
  return shell;
}

function sketchWashMaterial(color = 0x8f7a5f, opacity = .18) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity }
    },
    vertexShader: `
      attribute float aShade;
      attribute float aGrain;
      varying float vShade;
      varying float vGrain;
      varying vec3 vWorld;
      void main(){
        vShade=aShade;
        vGrain=aGrain;
        vWorld=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vShade;
      varying float vGrain;
      varying vec3 vWorld;
      float hatch(vec2 p){ return fract(sin(dot(floor(p),vec2(41.2,91.7)))*43758.5453); }
      void main(){
        float tooth=.72+.28*hatch(vWorld.xy*18.0+vWorld.z*3.0);
        float edge=pow(abs(sin((vWorld.x-vWorld.y)*7.5+vGrain*4.0)),10.0)*.16;
        float graphite=(.48+(1.0-vShade)*.88+edge)*tooth;
        gl_FragColor=vec4(uColor,uOpacity*graphite);
      }`
  });
}

function trackOpacity(group, material, baseOpacity) {
  material.userData.baseOpacity = baseOpacity;
  group.userData.opacityMaterials.push(material);
  return material;
}

function jitteredPoint(point, seed, scale = .025) {
  return [
    point[0] + (seededNoise(seed) * 2 - 1) * scale,
    point[1] + (seededNoise(seed + 13) * 2 - 1) * scale,
    point[2] + (seededNoise(seed + 29) * 2 - 1) * scale * .72
  ];
}

function addSketchQuad(group, corners, options = {}) {
  const divisionsU = options.divisionsU || 5;
  const divisionsV = options.divisionsV || 4;
  const color = options.color || 0x927b5c;
  const opacity = options.opacity || .16;
  const normal = new THREE.Vector3(...(options.normal || [0, 0, 1])).normalize();
  const light = new THREE.Vector3(-.42, -.58, .7).normalize();
  const shade = THREE.MathUtils.clamp(normal.dot(light) * .5 + .5, .18, .98);
  const positions = [];
  const shades = [];
  const grains = [];
  const pointAt = (u, v) => {
    const a = new THREE.Vector3(...corners[0]).lerp(new THREE.Vector3(...corners[1]), u);
    const b = new THREE.Vector3(...corners[3]).lerp(new THREE.Vector3(...corners[2]), u);
    return a.lerp(b, v).toArray();
  };
  for (let uIndex = 0; uIndex < divisionsU; uIndex++) for (let vIndex = 0; vIndex < divisionsV; vIndex++) {
    const u0 = uIndex / divisionsU, u1 = (uIndex + 1) / divisionsU;
    const v0 = vIndex / divisionsV, v1 = (vIndex + 1) / divisionsV;
    const seed = (options.seed || 0) + uIndex * 47 + vIndex * 89;
    const quad = [
      jitteredPoint(pointAt(u0, v0), seed),
      jitteredPoint(pointAt(u1, v0), seed + 5),
      jitteredPoint(pointAt(u1, v1), seed + 11),
      jitteredPoint(pointAt(u0, v1), seed + 17)
    ];
    [0, 1, 2, 0, 2, 3].forEach(index => {
      positions.push(...quad[index]);
      shades.push(THREE.MathUtils.clamp(shade + (seededNoise(seed + index) - .5) * .16, .12, 1));
      grains.push(Math.abs(seededNoise(seed + index * 19)));
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("aShade", new THREE.Float32BufferAttribute(shades, 1));
  geo.setAttribute("aGrain", new THREE.Float32BufferAttribute(grains, 1));
  const mat = trackOpacity(group, sketchWashMaterial(color, opacity), opacity);
  group.add(new THREE.Mesh(geo, mat));

  if (options.hatching !== false) {
    const hatch = [];
    const hatchCount = Math.ceil((divisionsU + divisionsV) * (1.8 - shade));
    for (let i = 0; i < hatchCount; i++) {
      const t = (i + .35) / hatchCount;
      const start = pointAt(.08 + t * .72, .12 + Math.abs(seededNoise(i + options.seed)) * .18);
      const end = pointAt(.18 + t * .74, .72 + Math.abs(seededNoise(i + options.seed + 9)) * .18);
      hatch.push(...jitteredPoint(start, i + 201, .018), ...jitteredPoint(end, i + 229, .018));
    }
    const hatchGeo = new THREE.BufferGeometry();
    hatchGeo.setAttribute("position", new THREE.Float32BufferAttribute(hatch, 3));
    const hatchOpacity = opacity * THREE.MathUtils.clamp(1.35 - shade, .35, 1.15);
    const hatchMat = trackOpacity(group, new THREE.LineBasicMaterial({ color: 0x4f463b, transparent: true, opacity: hatchOpacity, depthWrite: false }), hatchOpacity);
    group.add(new THREE.LineSegments(hatchGeo, hatchMat));
  }
}

function addArchedEndTone(group, box, x, seed, opacity = .12) {
  const wallTop = box.max.z - .42;
  const centerY = (box.min.y + box.max.y) / 2;
  const halfY = (box.max.y - box.min.y) / 2;
  const points = [[x, box.min.y, box.min.z], [x, box.max.y, box.min.z]];
  for (let i = 10; i >= 0; i--) {
    const t = i / 10;
    points.push([x, centerY + Math.cos(t * Math.PI) * halfY, wallTop + Math.sin(t * Math.PI) * (box.max.z - wallTop)]);
  }
  const center = [x, centerY, box.min.z + (box.max.z - box.min.z) * .42];
  for (let i = 0; i < points.length - 1; i++) {
    addSketchQuad(group, [center, points[i], points[i + 1], center], {
      normal: x < 0 ? [-1, 0, 0] : [1, 0, 0],
      color: 0x856b51,
      opacity,
      divisionsU: 2,
      divisionsV: 2,
      seed: seed + i * 23
    });
  }
}

function addTombPassageSketch(group, item, seed) {
  const point = index => item.vertices[index].xyz_m;
  const innerNear = point(0), innerFar = point(1);
  const innerTopNear = point(2), innerTopFar = point(3);
  const mouthTopNear = point(4), mouthTopFar = point(5);

  // Keep only the real ramp and its two sloping side planes.  In particular, do
  // not reconstruct the exported inner-end rectangle behind the ramp.
  addSketchQuad(group, [innerNear, innerFar, mouthTopFar, mouthTopNear], {
    normal: [.48, 0, .88], color: 0xb19773, opacity: .16,
    divisionsU: 7, divisionsV: 3, seed
  });
  addSketchQuad(group, [innerNear, innerTopNear, mouthTopNear, innerNear], {
    normal: [0, -1, 0], color: 0x876f55, opacity: .16,
    divisionsU: 6, divisionsV: 3, seed: seed + 31
  });
  addSketchQuad(group, [innerFar, mouthTopFar, innerTopFar, innerFar], {
    normal: [0, 1, 0], color: 0x7f664d, opacity: .19,
    divisionsU: 6, divisionsV: 3, seed: seed + 59
  });
}

function endProfile(vertices) {
  const byHeight = [...vertices].sort((a, b) => a[2] - b[2]);
  const lower = byHeight.slice(0, 2).sort((a, b) => a[1] - b[1]);
  const upper = byHeight.slice(2).sort((a, b) => a[1] - b[1]);
  return {
    lowerNear: lower[0], lowerFar: lower[1],
    upperNear: upper[0], upperFar: upper[1]
  };
}

function addOpenEndedStructureSketch(group, item, seed, vaulted) {
  const points = item.vertices.map(vertex => vertex.xyz_m);
  const xValues = points.map(point => point[0]);
  const xMid = (Math.min(...xValues) + Math.max(...xValues)) / 2;
  const left = endProfile(points.filter(point => point[0] < xMid));
  const right = endProfile(points.filter(point => point[0] >= xMid));
  const vaultRise = .46;
  const leftWallNear = vaulted ? [left.upperNear[0], left.upperNear[1], left.upperNear[2] - vaultRise] : left.upperNear;
  const leftWallFar = vaulted ? [left.upperFar[0], left.upperFar[1], left.upperFar[2] - vaultRise] : left.upperFar;
  const rightWallNear = vaulted ? [right.upperNear[0], right.upperNear[1], right.upperNear[2] - vaultRise] : right.upperNear;
  const rightWallFar = vaulted ? [right.upperFar[0], right.upperFar[1], right.upperFar[2] - vaultRise] : right.upperFar;

  // Actual surveyed floor elevations are used at both ends.  No end-cap faces
  // are added, so adjoining courtyard/passage sections remain visually continuous.
  addSketchQuad(group, [left.lowerNear, right.lowerNear, right.lowerFar, left.lowerFar], {
    normal: [0, 0, 1], color: 0xb19773, opacity: vaulted ? .18 : .12,
    divisionsU: 6, divisionsV: 3, seed
  });
  addSketchQuad(group, [left.lowerNear, right.lowerNear, rightWallNear, leftWallNear], {
    normal: [0, -1, 0], color: 0x876f55, opacity: .18,
    divisionsU: 6, divisionsV: 4, seed: seed + 31
  });
  addSketchQuad(group, [right.lowerFar, left.lowerFar, leftWallFar, rightWallFar], {
    normal: [0, 1, 0], color: 0x7f664d, opacity: .22,
    divisionsU: 6, divisionsV: 4, seed: seed + 59
  });
  if (vaulted) {
    const archSegments = 8;
    for (let index = 0; index < archSegments; index++) {
      const a = index / archSegments;
      const b = (index + 1) / archSegments;
      const archPoint = (profile, t) => {
        const near = profile.upperNear, far = profile.upperFar;
        const springZ = (near[2] + far[2]) / 2 - vaultRise;
        const crownZ = (near[2] + far[2]) / 2;
        return [
          THREE.MathUtils.lerp(near[0], far[0], t),
          THREE.MathUtils.lerp(near[1], far[1], t),
          springZ + Math.sin(t * Math.PI) * (crownZ - springZ)
        ];
      };
      addSketchQuad(group, [archPoint(left, a), archPoint(right, a), archPoint(right, b), archPoint(left, b)], {
        normal: [0, a < .5 ? -.45 : .45, .6], color: 0x80684f, opacity: .11,
        divisionsU: 6, divisionsV: 2, seed: seed + 101 + index * 17, hatching: false
      });
    }
  }
}

function buildSketchVolumeLayer(data) {
  const group = new THREE.Group();
  group.name = "sketched-earth-volume";
  group.userData.opacityMaterials = [];
  const mainIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  mainIndexes.forEach((index, order) => {
    const item = data.geometries[index];
    const box = boundsOf(data.geometries[index]);
    const seed = 500 + index * 113;
    if (index === 8) {
      addTombPassageSketch(group, item, seed);
      return;
    }
    if (index >= 2 && index <= 7) {
      addOpenEndedStructureSketch(group, item, seed, [3, 5, 7].includes(index));
      return;
    }
    const isCourtyard = [2, 4, 6].includes(index);
    const isCave = [0, 1, 3, 5, 7].includes(index);
    const inset = isCourtyard ? .03 : .015;
    addSketchQuad(group, [
      [box.min.x, box.min.y, box.min.z + inset],
      [box.max.x, box.min.y, box.min.z + inset],
      [box.max.x, box.max.y, box.min.z + inset],
      [box.min.x, box.max.y, box.min.z + inset]
    ], { normal: [0, 0, 1], color: 0xb19773, opacity: isCourtyard ? .12 : .18, divisionsU: 7, divisionsV: 3, seed });
    addSketchQuad(group, [
      [box.min.x, box.min.y, box.min.z],
      [box.max.x, box.min.y, box.min.z],
      [box.max.x, box.min.y, box.max.z],
      [box.min.x, box.min.y, box.max.z]
    ], { normal: [0, -1, 0], color: 0x876f55, opacity: .18, divisionsU: 7, divisionsV: 4, seed: seed + 31 });
    addSketchQuad(group, [
      [box.max.x, box.max.y, box.min.z],
      [box.min.x, box.max.y, box.min.z],
      [box.min.x, box.max.y, box.max.z],
      [box.max.x, box.max.y, box.max.z]
    ], { normal: [0, 1, 0], color: 0x7f664d, opacity: .22, divisionsU: 7, divisionsV: 4, seed: seed + 59 });
    if (isCave) {
      const crownZ = box.max.z;
      const springZ = box.max.z - (index === 0 ? .78 : .46);
      const centerY = (box.min.y + box.max.y) / 2;
      const archSegments = 8;
      for (let i = 0; i < archSegments; i++) {
        const a = i / archSegments, b = (i + 1) / archSegments;
        const ya = THREE.MathUtils.lerp(box.min.y, box.max.y, a);
        const yb = THREE.MathUtils.lerp(box.min.y, box.max.y, b);
        const za = springZ + Math.sin(a * Math.PI) * (crownZ - springZ);
        const zb = springZ + Math.sin(b * Math.PI) * (crownZ - springZ);
        const midY = (ya + yb) / 2;
        const normalY = midY < centerY ? -.45 : .45;
        addSketchQuad(group, [
          [box.min.x, ya, za],
          [box.max.x, ya, za],
          [box.max.x, yb, zb],
          [box.min.x, yb, zb]
        ], { normal: [0, normalY, .6], color: 0x80684f, opacity: .13, divisionsU: 7, divisionsV: 2, seed: seed + 101 + i * 17 });
      }
      if (order === 0 || index === 7) addArchedEndTone(group, box, index === 7 ? box.min.x : box.max.x, seed + 301, .11);
    } else {
      addSketchQuad(group, [
        [box.min.x, box.min.y, box.max.z],
        [box.max.x, box.min.y, box.max.z],
        [box.max.x, box.max.y, box.max.z],
        [box.min.x, box.max.y, box.max.z]
      ], { normal: [0, 0, 1], color: 0xc4aa82, opacity: .08, divisionsU: 5, divisionsV: 3, seed: seed + 137, hatching: false });
    }
  });
  [11, 12].forEach((index, nicheIndex) => {
    const box = boundsOf(data.geometries[index]);
    const seed = 1800 + index * 37;
    addSketchQuad(group, [[box.min.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.max.z], [box.min.x, box.min.y, box.max.z]], { normal: [0, -1, 0], color: nicheIndex ? 0x765d49 : 0x8b7157, opacity: .12, seed });
    addSketchQuad(group, [[box.min.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.max.z], [box.min.x, box.max.y, box.max.z]], { normal: [0, 1, 0], color: 0x735a45, opacity: .16, seed: seed + 61 });
    addSketchQuad(group, [[box.min.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.min.z]], { normal: [0, 0, 1], color: 0xa98b67, opacity: .12, divisionsU: 4, divisionsV: 3, seed: seed + 103 });
  });
  return group;
}

function buildGroundLayer(data) {
  const group = new THREE.Group();
  group.name = "耕土层与垆土层（实测厚度）";
  const mainBounds = new THREE.Box3();
  data.geometries.forEach(item => item.vertices.forEach(v => mainBounds.expandByPoint(new THREE.Vector3(...v.xyz_m))));
  const openingZ = Math.max(...[2, 4, 6].flatMap(i => data.geometries[i].vertices.map(v => v.xyz_m[2])));
  const groundTop = openingZ + .32;
  const loessBottom = openingZ - .30;
  group.userData = { groundTop, cultivationThickness: .32, loessThickness: .30 };
  const x0 = mainBounds.min.x - 4.5, x1 = mainBounds.max.x + 4.5;
  const y0 = mainBounds.min.y - 4.2, y1 = mainBounds.max.y + 4.2;
  const openings = [2, 4, 6, 8, 9, 10].map(i => boundsOf(data.geometries[i]));
  const isOpening = (x, y) => openings.some((box, i) => {
    const pad = i === 3 ? .22 : .12;
    return x >= box.min.x - pad && x <= box.max.x + pad && y >= box.min.y - pad && y <= box.max.y + pad;
  });
  const positions = [], edgeFade = [];
  const nx = 88, ny = 48;
  for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) {
    const ax = THREE.MathUtils.lerp(x0, x1, ix / nx), bx = THREE.MathUtils.lerp(x0, x1, (ix + 1) / nx);
    const ay = THREE.MathUtils.lerp(y0, y1, iy / ny), by = THREE.MathUtils.lerp(y0, y1, (iy + 1) / ny);
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    if (isOpening(cx, cy)) continue;
    const zA = groundTop + (seededNoise(ix * 91 + iy * 17) * 2 - 1) * .018;
    const corners = [[ax,ay,zA],[bx,ay,zA],[bx,by,zA],[ax,by,zA]];
    [0,1,2,0,2,3].forEach(c => positions.push(...corners[c]));
    const fade = Math.min((cx-x0)/(x1-x0),(x1-cx)/(x1-x0),(cy-y0)/(y1-y0),(y1-cy)/(y1-y0));
    for (let k=0;k<6;k++) edgeFade.push(Math.min(1, fade * 8));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute("aFade", new THREE.Float32BufferAttribute(edgeFade,1));
  const mat = new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{uColor:{value:new THREE.Color(0xb9a98e)}},vertexShader:`attribute float aFade; varying float vFade; varying vec3 vWorld; void main(){vFade=aFade;vWorld=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform vec3 uColor; varying float vFade; varying vec3 vWorld; float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);} void main(){float grain=.72+.28*h(floor(vWorld.xy*19.));gl_FragColor=vec4(uColor,.115*vFade*grain);}`});
  group.add(new THREE.Mesh(geo,mat));

  // Excavation collars join the sketched ground surface to each real opening instead of floating above it.
  openings.forEach((box, openingIndex) => {
    const zBottom = Math.min(groundTop - .08, box.max.z);
    const xA = box.min.x - .08, xB = box.max.x + .08;
    const yA = box.min.y - .08, yB = box.max.y + .08;
    const wallPositions = [];
    const addWall = (a,b,c,d) => wallPositions.push(...a,...b,...c,...a,...c,...d);
    addWall([xA,yA,zBottom],[xB,yA,zBottom],[xB,yA,groundTop],[xA,yA,groundTop]);
    addWall([xB,yB,zBottom],[xA,yB,zBottom],[xA,yB,groundTop],[xB,yB,groundTop]);
    addWall([xA,yB,zBottom],[xA,yA,zBottom],[xA,yA,groundTop],[xA,yB,groundTop]);
    addWall([xB,yA,zBottom],[xB,yB,zBottom],[xB,yB,groundTop],[xB,yA,groundTop]);
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute("position", new THREE.Float32BufferAttribute(wallPositions,3));
    group.add(new THREE.Mesh(wallGeo,new THREE.MeshBasicMaterial({color:openingIndex > 3 ? 0x9b806f : 0xa58d6c,transparent:true,opacity:.12,side:THREE.DoubleSide,depthWrite:false})));

    const rim = [[xA,yA,groundTop],[xB,yA,groundTop],[xB,yB,groundTop],[xA,yB,groundTop],[xA,yA,groundTop]];
    group.add(naturalLine(rim,.54,openingIndex > 3 ? 0x75594f : 0x514b43));
    const hatch = [];
    const count = Math.max(4,Math.ceil((xB-xA+yB-yA)*2.5));
    for (let h=0;h<count;h++) {
      const t=(h+.35)/count;
      const side=h%4;
      const x=side<2?THREE.MathUtils.lerp(xA,xB,t):(side===2?xA:xB);
      const y=side>=2?THREE.MathUtils.lerp(yA,yB,t):(side===0?yA:yB);
      hatch.push(x,y,groundTop-.02,x+(side<2?.07:0),y+(side>=2?.07:0),zBottom+.03);
    }
    const hatchGeo=new THREE.BufferGeometry(); hatchGeo.setAttribute("position",new THREE.Float32BufferAttribute(hatch,3));
    group.add(new THREE.LineSegments(hatchGeo,new THREE.LineBasicMaterial({color:0x655a4d,transparent:true,opacity:.2,depthWrite:false})));
  });

  // Top-soil pencil strokes, omitted over excavation openings and faded at the outer edge.
  const soilStrokes = [];
  for (let i=0;i<420;i++) {
    const x=THREE.MathUtils.lerp(x0,x1,Math.abs(seededNoise(i*31)));
    const y=THREE.MathUtils.lerp(y0,y1,Math.abs(seededNoise(i*47+9)));
    if (isOpening(x,y)) continue;
    const len=.08+Math.abs(seededNoise(i*73))* .32;
    soilStrokes.push(x-len,y-.03,groundTop+.025, x+len,y+.03,groundTop+.025);
  }
  const strokeGeo=new THREE.BufferGeometry(); strokeGeo.setAttribute("position",new THREE.Float32BufferAttribute(soilStrokes,3));
  group.add(new THREE.LineSegments(strokeGeo,new THREE.LineBasicMaterial({color:0x655e53,transparent:true,opacity:.16,depthWrite:false})));

  // Section ribbons make the two measured layers legible without adding them to the structure index.
  const makeRibbon=(za,zb,color,opacity)=>{const g=new THREE.BoxGeometry(x1-x0,.055,Math.abs(za-zb));const m=new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false});const mesh=new THREE.Mesh(g,m);mesh.position.set((x0+x1)/2,y1-.08,(za+zb)/2);return mesh;};
  group.add(makeRibbon(groundTop,openingZ,0x837464,.22));
  group.add(makeRibbon(openingZ,loessBottom,0xb09a72,.2));
  const boundaries=[]; [groundTop,openingZ,loessBottom].forEach(z=>boundaries.push(x0,y1-.11,z,x1,y1-.11,z));
  const bGeo=new THREE.BufferGeometry();bGeo.setAttribute("position",new THREE.Float32BufferAttribute(boundaries,3));
  group.add(new THREE.LineSegments(bGeo,new THREE.LineBasicMaterial({color:0x554f48,transparent:true,opacity:.34,depthWrite:false})));
  return group;
}

function boxItem(center, size) {
  const [cx, cy, cz] = center, [sx, sy, sz] = size;
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const corners = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  return { vertices: corners.map(xyz_m => ({ xyz_m })), edges: edges.map(([from_vertex_index,to_vertex_index]) => ({ from_vertex_index,to_vertex_index })) };
}

function roughObject(item, opacity = .7, color = 0x4b4842) {
  const group = new THREE.Group();
  [0, 1].forEach(layer => {
    const mat = material(layer, layer ? opacity * .22 : opacity);
    mat.uniforms.uColor.value.setHex(color);
    mat.uniforms.uJitter.value = layer ? .012 : .0035;
    group.add(new THREE.LineSegments(geometryFrom(item, layer), mat));
  });
  return group;
}

function segmentedItem(segments) {
  const vertices = [];
  const edges = [];
  segments.forEach(([a,b]) => {
    const offset = vertices.length;
    vertices.push({xyz_m:a},{xyz_m:b});
    edges.push({from_vertex_index:offset,to_vertex_index:offset+1});
  });
  return {vertices,edges};
}

function loopSegments(points) {
  return points.map((point,index) => [point,points[(index+1)%points.length]]);
}

function ellipseSegments(center, radiusX, radiusY, plane="xz", samples=12) {
  const points=[];
  for(let i=0;i<samples;i++) {
    const angle=i/samples*Math.PI*2;
    const [cx,cy,cz]=center;
    if(plane==="xz") points.push([cx+Math.cos(angle)*radiusX,cy,cz+Math.sin(angle)*radiusY]);
    else if(plane==="yz") points.push([cx,cy+Math.cos(angle)*radiusX,cz+Math.sin(angle)*radiusY]);
    else points.push([cx+Math.cos(angle)*radiusX,cy+Math.sin(angle)*radiusY,cz]);
  }
  return loopSegments(points);
}

function artifactFigurine(center,height=.42,lean=0) {
  const [x,y,z]=center;
  const group=new THREE.Group();
  const baseH=height*.08, headR=height*.085;
  group.add(roughObject(boxItem([x,y,z+baseH/2],[height*.22,height*.15,baseH]),.67,0x494640));
  const body=[
    [[x-height*.105,y,z+baseH],[x-height*.075+lean,y,z+height*.69]],
    [[x+height*.105,y,z+baseH],[x+height*.075+lean,y,z+height*.69]],
    [[x-height*.105,y,z+baseH],[x+height*.105,y,z+baseH]],
    [[x-height*.075+lean,y,z+height*.69],[x+height*.075+lean,y,z+height*.69]],
    [[x-height*.07,y,z+height*.42],[x+height*.07,y,z+height*.42]]
  ];
  group.add(roughObject(segmentedItem(body),.73,0x45423d));
  const head=[...ellipseSegments([x+lean,y,z+height*.79],headR,headR*1.12,"xz",10),...ellipseSegments([x+lean,y,z+height*.79],headR*.72,headR*1.12,"yz",8)];
  group.add(roughObject(segmentedItem(head),.73,0x45423d));
  return group;
}

function artifactAnimal(center,length=.22,height=.13) {
  const [x,y,z]=center;
  const group=roughObject(boxItem([x,y,z+height*.58],[length,length*.44,height*.55]),.62,0x55514a);
  group.add(roughObject(boxItem([x+length*.42,y,z+height*.78],[length*.24,length*.35,height*.32]),.6,0x55514a));
  [[-.32,-.14],[-.32,.14],[.28,-.14],[.28,.14]].forEach(([dx,dy])=>group.add(roughObject(segmentedItem([[[x+length*dx,y+length*dy,z+height*.38],[x+length*dx,y+length*dy,z]]]),.56,0x55514a)));
  return group;
}

function artifactPot(center,height=.2,radius=.105) {
  const [x,y,z]=center;
  const segments=[];
  const profile=[[.08,.42],[.28,.72],[.55,1],[.84,.78],[1,.48]];
  profile.forEach(([t,r])=>segments.push(...ellipseSegments([x,y,z+height*t],radius*r,radius*r,"xy",14)));
  for(let spoke=0;spoke<10;spoke++) {
    const angle=spoke/10*Math.PI*2;
    for(let level=0;level<profile.length-1;level++) {
      const [t0,r0]=profile[level], [t1,r1]=profile[level+1];
      segments.push([
        [x+Math.cos(angle)*radius*r0,y+Math.sin(angle)*radius*r0,z+height*t0],
        [x+Math.cos(angle)*radius*r1,y+Math.sin(angle)*radius*r1,z+height*t1]
      ]);
    }
  }
  return roughObject(segmentedItem(segments),.72,0x4c4943);
}

function artifactMounted(center,scale=.42) {
  const [x,y,z]=center;
  const group=new THREE.Group();
  group.add(roughObject(boxItem([x,y,z+scale*.25],[scale*.55,scale*.2,scale*.22]),.7,0x48453f));
  group.add(roughObject(boxItem([x+scale*.27,y,z+scale*.42],[scale*.16,scale*.18,scale*.25]),.66,0x48453f));
  [-.2,.18].forEach(dx=>[-.065,.065].forEach(dy=>group.add(roughObject(segmentedItem([[[x+scale*dx,y+scale*dy,z+scale*.16],[x+scale*dx,y+scale*dy,z]]]),.62,0x48453f))));
  group.add(artifactFigurine([x-scale*.04,y,z+scale*.34],scale*.56));
  return group;
}

function createWestNicheInterior(niche) {
  const group=new THREE.Group();
  group.name="西一号龛内部（PDF平面位置与线稿比例复原）";
  const box=boundsOf(niche);
  const floor=box.min.z+.025;
  const mouthY=box.min.y;
  const backY=box.max.y;
  const centerX=(box.min.x+box.max.x)/2;
  const sections=[];
  for(let section=0;section<=5;section++) {
    const t=section/5;
    const y=THREE.MathUtils.lerp(mouthY,backY,t);
    const halfWidth=THREE.MathUtils.lerp(.96,1.04,t);
    const ceiling=floor+1.6-(section===3?.06:0);
    const points=[[centerX-halfWidth,y,floor],[centerX-halfWidth,y,ceiling],[centerX+halfWidth,y,ceiling],[centerX+halfWidth,y,floor]];
    sections.push(points);
    group.add(roughObject(segmentedItem(points.slice(0,-1).map((p,i)=>[p,points[i+1]])),section===0?.72:.3,0x625b51));
  }
  for(let corner=0;corner<4;corner++) group.add(roughObject(polylineItem(sections.map(section=>section[corner])),.48,0x5b554d));

  const figurines=[
    ["风帽俑 M2338:6",1.24,1.08,.22,-.012],["风帽俑 M2338:15",1.48,1.13,.24,.01],
    ["风帽俑 M2338:16",1.72,1.18,.21,-.006],["女侍俑 M2338:8",1.92,1.23,.28,.008],
    ["笼冠俑 M2338:7",1.33,1.52,.21,.02],["笼冠俑 M2338:9",1.62,1.58,.23,-.018],
    ["笼冠俑 M2338:14",1.92,1.67,.22,.01],["风帽俑 M2338:17-1",1.48,2.15,.21,.01],
    ["风帽俑 M2338:17-2",1.83,2.35,.22,-.008],["笼冠俑 M2338:18",2.28,2.52,.21,.01],
    ["风帽俑 M2338:19",2.02,2.66,.205,-.006]
  ];
  figurines.forEach(([name,x,y,h,lean])=>{
    const figure=artifactFigurine([x,y,floor],h,lean);
    figure.name=name;
    group.add(figure);
  });
  const mounted=artifactMounted([2.37,1.45,floor],.27); mounted.name="骑马俑 M2338:12"; group.add(mounted);
  const mill=artifactPot([2.83,.98,floor],.23,.12); mill.name="陶磨 M2338:10"; group.add(mill);
  const sheep=artifactAnimal([2.78,1.92,floor],.21,.13); sheep.name="陶羊 M2338:11"; group.add(sheep);
  const chicken=artifactAnimal([2.35,2.28,floor],.13,.085); chicken.name="陶鸡 M2338:13"; group.add(chicken);
  group.userData.artifactIndex=group.children.filter(child=>child.name?.includes("M2338")).map(child=>child.name);
  group.userData.dataQuality="niche dimensions measured; artifact classes and relative zones from PDF fig.6; exact coordinates scaled from supplied frontal sketch";
  return group;
}

function createTombInterior(chamber) {
  const interior = new THREE.Group();
  interior.name = "墓室内部（依据简报近似复原）";
  const box = new THREE.Box3();
  chamber.vertices.forEach(vertex => box.expandByPoint(new THREE.Vector3(...vertex.xyz_m)));
  const floor = box.min.z + .08;
  const xSouth = box.min.x + .55;
  const xNorth = box.max.x - .45;
  const yEast = box.min.y + .42;
  const yWest = box.max.y - .48;

  // measured: coffin 2.64m long, 0.78-1m wide; bed height and thickness illustrative.
  interior.add(roughObject(boxItem([(xSouth+xNorth)/2, yWest-.05, floor+.22], [2.92, 1.16, .44]), .82));
  interior.add(roughObject(boxItem([(xSouth+xNorth)/2+.05, yWest-.05, floor+.55], [2.64, .9, .34]), .76, 0x57534c));

  // scaled-from-plan: northeast wooden box trace, 1.05m x 0.8m.
  interior.add(roughObject(boxItem([xNorth-.18, yEast+.08, floor+.18], [1.05, .8, .36]), .64, 0x6b6256));
  // scaled-from-plan: epitaph slab in the eastern/southeastern assemblage.
  interior.add(roughObject(boxItem([xSouth+.78, yEast+.48, floor+.075], [.68, .68, .15]), .78, 0x45433f));

  // Brick floor, illustrative spacing based on report's paving description.
  const floorLines = [];
  for (let x=xSouth-.15; x<=xNorth+.2; x+=.38) floorLines.push(x,box.min.y+.16,floor, x,box.max.y-.16,floor);
  for (let y=box.min.y+.18; y<=box.max.y-.16; y+=.38) floorLines.push(xSouth-.2,y,floor, xNorth+.25,y,floor);
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute("position", new THREE.Float32BufferAttribute(floorLines,3));
  const floorMat = new THREE.LineDashedMaterial({color:0x716b61,transparent:true,opacity:.22,dashSize:.16,gapSize:.08,depthWrite:false});
  const paving = new THREE.LineSegments(floorGeo,floorMat); paving.computeLineDistances(); interior.add(paving);

  // scaled-from-plan / illustrative: clustered grave goods in southeast and two guardians at entrance.
  const goods = [[.35,.18,.22],[.58,.42,.16],[.82,.2,.19],[1.02,.48,.14],[1.25,.24,.18],[1.43,.55,.15],[1.63,.28,.13]];
  goods.forEach(([dx,dy,h],i) => {
    const r=.07+(i%3)*.018;
    const item=boxItem([xSouth+dx,yEast+dy,floor+h/2],[r*2,r*2,h]);
    interior.add(roughObject(item,.5,0x686159));
  });
  [[xSouth+.18,box.min.y+.42],[xSouth+.2,box.max.y-.35]].forEach(([x,y]) => interior.add(roughObject(boxItem([x,y,floor+.33],[.2,.2,.66]),.65,0x4e4b45)));
  interior.userData.dataQuality = "mixed: measured, scaled-from-plan, illustrative";
  return interior;
}

function groundCompassLabel(text, color = "#9a493b") {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 256;
  labelCanvas.height = 128;
  const context = labelCanvas.getContext("2d");
  context.clearRect(0, 0, 256, 128);
  context.fillStyle = color;
  context.font = "56px Georgia, serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 128, 61);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(.62, .31, 1);
  sprite.renderOrder = 24;
  return sprite;
}

function addGroundCompass() {
  const box = new THREE.Box3().setFromObject(root);
  const min = box.min, max = box.max;
  const group = new THREE.Group();
  group.name = "ground-parallel-north-south-axis";
  const y = min.y - 1.18;
  const z = min.z - .06;
  const southX = min.x + .28;
  const northX = max.x - .22;
  const midX = (southX + northX) / 2;
  const linePositions = [
    southX, y, z, northX, y, z,
    midX, y - .18, z, midX, y + .18, z,
    southX, y - .1, z, southX, y + .1, z
  ];
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  const line = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x8f4537, transparent: true, opacity: .72, depthWrite: false }));
  line.renderOrder = 23;
  group.add(line);

  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(.13, .38, 3),
    new THREE.MeshBasicMaterial({ color: 0x8f4537, transparent: true, opacity: .78, depthWrite: false })
  );
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  arrow.position.set(northX + .16, y, z);
  arrow.renderOrder = 23;
  group.add(arrow);

  const north = groundCompassLabel("N", "#9a493b");
  north.position.set(northX + .55, y, z + .1);
  const south = groundCompassLabel("S", "#746b60");
  south.position.set(southX - .48, y, z + .1);
  group.add(north, south);

  const annotation = groundCompassLabel("墓道 S  /  墓室 N", "#6d6258");
  annotation.scale.set(1.6, .34, 1);
  annotation.position.set(midX, y - .38, z + .08);
  group.add(annotation);
  scene.add(group);
  groundCompass = group;
}

function addConstructionGuides() {
  const box = new THREE.Box3().setFromObject(root);
  const min = box.min, max = box.max;
  const zBase = min.z - .55;
  const zTop = max.z + .85;
  const yNear = min.y - .75;
  const yFar = max.y + .45;
  const lines = [
    min.x - .8, yNear, zBase, max.x + .8, yNear, zBase,
    min.x - .8, yFar, zBase, max.x + .8, yFar, zBase,
    min.x, yNear, zBase, min.x, yNear, zTop,
    max.x, yNear, zBase, max.x, yNear, zTop,
    min.x, yFar, zBase, min.x, yFar, zTop,
    max.x, yFar, zBase, max.x, yFar, zTop,
    min.x-1.8, yNear-1.1, zBase-.15, max.x, yNear, zTop,
    min.x-1.8, yNear-1.1, zBase-.15, max.x, yFar, zTop,
    max.x+2.1, yFar+1.0, zBase-.15, min.x, yNear, zTop,
    max.x+2.1, yFar+1.0, zBase-.15, min.x, yFar, zTop
  ];
  const guideMaterial = new THREE.LineDashedMaterial({ color: 0x706b61, transparent: true, opacity: .13, dashSize: .22, gapSize: .16, depthWrite: false });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  const guides = new THREE.LineSegments(geometry, guideMaterial);
  guides.computeLineDistances();
  guides.renderOrder = -2;
  perspectiveGuides = guides;
  scene.add(guides);
}

function fitView() {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = size.length() * .55;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(-radius * .85, radius * 1.25, radius * .7));
  camera.fov = 38;
  camera.updateProjectionMatrix();
  controls.update();
}

function dimensionLabel(text) {
  const canvas=document.createElement("canvas");
  canvas.width=512; canvas.height=128;
  const context=canvas.getContext("2d");
  context.clearRect(0,0,512,128);
  context.fillStyle="rgba(244,241,231,.92)";
  context.fillRect(28,24,456,80);
  context.strokeStyle="rgba(145,57,45,.7)";
  context.lineWidth=2;
  context.strokeRect(28,24,456,80);
  context.fillStyle="#453f38";
  context.font="44px Georgia, serif";
  context.textAlign="center";
  context.textBaseline="middle";
  context.fillText(text,256,65);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}));
  sprite.scale.set(1.15,.29,1);
  sprite.renderOrder=20;
  return sprite;
}

function clearMeasurements() {
  measurementGroup.traverse(child=>{
    child.geometry?.dispose?.();
    if(child.material?.map) child.material.map.dispose();
    child.material?.dispose?.();
  });
  measurementGroup.clear();
}

function addMeasurement(box,spec,index) {
  const offset=spec.offset ?? (.2+index*.035);
  const top=spec.level==="top";
  const z=top?box.max.z+offset:box.min.z-offset;
  let a,b,anchorA,anchorB,tickVector;
  if(spec.axis==="x") {
    const sideY=spec.side==="back"?box.max.y:box.min.y;
    const y=sideY+(spec.side==="back"?offset:-offset);
    a=new THREE.Vector3(box.min.x,y,z); b=new THREE.Vector3(box.max.x,y,z);
    anchorA=new THREE.Vector3(box.min.x,sideY,top?box.max.z:box.min.z);
    anchorB=new THREE.Vector3(box.max.x,sideY,top?box.max.z:box.min.z);
    tickVector=new THREE.Vector3(0,0,.11);
  } else if(spec.axis==="y") {
    const minSide=spec.side==="minx";
    const edgeX=minSide?box.min.x:box.max.x;
    const x=edgeX+(minSide?-offset:offset);
    const endY=spec.fraction?THREE.MathUtils.lerp(box.min.y,box.max.y,spec.fraction):box.max.y;
    a=new THREE.Vector3(x,box.min.y,z); b=new THREE.Vector3(x,endY,z);
    anchorA=new THREE.Vector3(edgeX,box.min.y,top?box.max.z:box.min.z);
    anchorB=new THREE.Vector3(edgeX,endY,top?box.max.z:box.min.z);
    tickVector=new THREE.Vector3(0,0,.11);
  } else {
    const x=box.max.x+offset, y=box.max.y+offset;
    a=new THREE.Vector3(x,y,box.min.z); b=new THREE.Vector3(x,y,box.max.z);
    anchorA=new THREE.Vector3(box.max.x,box.max.y,box.min.z);
    anchorB=new THREE.Vector3(box.max.x,box.max.y,box.max.z);
    tickVector=new THREE.Vector3(.11,0,0);
  }
  const segments=[a,b,anchorA,a,anchorB,b,a.clone().sub(tickVector),a.clone().add(tickVector),b.clone().sub(tickVector),b.clone().add(tickVector)];
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(segments.flatMap(point=>point.toArray()),3));
  const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x9a493b,transparent:true,opacity:.9,depthTest:false,depthWrite:false}));
  line.renderOrder=19;
  measurementGroup.add(line);
  const label=dimensionLabel(spec.label);
  label.position.copy(a).lerp(b,.5);
  label.position.add(spec.axis==="z"?new THREE.Vector3(.18,0,0):new THREE.Vector3(0,0,.06));
  measurementGroup.add(label);
}

function showMeasurements(index,selected) {
  clearMeasurements();
  if(index<0||!selected) return;
  const measures=STRUCTURE_MEASURES[index]||[];
  const box=new THREE.Box3().setFromObject(selected);
  measures.forEach((measure,measureIndex)=>addMeasurement(box,measure,measureIndex));
}

function narrativeEntryForStructure(index) {
  if (index < 0 || index === 9 || index === 10) return null;
  return NARRATIVE_ENTRIES.find(entry => CAMERA_PRESETS[entry.index]?.focus?.includes(index) || entry.index === index) || null;
}

function renderNarrativeCard(entry) {
  if (!entry) return;
  document.querySelector("#narrative-card-index").textContent = `${entry.no} / 07 · EXCAVATION BRIEF`;
  document.querySelector("#narrative-card-title").textContent = entry.name;
  document.querySelector("#narrative-card-subtitle").textContent = entry.title;
  document.querySelector("#narrative-card-summary").textContent = entry.summary;
  document.querySelector("#narrative-card-quote").textContent = `“${entry.quote}”`;
  const related = document.querySelector("#narrative-artifacts");
  const artifactNames = NARRATIVE_ARTIFACTS.get(entry.index) || [];
  related.replaceChildren();
  related.hidden = artifactNames.length === 0;
  if (artifactNames.length) {
    const label = document.createElement("span");
    label.textContent = "相关文物 · OBJECTS";
    related.append(label);
  }
  artifactNames.forEach(name => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.artifact = name;
    button.textContent = name;
    button.setAttribute("aria-label", `前往文物详情：${name}`);
    button.addEventListener("click", event => {
      event.stopPropagation();
      stopAutoDemo();
      spatialReturnState = captureSpatialContext();
      setView("artifacts", event, { source: "narrative" });
      activateArtifactByName(name, { force: true });
      scheduleAutoDemo();
    });
    related.append(button);
  });
}

function syncNarrativeAxis(index) {
  const entry = narrativeEntryForStructure(index);
  activeNarrativeIndex = entry?.index ?? -1;
  document.querySelectorAll(".narrative-node").forEach(button => {
    const active = Number(button.dataset.camera) === activeNarrativeIndex;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "step" : "false");
    button.setAttribute("aria-expanded", String(active && narrativeCardOpen));
  });
  if (!entry) {
    closeNarrativeCard();
    return;
  }
  if (narrativeCardOpen) renderNarrativeCard(entry);
}

function openNarrativeCard(entry) {
  if (!entry) return;
  narrativeCardOpen = true;
  activeNarrativeIndex = entry.index;
  renderNarrativeCard(entry);
  const card = document.querySelector("#narrative-card");
  card.classList.add("open");
  card.setAttribute("aria-hidden", "false");
  syncNarrativeAxis(entry.index);
}

function closeNarrativeCard() {
  if (!narrativeCardOpen) return false;
  narrativeCardOpen = false;
  const card = document.querySelector("#narrative-card");
  card?.classList.remove("open");
  card?.setAttribute("aria-hidden", "true");
  document.querySelectorAll(".narrative-node").forEach(button => button.setAttribute("aria-expanded", "false"));
  return true;
}

function setupNarrativeAxis() {
  const list = document.querySelector("#narrative-list");
  NARRATIVE_ENTRIES.forEach(entry => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "narrative-node";
    button.dataset.camera = entry.index;
    button.setAttribute("aria-controls", "narrative-card");
    button.setAttribute("aria-label", `${entry.no} ${entry.name} ${entry.title}`);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-current", "false");
    button.innerHTML = `<em>${entry.no}</em><span><b>${entry.name}</b><small>${entry.title}</small></span>`;
    button.addEventListener("click", event => {
      event.stopPropagation();
      noteUserActivity();
      openNarrativeCard(entry);
      navigateToStructure(entry.index, { source: "narrative" });
    });
    item.append(button);
    list.append(item);
  });
  document.querySelector("#narrative-close").addEventListener("click", event => {
    event.stopPropagation();
    closeNarrativeCard();
  });
  syncNarrativeAxis(selectedIndex);
}

function selectStructure(index, focusIndices = index < 0 ? [] : [index]) {
  selectedIndex = index;
  selectedFocusIndices = index < 0 ? [] : [...new Set(focusIndices)];
  objects.forEach(group => {
    const active = index < 0 || selectedFocusIndices.includes(group.userData.index);
    const isTheftShaft = group.userData.name === "D1" || group.userData.name === "D2";
    const { understroke, main, echoA, echoB } = group.userData.lines;
    understroke.material.opacity = index < 0 ? (isTheftShaft ? .26 : .12) : active ? .48 : .035;
    main.material.uniforms.uOpacity.value = index < 0 ? (isTheftShaft ? .62 : .3) : active ? .99 : .065;
    echoA.material.uniforms.uOpacity.value = index < 0 ? (isTheftShaft ? .18 : .09) : active ? .34 : .025;
    echoB.material.uniforms.uOpacity.value = index < 0 ? .075 : active ? .22 : .012;
    if (group.userData.interior) group.userData.interior.visible = index < 0 || active;
  });
  // Keep the post-JSON replacement skeleton appearance: only the 13 exported geometries render.
  if (naturalShell) naturalShell.visible = index < 0;
  if (sketchVolumeLayer) {
    sketchVolumeLayer.visible = true;
    sketchVolumeLayer.userData.opacityMaterials.forEach(material => {
      if (material.uniforms?.uOpacity) material.uniforms.uOpacity.value = material.userData.baseOpacity * (index < 0 ? 1 : .32);
      else material.opacity = material.userData.baseOpacity * (index < 0 ? 1 : .3);
    });
  }
  if (perspectiveGuides?.material) perspectiveGuides.material.opacity = index < 0 ? .11 : .045;
  setBurialGoodsOpacity(index < 0 || selectedFocusIndices.includes(0) ? 1 : .14);
  document.querySelectorAll("#structure-list button").forEach(button => {
    const buttonIndex = Number(button.dataset.index);
    const active = button.classList.contains("overall") ? index < 0 : buttonIndex === index;
    const contextActive = !button.classList.contains("overall") && !active && selectedFocusIndices.includes(buttonIndex);
    button.classList.toggle("active", active);
    button.classList.toggle("context-active", contextActive);
    button.setAttribute("aria-pressed", String(active || contextActive));
    if (active) {
      button.classList.remove("axis-hit");
      void button.offsetWidth;
      button.classList.add("axis-hit");
      const viewport = document.querySelector(".structure-plan-viewport");
      if (button.dataset.index && viewport?.scrollWidth > viewport.clientWidth) {
        const left = button.offsetLeft + button.offsetWidth / 2 - viewport.clientWidth / 2;
        viewport.scrollTo({ left, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    }
  });
  const selected = objects.find(group => group.userData.index === index);
  const focusNames = selectedFocusIndices.map(focusIndex => objects.find(group => group.userData.index === focusIndex)?.userData.name).filter(Boolean);
  const currentLabel = index < 0 ? "整体结构" : focusNames.join(" ＋ ") || selected?.userData.name || "结构";
  document.querySelector("#status").textContent = index < 0 ? "整体骨架 · 自由检查模式" : `${currentLabel} · 结构已突出`;
  showMeasurements(selectedFocusIndices.length === 1 ? index : -1, selectedFocusIndices.length === 1 ? selected : null);
  syncNarrativeAxis(index);
}

function buildControls(data) {
  const hotspots = document.querySelector("#structure-hotspots");
  const overallButton = document.querySelector(".structure-overall");
  overallButton.addEventListener("click", () => { noteUserActivity(); navigateToOverall(); });
  STRUCTURE_ORDER.forEach(index => {
    const placement = PLAN_HOTSPOTS.get(index);
    if (!placement) return;
    const item = data.geometries[index];
    if (!item.vertices.length) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "structure-hotspot";
    button.dataset.index = index;
    const label = item.name || FALLBACK_NAMES[index] || `结构 ${index + 1}`;
    const displayLabel = placement.secondary ? `盗洞${label.slice(1)}` : label;
    const accessibleLabel = displayLabel;
    button.setAttribute("aria-label", `查看${accessibleLabel}三维特写`);
    button.setAttribute("aria-pressed", "false");
    button.style.setProperty("--x", `${placement.x}%`);
    if (placement.secondary) {
      button.classList.add("secondary");
      button.style.setProperty("--y", "3%");
      button.style.setProperty("--w", "7%");
      button.style.setProperty("--h", "13%");
      const leader = document.createElement("i");
      leader.className = "structure-hotspot-leader";
      leader.setAttribute("aria-hidden", "true");
      leader.style.setProperty("--x", `${placement.x}%`);
      leader.style.setProperty("--target-y", `${placement.y}%`);
      hotspots.append(leader);
    } else {
      button.style.setProperty("--y", `${placement.y}%`);
      button.style.setProperty("--w", `${placement.w}%`);
      button.style.setProperty("--h", `${placement.h}%`);
    }
    const text = document.createElement("span");
    text.textContent = displayLabel;
    button.append(text);
    button.addEventListener("click", () => { noteUserActivity(); navigateToStructure(index); });
    hotspots.append(button);
  });
  document.querySelector("#reset-view").addEventListener("click", () => { noteUserActivity(); navigateToOverall(); });
}

function easeBreath(t) {
  const smooth = t * t * t * (t * (t * 6 - 15) + 10);
  return THREE.MathUtils.clamp(smooth + Math.sin(t * Math.PI) * .012, 0, 1);
}

function animateCamera(endPosition, endTarget, endFov, onComplete) {
  const token = ++cameraMoveToken;
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const startFov = camera.fov;
  const distance = startPosition.distanceTo(endPosition);
  const lift = THREE.MathUtils.clamp(distance * .04, .2, .7);
  const controlA = startPosition.clone().lerp(endPosition, .3).add(new THREE.Vector3(0, 0, lift));
  const controlB = startPosition.clone().lerp(endPosition, .7).add(new THREE.Vector3(0, 0, lift * .72));
  const curve = new THREE.CubicBezierCurve3(startPosition, controlA, controlB, endPosition);
  const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 220
    : THREE.MathUtils.clamp(760 + distance * 48, 1000, 1900);
  const started = performance.now();
  controls.enabled = false;
  document.querySelector("#status").textContent = "镜头移动中 · CAMERA IN MOTION";
  const step = now => {
    if (token !== cameraMoveToken) return;
    const raw = Math.min(1, (now - started) / duration);
    const t = easeBreath(raw);
    camera.position.copy(curve.getPoint(t));
    controls.target.lerpVectors(startTarget, endTarget, t);
    camera.fov = THREE.MathUtils.lerp(startFov, endFov, t);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    if (raw < 1) requestAnimationFrame(step);
    else {
      camera.position.copy(endPosition); controls.target.copy(endTarget); camera.fov = endFov; camera.updateProjectionMatrix(); controls.update(); controls.enabled = true;
      onComplete?.();
    }
  };
  requestAnimationFrame(step);
}

function applyResponsiveShotOffset(position, target) {
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
  const narrowFactor = THREE.MathUtils.clamp((1.1 - aspect) / .65, 0, 1);
  const narrativeFactor = narrativeCardOpen && aspect > .9 ? THREE.MathUtils.clamp((aspect - .9) / .55, 0, 1) : 0;
  if (!narrowFactor && !narrativeFactor) return;
  const distance = position.distanceTo(target);
  const forward = target.clone().sub(position).normalize();
  const screenRight = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const screenUp = new THREE.Vector3().crossVectors(screenRight, forward).normalize();
  const offset = screenRight.multiplyScalar(-distance * (.14 * narrowFactor + .12 * narrativeFactor))
    .add(screenUp.multiplyScalar(-distance * .04 * narrowFactor));
  position.add(offset);
  target.add(offset);
}

function navigateToStructure(index, options = {}) {
  const group = objects.find(item => item.userData.index === index);
  if (!group) return;
  if (options.auto) openNarrativeCard(narrativeEntryForStructure(index));
  const geometricTarget = structureTargets.get(index) || new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
  const bbox = new THREE.Box3().setFromObject(group);
  const size = bbox.getSize(new THREE.Vector3()).length();
  const preset = CAMERA_PRESETS[index];
  const focusIndices = preset?.focus || [index];
  const target = preset ? new THREE.Vector3(...preset.target) : geometricTarget;
  const endPosition = preset ? new THREE.Vector3(...preset.position) : target.clone().add(new THREE.Vector3(size * .8, -size * 1.15, size * .65));
  applyResponsiveShotOffset(endPosition, target);
  selectStructure(index, focusIndices);
  animateCamera(endPosition, target, preset?.fov || 42, () => {
    const focusNames = focusIndices.map(focusIndex => objects.find(item => item.userData.index === focusIndex)?.userData.name).filter(Boolean);
    document.querySelector("#status").textContent = `${focusNames.join(" ＋ ")} · ${focusNames.length > 1 ? "组合特写" : "特写视角"}`;
  });
}

function navigateToOverall(options = {}) {
  if (!overallView) return;
  closeNarrativeCard();
  selectStructure(-1);
  animateCamera(overallView.position.clone(), overallView.target.clone(), overallView.fov, () => {
    document.querySelector("#status").textContent = "整体结构 · OVERVIEW";
  });
}

function captureSpatialContext() {
  let snapshotPosition = camera.position.clone();
  let snapshotTarget = controls.target.clone();
  let snapshotFov = camera.fov;
  const pendingPreset = controls.enabled === false ? CAMERA_PRESETS[selectedIndex] : null;
  if (pendingPreset) {
    snapshotPosition = new THREE.Vector3(...pendingPreset.position);
    snapshotTarget = new THREE.Vector3(...pendingPreset.target);
    snapshotFov = pendingPreset.fov;
    applyResponsiveShotOffset(snapshotPosition, snapshotTarget);
  }
  return {
    selectedIndex,
    focusIndices: [...selectedFocusIndices],
    narrativeCardOpen,
    activeNarrativeIndex,
    cameraPosition: snapshotPosition.toArray(),
    cameraTarget: snapshotTarget.toArray(),
    cameraFov: snapshotFov
  };
}

function restoreSpatialContext(snapshot = spatialReturnState) {
  if (!snapshot) {
    navigateToOverall();
    return;
  }
  cameraMoveToken++;
  controls.enabled = true;
  camera.position.fromArray(snapshot.cameraPosition);
  controls.target.fromArray(snapshot.cameraTarget);
  camera.fov = snapshot.cameraFov;
  camera.updateProjectionMatrix();
  controls.update();
  selectStructure(snapshot.selectedIndex, snapshot.focusIndices);
  if (snapshot.narrativeCardOpen) {
    const entry = NARRATIVE_ENTRIES.find(item => item.index === snapshot.activeNarrativeIndex)
      || narrativeEntryForStructure(snapshot.selectedIndex);
    if (entry) openNarrativeCard(entry);
  } else {
    closeNarrativeCard();
  }
  spatialReturnState = null;
}

function isEpitaphModalOpen() {
  return document.querySelector("#epitaph-modal")?.getAttribute("aria-hidden") === "false";
}

function openEpitaphModal() {
  const modal = document.querySelector("#epitaph-modal");
  if (!modal) return;
  stopAutoDemo();
  modal.setAttribute("aria-hidden", "false");
  modal.querySelector(".epitaph-close")?.focus({ preventScroll: true });
}

function closeEpitaphModal(restoreFocus = false) {
  const modal = document.querySelector("#epitaph-modal");
  if (!modal || modal.getAttribute("aria-hidden") !== "false") return false;
  modal.setAttribute("aria-hidden", "true");
  if (restoreFocus && document.querySelector("#app")?.dataset.view === "artifacts") {
    document.querySelector("#artifact-details")?.focus({ preventScroll: true });
  }
  return true;
}

function clearAutoDemoTimer() {
  if (!autoDemoTimer) return;
  clearTimeout(autoDemoTimer);
  autoDemoTimer = 0;
}

function syncAutoDemoUi() {
  const app = document.querySelector("#app");
  const artifactPhase = autoDemoActive && autoDemoPhase === "artifacts";
  app?.classList.toggle("auto-demo", autoDemoActive);
  app?.classList.toggle("artifact-auto-demo", artifactPhase);
  document.querySelector(".artifact-playback-status")?.classList.toggle("active", artifactPhase);
}

function stopAutoDemo() {
  clearAutoDemoTimer();
  if (autoDemoActive && controls.enabled === false) {
    cameraMoveToken++;
    controls.enabled = true;
  }
  autoDemoActive = false;
  syncAutoDemoUi();
}

function scheduleAutoDemo(delay = AUTO_TIMING.idle) {
  clearAutoDemoTimer();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const view = document.querySelector("#app")?.dataset.view;
  if (!view || view === "home" || isEpitaphModalOpen()) return;
  autoDemoTimer = setTimeout(() => startAutoDemo(view === "artifacts" ? "artifacts" : "model"), delay);
}

function noteUserActivity() {
  stopAutoDemo();
  scheduleAutoDemo();
}

function startAutoDemo(phase, event) {
  const app = document.querySelector("#app");
  const view = app?.dataset.view;
  if (!app || view === "home" || isEpitaphModalOpen()) {
    scheduleAutoDemo(5000);
    return;
  }
  if ((phase || view) === "model" && controls.enabled === false) {
    scheduleAutoDemo(2500);
    return;
  }
  clearAutoDemoTimer();
  autoDemoActive = true;
  autoDemoPhase = phase || (view === "artifacts" ? "artifacts" : "model");
  autoDemoStep = 0;
  artifactAutoStep = 0;
  syncAutoDemoUi();
  const targetView = autoDemoPhase === "artifacts" ? "artifacts" : "model";
  const changedView = view !== targetView;
  if (changedView) setView(targetView, event, { source: "auto" });
  autoDemoTimer = setTimeout(runAutoDemoStep, changedView ? AUTO_TIMING.transition : 0);
}

function runAutoDemoStep() {
  if (!autoDemoActive) return;
  autoDemoTimer = 0;
  if (autoDemoPhase === "model") {
    if (autoDemoStep >= DEMO_ROUTE.length) {
      closeNarrativeCard();
      autoDemoPhase = "artifacts";
      artifactAutoStep = 0;
      syncAutoDemoUi();
      setView("artifacts", null, { source: "auto" });
      autoDemoTimer = setTimeout(runAutoDemoStep, AUTO_TIMING.transition);
      return;
    }
    const index = DEMO_ROUTE[autoDemoStep];
    autoDemoStep++;
    navigateToStructure(index, { auto: true });
    autoDemoTimer = setTimeout(runAutoDemoStep, AUTO_TIMING.model);
    return;
  }

  if (artifactAutoStep >= ARTIFACT_SEQUENCE.length || artifactTourButtons.length === 0) {
    autoDemoPhase = "model";
    autoDemoStep = 0;
    artifactAutoStep = 0;
    spatialReturnState = null;
    syncAutoDemoUi();
    setView("model", null, { source: "auto" });
    navigateToOverall({ auto: true });
    autoDemoTimer = setTimeout(runAutoDemoStep, AUTO_TIMING.restart);
    return;
  }
  const artifactName = ARTIFACT_SEQUENCE[artifactAutoStep];
  artifactAutoStep++;
  activateArtifactByName(artifactName, { force: true, auto: true });
  autoDemoTimer = setTimeout(runAutoDemoStep, AUTO_TIMING.artifact);
}

function playTransition(origin) {
  const veil = document.querySelector("#transition-veil");
  if (Number.isFinite(origin?.clientX) && Number.isFinite(origin?.clientY)) {
    veil.style.setProperty("--x", `${origin.clientX / innerWidth * 100}%`);
    veil.style.setProperty("--y", `${origin.clientY / innerHeight * 100}%`);
  } else {
    veil.style.setProperty("--x", "50%");
    veil.style.setProperty("--y", "50%");
  }
  veil.classList.remove("play"); void veil.offsetWidth; veil.classList.add("play");
}

function setView(view, event, options = {}) {
  if (!["home", "model", "artifacts"].includes(view)) return false;
  if (view !== "model") {
    if (controls.enabled === false) {
      cameraMoveToken++;
      controls.enabled = true;
    }
    closeNarrativeCard();
  }
  if (view !== "artifacts") closeEpitaphModal();
  playTransition(event);
  document.querySelectorAll(".page-layer").forEach(layer => { const active = layer.id === `${view}-page`; layer.classList.toggle("active", active); layer.setAttribute("aria-hidden", String(!active)); });
  const modelInterface = document.querySelector(".model-interface");
  const modelActive = view === "model";
  modelInterface?.setAttribute("aria-hidden", String(!modelActive));
  if (modelInterface) modelInterface.inert = !modelActive;
  document.querySelector("#app").dataset.view = view;
  if (view === "artifacts") document.querySelector("#artifacts-page")?.scrollTo({ top: 0, behavior: "auto" });
  return true;
}

function setupInterface() {
  const app = document.querySelector("#app");
  const veil = document.querySelector("#transition-veil");
  const modelInterface = document.querySelector(".model-interface");
  const modelInitiallyActive = app.dataset.view === "model";
  modelInterface.setAttribute("aria-hidden", String(!modelInitiallyActive));
  modelInterface.inert = !modelInitiallyActive;
  if (!veil.children.length) {
    for (let i = 0; i < 30; i++) {
      const particle = document.createElement("b");
      const angle = i / 30 * Math.PI * 2;
      const distance = 90 + (i % 7) * 22;
      particle.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      particle.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
      particle.style.setProperty("--delay", `${(i % 6) * 18}ms`);
      particle.style.setProperty("--size", `${2 + i % 4}px`);
      veil.append(particle);
    }
  }
  const homePage = document.querySelector("#home-page");
  const enterModel = event => {
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    stopAutoDemo();
    setView("model", event);
    scheduleAutoDemo();
  };
  homePage.addEventListener("click", enterModel);
  homePage.addEventListener("keydown", enterModel);
  setupNarrativeAxis();
  const stage = document.querySelector(".artifact-stage");
  const artifactImage = document.querySelector("#artifact-image");
  const artifactCatalog = {
    "镇墓兽": { en:"TOMB BEAST", asset:"/assets/artifacts/catalog/tomb-beast-east.png", location:"/assets/artifacts/location-tomb-beast.jpg", description:"泥质红陶模制，人面短柱冠，白地施红彩，胸前残留金箔痕迹。PDF 简报记载通高 36 cm，尺寸标注保留在此处，展示图按版面统一放大。", facts:[["编号","M2338:2"],["位置","墓室入口东侧"],["通高","36 cm"],["材质","泥质红陶"]], display:{ scale:1.12, x:"0%", y:"1%" } },
    "镇墓武士俑": { en:"GUARDIAN WARRIOR", asset:"/assets/artifacts/guardian-warrior-m2338-1.png", location:"/assets/artifacts/location-guardian-warrior.jpg", description:"镇墓武士俑身着明光铠甲，残留红、白彩及少量金箔痕迹，置于墓室入口附近。PDF 图版列为 M2338:1，当前简报页未列单件尺寸。", facts:[["编号","M2338:1"],["类别","镇墓武士俑"],["位置","墓室入口附近"],["尺寸","简报未列单件尺寸"]], display:{ scale:1.02, x:"0%", y:"0%" } },
    "墓志": { en:"EPITAPH", asset:"/assets/artifacts/catalog/epitaph-set.png", location:"/assets/artifacts/location-epitaph.jpg", description:"墓志由志盖与志石组成，青石质。志盖边长 30 cm、厚 8 cm；志石边长 37 cm、厚 8 cm，正文 23 行、满行 23 字，共 516 字。", facts:[["编号","M2338:52"],["志盖","边长 30 cm / 厚 8 cm"],["志石","边长 37 cm / 厚 8 cm"],["字数","516 字"]], display:{ scale:1.16, x:"0%", y:"0%" } },
    "铜钱": { en:"KAIYUAN COIN", asset:"/assets/artifacts/catalog/kaiyuan-coin.png", location:"/assets/artifacts/location-kaiyuan-coin.jpg", description:"圆形方孔钱，钱文为“开元通宝”。PDF 简报记载钱径 2.4 cm、穿径 0.8 cm，是墓葬断代的重要参照。", facts:[["编号","M2338:57-4"],["钱径","2.4 cm"],["穿径","0.8 cm"],["材质","铜"]], display:{ scale:1.42, x:"0%", y:"0%" } },
    "玻璃串珠": { en:"GLASS BEADS", asset:"/assets/artifacts/catalog/glass-beads.png", location:"/assets/artifacts/location-glass-beads.jpg", description:"玻璃串珠共 3 枚，绿色。PDF 简报记载直径 0.4-0.5 cm、孔径 0.3 cm，出自棺内北侧。", facts:[["编号","M2338:56"],["数量","3 枚"],["直径","0.4-0.5 cm"],["孔径","0.3 cm"]], display:{ scale:1.44, x:"0%", y:"0%" } },
    "贝壳": { en:"SHELL", asset:"/assets/artifacts/catalog/shell.png", location:"/assets/artifacts/location-shell.jpg", description:"天然贝壳随葬品，出自棺内北侧。PDF 简报记载最宽 4.5 cm、长 5.5 cm。", facts:[["编号","M2338:55"],["最宽","4.5 cm"],["长","5.5 cm"],["材质","贝壳"]], display:{ scale:1.44, x:"0%", y:"0%" } },
    "银环": { en:"SILVER RING", asset:"/assets/artifacts/catalog/silver-ring.png", location:"/assets/artifacts/location-silver-cup.jpg", description:"银环出自棺内北侧，扁圆环状。PDF 简报记载直径 1.8 cm。", facts:[["编号","M2338:54"],["类别","银环"],["直径","1.8 cm"],["材质","银"]], display:{ scale:1.34, x:"0%", y:"0%" } },
    "铜钵": { en:"BRONZE BOWL", asset:"/assets/artifacts/catalog/bronze-bowl.png", location:"/assets/artifacts/location-bronze-bowl.jpg", description:"铜钵敛口、深弧腹、圜底，器表饰数周暗弦纹。PDF 简报记载口径 13 cm、腹径 13.2 cm、底径 8.5 cm、通高 6 cm。", facts:[["编号","M2338:53"],["口径","13 cm"],["腹径","13.2 cm"],["通高","6 cm"]], display:{ scale:1.26, x:"0%", y:"2%" } },
    "骑马俑": { en:"MOUNTED FIGURINE", asset:"/assets/artifacts/catalog/mounted-figurine.png", location:"/assets/artifacts/location-mounted-figurine.jpg", description:"骑马俑主要出土于墓室东南隅。PDF 简报中 I 型标本 M2338:32 马体长 23.5 cm、通高 32 cm；II 型标本 M2338:44 马体长 24 cm、通高 32.5 cm。", facts:[["编号","M2338:29-32 等"],["I 型","长 23.5 cm / 通高 32 cm"],["II 型","长 24 cm / 通高 32.5 cm"],["类别","陶骑马俑"]], display:{ scale:1.12, x:"0%", y:"0%" } }
  };
  [...new Set(Object.values(artifactCatalog).map(({ asset }) => asset).filter(Boolean))].forEach(src => {
    const image = new Image();
    image.src = src;
    image.decode?.().catch(() => {});
  });
  const artifactButtons = [...document.querySelectorAll(".artifact-list button")];
  const artifactProgress = document.querySelector("#artifact-progress");
  const artifactPlaybackStatus = document.querySelector(".artifact-playback-status");
  const artifactDetails = document.querySelector("#artifact-details");
  artifactTourButtons = artifactButtons;
  const activateArtifact = (button, options = {}) => {
    if (!button) return false;
    if (activeArtifactName === button.dataset.artifact && !options.force) return false;
    activeArtifactName = button.dataset.artifact;
    const artifact = artifactCatalog[button.dataset.artifact];
    const artifactIndex = Math.max(0, artifactButtons.indexOf(button));
    artifactButtons.forEach(item => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-current", active ? "true" : "false");
    });
    document.querySelector(".artifact-copy h2 span").textContent = button.dataset.artifact;
    document.querySelector("#artifact-name-en").textContent = artifact?.en || "SELECTED OBJECT";
    document.querySelector(".artifact-copy>p:not(.artifact-kicker)").textContent = artifact?.description || `${button.dataset.artifact}的详细考古信息将依据发掘简报继续补充。`;
    artifactProgress.textContent = `${String(artifactIndex + 1).padStart(2, "0")} / ${String(artifactButtons.length).padStart(2, "0")}`;
    artifactPlaybackStatus.style.setProperty("--progress", `${(artifactIndex + 1) / artifactButtons.length * 100}%`);
    artifactDetails.hidden = button.dataset.artifact !== "墓志";
    const asset = artifact?.asset;
    stage.classList.toggle("has-image", Boolean(asset));
    const display = artifact?.display || {};
    stage.style.setProperty("--artifact-scale", display.scale ?? 1);
    stage.style.setProperty("--artifact-x", display.x || "0%");
    stage.style.setProperty("--artifact-y", display.y || "0%");
    if (asset) {
      artifactImage.src = asset;
      artifactImage.alt = `${button.dataset.artifact}考古文物图像`;
    }
    stage.classList.remove("swap");
    requestAnimationFrame(() => stage.classList.add("swap"));
    if (options.auto || options.source === "narrative") {
      button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    return true;
  };
  activateArtifactByName = (name, options = {}) => {
    const button = artifactButtons.find(item => item.dataset.artifact === name);
    return activateArtifact(button, { ...options, source: options.source || "linked" });
  };
  artifactButtons.forEach(button => {
    button.addEventListener("pointerenter", () => {
      if (!autoDemoActive) activateArtifact(button);
    });
    button.addEventListener("click", () => {
      noteUserActivity();
      activateArtifact(button, { force: true });
    });
  });
  activateArtifact(document.querySelector(".artifact-list button.active") || artifactButtons[0], { force: true });

  document.querySelector("#start-artifacts-playback").addEventListener("click", event => {
    event.stopPropagation();
    stopAutoDemo();
    spatialReturnState = captureSpatialContext();
    startAutoDemo("artifacts", event);
  });
  document.querySelector("#return-space").addEventListener("click", event => {
    event.stopPropagation();
    stopAutoDemo();
    setView("model", event, { source: "manual" });
    restoreSpatialContext();
    scheduleAutoDemo();
  });
  artifactDetails.addEventListener("click", event => {
    event.stopPropagation();
    openEpitaphModal();
  });
  document.querySelector(".epitaph-close").addEventListener("click", event => {
    event.stopPropagation();
    if (closeEpitaphModal(true)) scheduleAutoDemo();
  });
  const canParallax = matchMedia("(pointer:fine) and (prefers-reduced-motion:no-preference)").matches;
  document.addEventListener("pointermove", event => {
    noteUserActivity();
    if (!canParallax) return;
    pointer.x = event.clientX / innerWidth - .5; pointer.y = event.clientY / innerHeight - .5;
    canvas.style.transform = `translate3d(${pointer.x * 3}px,${pointer.y * 2}px,0)`;
    stage.style.transform = `rotateY(${pointer.x * 5}deg) rotateX(${-pointer.y * 3}deg)`;
  });
  ["pointerdown", "wheel", "touchstart"].forEach(type => document.addEventListener(type, noteUserActivity, { passive: true }));
  controls.addEventListener("start", noteUserActivity);
  document.addEventListener("keydown", event => {
    noteUserActivity();
    if (event.key === "Escape") {
      if (closeEpitaphModal(true)) { scheduleAutoDemo(); return; }
      if (closeNarrativeCard()) return;
      if (app.dataset.view === "artifacts") {
        setView("model", event, { source: "keyboard" });
        restoreSpatialContext();
        scheduleAutoDemo();
        return;
      }
      if (app.dataset.view === "model") navigateToOverall();
      return;
    }
    if (app.dataset.view !== "model") return;
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    if (event.key === "Home" || event.key === "0") { navigateToOverall(); return; }
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const current = order.indexOf(selectedIndex);
    const next = current < 0 ? (direction > 0 ? 0 : order.length - 1) : (current + direction + order.length) % order.length;
    navigateToStructure(order[next]);
  });
  scheduleAutoDemo();
}

function bindSlider(id, callback) {
  const input = document.querySelector(`#${id}`);
  const output = document.querySelector(`#${id}-value`);
  input.addEventListener("input", () => { output.value = input.value; callback(Number(input.value)); });
}
bindSlider("density", value => objects.forEach(group => { const active = selectedIndex < 0 || selectedFocusIndices.includes(group.userData.index); const { understroke, main } = group.userData.lines; main.material.uniforms.uOpacity.value = active ? value / 100 : value / 600; understroke.material.opacity = active ? value / 245 : value / 900; }));
bindSlider("jitter", value => objects.forEach(group => [group.userData.lines.main, group.userData.lines.echoA, group.userData.lines.echoB].forEach((line, i) => line.material.uniforms.uJitter.value = value / 9000 * (i + 1))));
bindSlider("grain", value => document.querySelector(".paper-grain").style.opacity = value / 100);

async function init() {
  const response = await fetch("/geometry-export.json?v=20260711-new-13");
  if (!response.ok) throw new Error("无法读取 geometry-export.json");
  const data = await response.json();
  data.geometries.forEach(addStructure);
  data.geometries.forEach((item, index) => {
    if (item.vertices.length) structureTargets.set(index, boundsOf(item).getCenter(new THREE.Vector3()));
  });
  naturalShell = buildNaturalShell(data);
  sketchVolumeLayer = buildSketchVolumeLayer(data);
  groundLayer = buildGroundLayer(data);
  sketchVolumeLayer.renderOrder = -1;
  scene.add(sketchVolumeLayer, naturalShell, groundLayer);
  addConstructionGuides();
  addGroundCompass();
  buildControls(data);
  fitView();
  overallView = { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
  selectStructure(-1);
  setupInterface();
  const summary = document.querySelector("#geometry-summary");
  summary.textContent = `${data.summary.vertex_count} vertices / ${data.summary.edge_count} edges / loading artifacts`;
  loadBurialGoods().then(burialGoodsCount => {
    setBurialGoodsOpacity(selectedIndex < 0 || selectedIndex === 0 ? 1 : .14);
    summary.textContent = `${data.summary.vertex_count} vertices / ${data.summary.edge_count} edges / ${burialGoodsCount} artifacts`;
  }).catch(error => {
    summary.textContent = `${data.summary.vertex_count} vertices / ${data.summary.edge_count} edges / artifacts unavailable`;
    console.error("Burial goods could not be loaded", error);
  });
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  if (canvas.width !== clientWidth * renderer.getPixelRatio() || canvas.height !== clientHeight * renderer.getPixelRatio()) {
    renderer.setSize(clientWidth, clientHeight, false);
    wideMaterials.forEach(material => material.resolution.set(clientWidth, clientHeight));
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }
}
function animate() { resize(); controls.update(); renderer.render(scene, camera); requestAnimationFrame(animate); }

init().catch(error => { document.querySelector("#status").textContent = error.message; console.error(error); });
animate();
