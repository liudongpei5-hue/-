import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import defaultNarrativeCardLayout from "./narrative-card-layout.json";
import {
  ARTIFACT_SEQUENCE,
  DEMO_ROUTE,
  NARRATIVE_ARTIFACTS,
  artifactLinksForEntry,
  buildNarrativePlaybackSequence,
  normalizeArtifactLink,
  playbackResumeIndex
} from "./narrative-playback.js";

const FALLBACK_NAMES = ["墓室", "甬道", "第三天井", "第三过洞", "第二天井", "第二过洞", "第一天井", "第一过洞", "墓道", "D2", "D1", "东壁龛", "西壁龛"];
const MAIN_VISUAL_MODEL_PATH = "/models/lady-lu-tomb-sketch.glb";
const BURIAL_GOODS_OVERVIEW_PATH = "/models/burial-goods-overview";
const PRIORITY_VISUAL_MODEL_IDS = new Set(["lu_1", "lu_2", "lu_3", "lu_4", "lu_7", "lu_28", "lu_32", "lu_39", "lu_45"]);
const ARTIFACT_IMAGE_ASSETS = [
  "/assets/artifacts/catalog/tomb-beast-east.png",
  "/assets/artifacts/guardian-warrior-m2338-1.png",
  "/assets/artifacts/catalog/epitaph-set.png",
  "/assets/artifacts/catalog/kaiyuan-coin.png",
  "/assets/artifacts/catalog/glass-beads.png",
  "/assets/artifacts/catalog/shell.png",
  "/assets/artifacts/catalog/silver-ring.png",
  "/assets/artifacts/catalog/bronze-bowl.png",
  "/assets/artifacts/catalog/mounted-figurine.png",
  "/assets/artifacts/catalog/female-mounted-figurine.png"
];
const artifactImagePreloads = new Map();

function preloadArtifactImage(src) {
  if (!src) return Promise.resolve(null);
  if (!artifactImagePreloads.has(src)) {
    const image = new Image();
    const ready = new Promise((resolve, reject) => {
      image.addEventListener("load", () => {
        const decoded = image.decode ? image.decode().catch(() => {}) : Promise.resolve();
        decoded.then(() => resolve(image));
      }, { once: true });
      image.addEventListener("error", () => reject(new Error(`Artifact image could not load: ${src}`)), { once: true });
    });
    image.src = src;
    artifactImagePreloads.set(src, ready);
  }
  return artifactImagePreloads.get(src);
}

// Begin warming the complete artifact image set while the landing page is visible.
ARTIFACT_IMAGE_ASSETS.forEach(src => preloadArtifactImage(src).catch(error => console.error(error)));
const canvas = document.querySelector("#scene");
const sceneHomeParent = canvas.parentNode;
const sceneHomeNextSibling = canvas.nextSibling;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.up.set(0, 0, 1);
scene.fog = new THREE.Fog(0xf2efe5, 12, 48);
scene.add(new THREE.HemisphereLight(0xf8efe0, 0x6f6255, 2.2));
const artifactKeyLight = new THREE.DirectionalLight(0xfff4df, 2.8);
artifactKeyLight.position.set(3.5, -5.5, 7.5);
scene.add(artifactKeyLight);
const artifactFillLight = new THREE.DirectionalLight(0xd7e8ff, .9);
artifactFillLight.position.set(-5.5, 4.5, 3.2);
scene.add(artifactFillLight);
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 500);
const SPATIAL_CAMERA_UP = new THREE.Vector3(0, 0, 1);
camera.up.copy(SPATIAL_CAMERA_UP);
camera.position.set(20, -25, 18);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minPolarAngle = THREE.MathUtils.degToRad(12);
controls.maxPolarAngle = THREE.MathUtils.degToRad(76);
controls.minDistance = 5;
controls.maxDistance = 80;
controls.enablePan = true;
controls.panSpeed = .85;
controls.screenSpacePanning = false;
controls.touches.ONE = THREE.TOUCH.ROTATE;
controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

const Z_UP = new THREE.Vector3(0, 0, 1);
const scratchSpherical = new THREE.Spherical();

function normalizeGroundedCameraView(position = camera.position, target = controls.target) {
  // The artifact detail view intentionally uses a top-down Y-up camera. Applying
  // the grounded Z-up constraint here would fight that transition at the pole.
  if (artifactMiniState) return;
  const offset = position.clone().sub(target);
  if (offset.lengthSq() === 0) return;
  scratchSpherical.setFromVector3(offset);
  const phi = THREE.MathUtils.clamp(scratchSpherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
  if (Math.abs(phi - scratchSpherical.phi) > 1e-5 || camera.up.distanceToSquared(Z_UP) > 1e-8) {
    scratchSpherical.phi = phi;
    offset.setFromSpherical(scratchSpherical);
    position.copy(target).add(offset);
    camera.up.copy(Z_UP);
  }
}

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

function createSketchPipeline() {
  const colorTarget = new THREE.WebGLRenderTarget(1, 1, {
    samples: innerWidth < 900 ? 0 : 2,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.SRGBColorSpace
  });
  colorTarget.depthTexture = new THREE.DepthTexture(1, 1);
  colorTarget.depthTexture.format = THREE.DepthFormat;
  colorTarget.depthTexture.type = THREE.UnsignedShortType;
  const normalTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat
  });
  const normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const compositeMaterial = new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    uniforms: {
      tDiffuse: { value: colorTarget.texture },
      tDepth: { value: colorTarget.depthTexture },
      tNormal: { value: normalTarget.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uTime: { value: 0 },
      uMoving: { value: 0 },
      uPaper: { value: new THREE.Color(0xf2efe5) },
      uInk: { value: new THREE.Color(0x24231f) }
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){
        vUv=uv;
        gl_Position=vec4(position.xy,0.0,1.0);
      }`,
    fragmentShader: `
      #include <packing>
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform sampler2D tNormal;
      uniform vec2 uResolution;
      uniform float uNear;
      uniform float uFar;
      uniform float uTime;
      uniform float uMoving;
      uniform vec3 uPaper;
      uniform vec3 uInk;
      varying vec2 vUv;
      float hash(vec2 p){
        p=fract(p*vec2(123.34,456.21));
        p+=dot(p,p+45.32);
        return fract(p.x*p.y);
      }
      float linearDepth(vec2 uv){
        float fragCoordZ=texture2D(tDepth,uv).x;
        float viewZ=perspectiveDepthToViewZ(fragCoordZ,uNear,uFar);
        return viewZToOrthographicDepth(viewZ,uNear,uFar);
      }
      float depthEdge(vec2 uv, vec2 px){
        float c=linearDepth(uv);
        float e=0.0;
        e=max(e,abs(c-linearDepth(uv+vec2(px.x,0.0))));
        e=max(e,abs(c-linearDepth(uv-vec2(px.x,0.0))));
        e=max(e,abs(c-linearDepth(uv+vec2(0.0,px.y))));
        e=max(e,abs(c-linearDepth(uv-vec2(0.0,px.y))));
        return smoothstep(0.0015,0.012,e);
      }
      float normalEdge(vec2 uv, vec2 px){
        vec3 n=texture2D(tNormal,uv).xyz;
        float e=0.0;
        e=max(e,distance(n,texture2D(tNormal,uv+vec2(px.x,0.0)).xyz));
        e=max(e,distance(n,texture2D(tNormal,uv-vec2(px.x,0.0)).xyz));
        e=max(e,distance(n,texture2D(tNormal,uv+vec2(0.0,px.y)).xyz));
        e=max(e,distance(n,texture2D(tNormal,uv-vec2(0.0,px.y)).xyz));
        return smoothstep(0.11,0.42,e);
      }
      void main(){
        vec2 px=1.0/uResolution;
        vec4 source=texture2D(tDiffuse,vUv);
        float d=linearDepth(vUv);
        float mist=smoothstep(0.08,0.72,d);
        float grain=hash(floor((vUv*uResolution+uTime*vec2(.7,.27))*1.15));
        float fiberA=sin((vUv.x*920.0+vUv.y*210.0)+grain*2.5);
        float fiberB=sin((vUv.y*760.0-vUv.x*120.0)+grain*1.7);
        float paperTooth=(grain-.5)*0.09+fiberA*0.018+fiberB*0.012;
        float strokeMask=smoothstep(0.02,0.82,source.a);
        float edge=max(depthEdge(vUv,px)*1.65,normalEdge(vUv,px)*.98);
        float diagonal=max(depthEdge(vUv,px*vec2(1.45,1.45))*.62,normalEdge(vUv,px*vec2(1.25,1.25))*.42);
        edge=max(edge,diagonal);
        float broken=edge*(0.62+grain*.58)*(1.0-mist*.34);
        vec3 paper=uPaper+vec3(paperTooth);
        float tone=dot(source.rgb,vec3(.299,.587,.114));
        float pencilShade=smoothstep(.94,.34,tone)*strokeMask*(1.0-mist*.34);
        vec3 washed=mix(paper,source.rgb,.72*strokeMask*(1.0-mist*.04));
        float graphite=max(broken*(1.08+uMoving*.14),pencilShade*.46);
        graphite*=.9+.1*smoothstep(.08,.0,abs(hash(floor(vUv*uResolution*.48))-grain));
        vec3 color=mix(washed,uInk,graphite);
        color=mix(color,paper,.035+mist*.045);
        float vignette=smoothstep(.92,.22,length(vUv-.5));
        color=mix(paper*0.94,color,.88+vignette*.12);
        gl_FragColor=vec4(color,1.0);
      }`
  });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial));
  let lastCameraPosition = new THREE.Vector3();
  let moving = 0;
  return {
    setSize(width, height) {
      const ratio = Math.min(renderer.getPixelRatio(), innerWidth < 900 ? 1.15 : 1.5);
      const w = Math.max(1, Math.floor(width * ratio));
      const h = Math.max(1, Math.floor(height * ratio));
      colorTarget.setSize(w, h);
      normalTarget.setSize(w, h);
      compositeMaterial.uniforms.uResolution.value.set(w, h);
    },
    render(now) {
      const cameraDelta = camera.position.distanceTo(lastCameraPosition);
      moving = THREE.MathUtils.lerp(moving, Math.min(1, cameraDelta * 2.4), .08);
      lastCameraPosition.copy(camera.position);
      compositeMaterial.uniforms.uTime.value = now * .001;
      compositeMaterial.uniforms.uMoving.value = moving;
      renderer.setRenderTarget(colorTarget);
      renderer.clear();
      renderer.render(scene, camera);
      const previousOverride = scene.overrideMaterial;
      scene.overrideMaterial = normalMaterial;
      renderer.setRenderTarget(normalTarget);
      renderer.clear();
      renderer.render(scene, camera);
      scene.overrideMaterial = previousOverride;
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    }
  };
}

const sketchPipeline = createSketchPipeline();

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
let structuralSkeletonLayer;
let mainVisualModel;
let continuousVolumeLayer;
let groundLayer;
let sketchVolumeLayer;
let burialGoodsLayer;
let artifactLocationLayer;
let artifactLocationMarker;
let artifactLocationHalo;
let artifactLocationRegion;
let artifactMiniState = null;
let artifactMiniCameraToken = 0;
let artifactStageViewer;
let groundCompass;
let overallView;
let cameraMoveToken = 0;
let cameraDestination = null;
let autoDemoTimer = 0;
let autoDemoActive = false;
let autoDemoStep = 0;
let activateArtifactByName = () => false;
let activeArtifactName = "";
let activeArtifactLocationKey = "";
let artifactDetailOpen = false;
let spatialReturnState = null;
let artifactReturnFocus = null;
let selectedFocusIndices = [];
let narrativeCardOpen = false;
let activeNarrativeId = "";
let narrativeCardLayout = null;
const NARRATIVE_LAYOUT_STORAGE_KEY = "tang-tomb:narrative-card-layout:v1";
const NARRATIVE_CARD_VIEWPORT_GAP = 12;
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
const ARTIFACT_SPATIAL_LOCATIONS = {
  "镇墓兽": {
    anchor: [6.660727, -.147213, -4.12], markerLift: .48, certainty: "exact",
    objectId: "M2338:4", label: "墓室入口东侧"
  },
  "镇墓武士俑": {
    anchor: [6.347242, -.241987, -4.12], markerLift: .75, certainty: "exact",
    objectId: "M2338:1", label: "墓室入口东侧"
  },
  "墓志": {
    anchor: [6.616647, .334414, -4.12], markerLift: .22, certainty: "exact",
    objectId: "M2338:52", label: "墓室入口处"
  },
  "铜钱": {
    anchor: [8.277409, 1.913510, -4.12], markerLift: .16, certainty: "exact-group",
    objectId: "M2338:57", label: "棺内北侧区域"
  },
  "玻璃串珠": {
    anchor: [8.593945, 1.660852, -4.12], markerLift: .16, certainty: "exact-group",
    objectId: "M2338:56", label: "棺内北侧"
  },
  "贝壳": {
    anchor: [8.180024, 1.462007, -4.12], markerLift: .18, certainty: "exact",
    objectId: "M2338:55", label: "棺内北侧"
  },
  "银环": {
    anchor: [8.853829, 1.526160, -4.12], markerLift: .16, certainty: "exact",
    objectId: "M2338:54", label: "棺内北侧"
  },
  "铜钵": {
    anchor: [8.207321, -.342109, -4.12], markerLift: .18, certainty: "exact",
    objectId: "M2338:53", label: "墓室东壁下偏中"
  },
  "骑马俑": {
    anchor: [7.209323, .067355, -4.12], markerLift: .44, certainty: "exact-representative",
    objectId: "M2338:32", label: "墓室东南隅",
    region: {
      center: [7.326338, .218220, -4.12],
      min: [6.765752, -.292051, -4.12],
      max: [7.761191, .736571, -4.12],
      count: 11
    }
  },
  "风帽俑": {
    anchor: [6.446369, -.523154, -4.12], markerLift: .32, certainty: "exact-representative",
    objectId: "M2338:7", label: "墓室东南隅"
  },
  "笼冠俑": {
    anchor: [7.452989, -.321002, -4.12], markerLift: .32, certainty: "exact-representative",
    objectId: "M2338:19", label: "墓室东南隅"
  },
  "女侍俑": {
    anchor: [7.495089, .534270, -4.12], markerLift: .38, certainty: "exact-representative",
    objectId: "M2338:45", label: "墓室中部"
  },
  "陶羊": {
    anchor: [7.288550, .065395, -4.12], markerLift: .20, certainty: "exact",
    objectId: "M2338:39", label: "墓室中部偏东"
  }
};
const ARTIFACT_CONTEXT_LOCATIONS = {
  "niches:骑马俑": {
    anchor: [2.387010, 1.854025, -2.35], markerLift: .44, certainty: "exact",
    objectId: "WK12", label: "西壁龛 · WK12"
  },
  "niches:风帽俑": {
    anchor: [1.513310, 1.690346, -2.35], markerLift: .32, certainty: "exact-group",
    objectId: "WK6 等", label: "西壁龛",
    region: {
      center: [1.515752, 1.727839, -2.35],
      min: [1.133048, 1.349145, -2.35],
      max: [1.898456, 2.106532, -2.35],
      count: 6
    }
  },
  "niches:笼冠俑": {
    anchor: [1.306479, 1.462135, -2.35], markerLift: .32, certainty: "exact-group",
    objectId: "WK7 等", label: "西壁龛",
    region: {
      center: [1.889147, 2.032896, -2.35],
      min: [1.306479, 1.462135, -2.35],
      max: [2.471814, 2.603656, -2.35],
      count: 4
    }
  },
  "niches:女侍俑": {
    anchor: [2.215077, 2.179755, -2.35], markerLift: .38, certainty: "exact",
    objectId: "WK8", label: "西壁龛 · WK8"
  },
  "niches:陶羊": {
    anchor: [2.794790, 1.639739, -2.35], markerLift: .20, certainty: "exact",
    objectId: "WK11", label: "西壁龛 · WK11"
  }
};
const AUTO_TIMING = {
  model: 8200,
  artifact: 4800,
  epitaph: 6500,
  transition: 1050,
  restart: 2200,
  idle: 9000
};
const NARRATIVE_ENTRIES = [
  {
    id: "hongduyuan", no: "01", name: "洪渎原纪年墓", title: "664年 · 一条19.88米的地下轴线",
    cameraIndex: -1, mode: "overall", focusIndices: [], triggerIndices: [-1],
    summary: "2021年，M2338在咸阳机场三期扩建考古中出土。墓志记卢夫人于661年去世，三年后迁葬洪渎原，文中并记有“哀子玄瑾”；明确的年代，让这座中型唐墓成为观察初唐关中葬制的空间坐标。",
    quote: "该墓葬系一座斜坡墓道、三天井单室土洞墓，整体平面略呈“刀”形，方向176°，水平全长19.88米，墓底距现地表深8.32米。",
    artifacts: NARRATIVE_ARTIFACTS.hongduyuan
  },
  {
    id: "ramp", no: "02", name: "墓道", title: "由地表向北下行",
    cameraIndex: 8, focusIndices: [8], triggerIndices: [8],
    summary: "入口位于墓葬最南端。南宽北窄的长斜坡以27°向地下深入，壁面残留白灰刷饰，却没有发现壁画；它是整条地下轴线的第一段。",
    quote: "墓道，位于该墓葬最南端，略呈南宽北窄梯形状……最深处距现地表3.32米，斜坡27°，壁面光滑，可见白灰刷饰残留。",
    artifacts: NARRATIVE_ARTIFACTS.ramp
  },
  {
    id: "shaft-sequence", no: "03", name: "三重井洞", title: "六段相接 · 三次见天",
    cameraIndex: 4, mode: "overall", focusIndices: [2, 3, 4, 5, 6, 7], triggerIndices: [2, 3, 4, 5, 6, 7],
    summary: "三段斜向拱顶过洞延续墓道坡度，三座上下贯通的天井插入其间。封闭土洞与竖向开口交替，使向北行进不再是重复的六次停顿，而成为一组完整的空间节奏。",
    quote: "过洞3个，均为斜向拱顶土洞……底面与墓道底面为同一斜坡。天井3个，平面均呈南北向长方形，上下贯通。",
    artifacts: NARRATIVE_ARTIFACTS["shaft-sequence"]
  },
  {
    id: "niches", no: "04", name: "东西壁龛", title: "第三过洞两侧的器物空间",
    cameraIndex: 11, focusIndices: [3, 11, 12], triggerIndices: [11, 12],
    summary: "最后一段过洞向两侧展开壁龛：东龛为拱顶平底，西龛则口部小、内部大。两种尺度不同的侧向空间共同容纳随葬品，其中东龛后来受到盗洞D1的严重扰动。",
    quote: "壁龛2个，均位于第三过洞内……东一号龛为拱顶平底土洞结构；西一号龛为平顶底土洞结构，口部小，内部大。",
    artifacts: NARRATIVE_ARTIFACTS.niches
  },
  {
    id: "threshold", no: "05", name: "甬道与封门", title: "斜坡终止后的最后边界",
    cameraIndex: 1, focusIndices: [1], triggerIndices: [1],
    summary: "越过第三天井，行进由斜坡转入平底甬道。甬道中部原有土坯封门，虽已坍塌，仍标示出墓室与外部通道之间最后一道实体边界。",
    quote: "甬道，南接第三天井，北侧与墓室相连，拱顶土洞，保存完整，平底……封门位于甬道中部，土坯封堵，均已坍塌。",
    artifacts: NARRATIVE_ARTIFACTS.threshold
  },
  {
    id: "chamber", no: "06", name: "北端墓室", title: "西侧棺床 · 东南隅器物群",
    cameraIndex: 0, focusIndices: [0], triggerIndices: [0],
    summary: "拱顶墓室位于轴线最北端：木棺南北向置于西侧砖砌棺床，墓主头向北；百件随葬品则主要集中在墓室东南隅与壁龛，镇墓武士俑、镇墓兽分列入口两侧，墓志也出自入口处。",
    quote: "随葬品共计100件……随葬品大多数出土于墓室的东南隅和壁龛，墓室内东北隅有一处木箱残留遗迹。",
    artifacts: NARRATIVE_ARTIFACTS.chamber
  },
  {
    id: "epitaph", no: "07", name: "墓志与墓主", title: "661年去世 · 664年迁葬",
    cameraIndex: 0, focusIndices: [0], triggerIndices: [0], primary: false,
    summary: "墓室入口的青石墓志以516字连接空间与人物：墓主为范阳卢氏，丈夫早逝后长期寡居并抚育幼子。简报认为“李将军魏公”与李密生平相契合，但其具体身份仍存疑。",
    quote: "魏公早随运往，积祀孀居……抚育孤幼，羽翮已成。以麟德元年十一月廿八日迁葬于洪渎原。",
    artifacts: NARRATIVE_ARTIFACTS.epitaph
  },
  {
    id: "theft", no: "08", name: "两处盗洞", title: "D1至壁龛 · D2抵墓室",
    cameraIndex: 10, mode: "overall", focusIndices: [9, 10], triggerIndices: [9, 10],
    summary: "两次早期盗扰选择了最短路径：D1从第三天井直抵壁龛，严重扰动东龛；D2垂直打穿甬道北侧顶部，直接抵达墓室。它们也是今天理解遗物缺失与保存差异的重要空间证据。",
    quote: "盗洞D1……位于第三天井上口，打破天井两壁直抵壁龛位置所在。盗洞D2……位于甬道北侧，垂直打破甬道顶部后直抵墓室。",
    artifacts: NARRATIVE_ARTIFACTS.theft
  }
];
const VISUAL_PROCESS_STEPS = [
  ["体量", "测绘几何生成连续墓葬面片，作为 NPR 的深度和法线来源"],
  ["NPR", "颜色、深度、法线三次采样合成铅笔线和纸面明暗"],
  ["纸感", "屏幕空间纸纹参与线条断裂、深度雾化和石墨颗粒"],
  ["镜头", "总览和特写统一固定在墓葬同一侧，避免东西两侧跳切"],
  ["性能", "第一屏只加载代表性随葬品模型，其余点位用铅笔代理"]
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
  0: { position: [1.35, 17.8, 6.25], target: [7.7, .98, -2.72], fov: 57, focus: [0] },
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
const STRUCTURE_SHOT_OFFSETS = {
  default: [-7.2, 9.4, 5.2],
  0: [-8.6, 10.4, 6.2],
  1: [-6.2, 8.1, 4.5],
  2: [-6.8, 8.8, 4.9],
  3: [-6.8, 8.8, 4.9],
  4: [-6.8, 8.8, 4.9],
  5: [-6.8, 8.8, 4.9],
  6: [-6.8, 8.8, 4.9],
  7: [-6.8, 8.8, 4.9],
  8: [-9.8, 11.8, 6.6],
  9: [-5.6, 7.2, 4.1],
  10: [-5.6, 7.2, 4.1],
  11: [-5.2, 6.8, 3.3],
  12: [-5.2, 6.8, 3.3]
};
const STRUCTURE_SHOT_FOV = {
  0: 45,
  1: 37,
  2: 39,
  3: 39,
  4: 39,
  5: 39,
  6: 39,
  7: 39,
  8: 42,
  9: 35,
  10: 35,
  11: 34,
  12: 34
};

const vertexShader = `
uniform float uJitter;
uniform float uLayer;
varying float vGrain;
varying float vViewDepth;
float hash(vec3 p) { p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
void main(){
  float n=hash(position*7.31+vec3(uLayer*13.7));
  vec3 displaced=position+normal*0.0;
  displaced.x += (n-.5)*uJitter*uLayer;
  displaced.z += (hash(position.zyx*9.17)-.5)*uJitter*uLayer;
  vGrain=hash(position*17.9+vec3(uLayer));
  vec4 mvPosition=modelViewMatrix*vec4(displaced,1.0);
  vViewDepth=abs(mvPosition.z);
  gl_Position=projectionMatrix*mvPosition;
}`;
const fragmentShader = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uLayer;
varying float vGrain;
varying float vViewDepth;
void main(){
  float graphite=.72+.28*sin(vGrain*37.0+uLayer*2.0);
  float distanceMist=smoothstep(24.0,68.0,vViewDepth);
  vec3 paper=vec3(.72,.69,.62);
  vec3 ink=mix(uColor,paper,distanceMist*.24);
  float alpha=uOpacity*graphite*(1.0-distanceMist*.22);
  gl_FragColor=vec4(ink,alpha);
}`;


function material(layer, opacity, options = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: options.depthWrite ?? false,
    depthTest: options.depthTest ?? false,
    uniforms: {
      uColor: { value: new THREE.Color(options.color ?? (layer === 0 ? 0x34332f : 0x625d54)) },
      uOpacity: { value: opacity },
      uJitter: { value: options.jitter ?? (layer === 0 ? 0 : 0.012) },
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
    const hiddenPairs = new Set(["0:1", "0:2", "1:3", "2:3"]);
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

function geometryFrom(item, layer = 0, edges = renderedEdges(item)) {
  const positions = [];
  edges.forEach((edge, edgeIndex) => {
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

function floatingInteriorGuideGeometry(item, index) {
  const box = boundsOf(item);
  const vaulted = [0, 1, 3, 5, 7].includes(index);
  const positions = [];
  const push = (a, b) => positions.push(...a, ...b);

  if (index === 11 || index === 12) {
    const floorZ = box.min.z + .035;
    const roofZ = box.max.z;
    const mouthY = index === 11 ? box.max.y : box.min.y;
    const backY = index === 11 ? box.min.y : box.max.y;
    const x0 = box.min.x;
    const x1 = box.max.x;
    const addOpenNicheSide = x => {
      push([x, mouthY, floorZ], [x, backY, floorZ]);
      push([x, backY, floorZ], [x, backY, roofZ]);
      push([x, backY, roofZ], [x, mouthY, roofZ]);
      push([x, mouthY, roofZ], [x, mouthY, floorZ]);
    };
    addOpenNicheSide(x0);
    addOpenNicheSide(x1);
    push([x0, backY, floorZ], [x1, backY, floorZ]);
    push([x0, backY, roofZ], [x1, backY, roofZ]);
    push([x0, mouthY, roofZ], [x1, mouthY, roofZ]);
    push([x0, mouthY, floorZ], [x1, mouthY, floorZ]);
    const xMid = (x0 + x1) / 2;
    push([xMid, mouthY, floorZ], [xMid, backY, floorZ]);
    push([xMid, mouthY, roofZ], [xMid, backY, roofZ]);
    push([xMid, backY, floorZ], [xMid, backY, roofZ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }

  const floorZ = box.min.z + .035;
  const roofZ = box.max.z;
  const springZ = vaulted ? box.max.z - (index === 0 ? .78 : .46) : box.max.z;
  const yMid = (box.min.y + box.max.y) / 2;

  // Floor and shoulder rails describe the internal space without drawing
  // full vertical section rectangles that read as stitched wall panels.
  [box.min.y, box.max.y].forEach(y => {
    push([box.min.x, y, floorZ], [box.max.x, y, floorZ]);
    push([box.min.x, y, springZ], [box.max.x, y, springZ]);
  });
  push([box.min.x, yMid, floorZ], [box.max.x, yMid, floorZ]);
  [.28, .72].forEach(t => {
    const y = THREE.MathUtils.lerp(box.min.y, box.max.y, t);
    push([box.min.x, y, floorZ], [box.max.x, y, floorZ]);
    push([box.min.x, y, springZ], [box.max.x, y, springZ]);
  });

  if (vaulted) {
    const samples = 10;
    [box.min.x, (box.min.x + box.max.x) / 2, box.max.x].forEach((x, archIndex) => {
      let previous = null;
      for (let sample = 0; sample <= samples; sample++) {
        const t = sample / samples;
        const y = THREE.MathUtils.lerp(box.min.y, box.max.y, t);
        const z = springZ + Math.sin(t * Math.PI) * (roofZ - springZ);
        const point = [x, y, z - archIndex % 2 * .015];
        if (previous) push(previous, point);
        previous = point;
      }
    });
    push([box.min.x, yMid, roofZ], [box.max.x, yMid, roofZ]);
  } else {
    push([box.min.x, box.min.y, roofZ], [box.max.x, box.min.y, roofZ]);
    push([box.min.x, box.max.y, roofZ], [box.max.x, box.max.y, roofZ]);
    push([box.min.x, yMid, roofZ], [box.max.x, yMid, roofZ]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function addStructure(item, index) {
  if (!item.vertices.length || !item.edges.length) return;
  const group = new THREE.Group();
  group.userData = { index, name: item.name || FALLBACK_NAMES[index] || `结构 ${index + 1}` };
  group.userData.depthCenter = boundsOf(item).getCenter(new THREE.Vector3());
  const main = new THREE.LineSegments(geometryFrom(item, 0), material(0, .9));
  const echoA = new THREE.LineSegments(geometryFrom(item, 1), material(1, .32));
  const echoB = new THREE.LineSegments(geometryFrom(item, 2), material(2, .2));
  const surveySkeleton = new THREE.LineSegments(
    geometryFrom(item, 0, surveyEdges(item)),
    material(5, 1, { depthTest: false, color: 0x0f0f0d, jitter: .001 })
  );
  surveySkeleton.name = "floating-survey-skeleton";
  surveySkeleton.renderOrder = 16;
  const surveyWideGeometry = new LineSegmentsGeometry();
  surveyWideGeometry.setPositions(surveySkeleton.geometry.attributes.position.array);
  const surveyWideMaterial = new LineMaterial({
    color: 0x0f0f0d,
    linewidth: index === 11 || index === 12 ? 3.8 : 3.05,
    transparent: true,
    opacity: .96,
    depthWrite: false,
    depthTest: false
  });
  const surveyWide = new LineSegments2(surveyWideGeometry, surveyWideMaterial);
  surveyWide.name = "floating-survey-skeleton-wide";
  surveyWide.renderOrder = 15;
  surveyWide.computeLineDistances();
  wideMaterials.push(surveyWideMaterial);
  const profileSkeleton = new THREE.LineSegments(
    floatingInteriorGuideGeometry(item, index),
    material(6, .78, { depthTest: false, color: 0x151411, jitter: .0015 })
  );
  profileSkeleton.name = "floating-profile-skeleton";
  profileSkeleton.renderOrder = 15;
  const profileWideGeometry = new LineSegmentsGeometry();
  profileWideGeometry.setPositions(profileSkeleton.geometry.attributes.position.array);
  const profileWideMaterial = new LineMaterial({
    color: 0x151411,
    linewidth: index === 11 || index === 12 ? 4.2 : 3.35,
    transparent: true,
    opacity: .78,
    depthWrite: false,
    depthTest: false
  });
  const profileWide = new LineSegments2(profileWideGeometry, profileWideMaterial);
  profileWide.name = "floating-profile-skeleton-wide";
  profileWide.renderOrder = 14;
  profileWide.computeLineDistances();
  wideMaterials.push(profileWideMaterial);
  const xray = new THREE.LineSegments(
    geometryFrom(item, 3, surveyEdges(item)),
    material(3, .52, { depthTest: false, color: 0x221f1b, jitter: .008 })
  );
  xray.name = "xray-pencil-interior";
  xray.renderOrder = 9;
  const xraySoft = new THREE.LineSegments(
    geometryFrom(item, 4, surveyEdges(item)),
    material(4, .28, { depthTest: false, color: 0x5d5449, jitter: .018 })
  );
  xraySoft.name = "xray-pencil-interior-soft";
  xraySoft.renderOrder = 8;
  const accent = item.name === "D1" ? 0x8f574a : item.name === "D2" ? 0x4d6f78 : 0x37342f;
  if (item.name === "D1" || item.name === "D2") {
    main.material.uniforms.uColor.value.setHex(accent);
    echoA.material.uniforms.uColor.value.setHex(accent);
    echoB.material.uniforms.uColor.value.setHex(accent);
    surveySkeleton.material.uniforms.uColor.value.setHex(accent);
    surveyWide.material.color.setHex(accent);
    profileSkeleton.material.uniforms.uColor.value.setHex(accent);
    profileWide.material.color.setHex(accent);
    xray.material.uniforms.uColor.value.setHex(accent);
    xraySoft.material.uniforms.uColor.value.setHex(accent);
  }
  const wideGeometry = new LineSegmentsGeometry();
  wideGeometry.setPositions(main.geometry.attributes.position.array);
  const wideMaterial = new LineMaterial({ color: accent, linewidth: 2.15, transparent: true, opacity: .5, depthWrite: false });
  const understroke = new LineSegments2(wideGeometry, wideMaterial);
  understroke.computeLineDistances();
  wideMaterials.push(wideMaterial);
  main.material.uniforms.uJitter.value = .003;
  [main, echoA, echoB, surveySkeleton, profileSkeleton].forEach((line, order) => {
    line.material.depthTest = false;
    line.renderOrder = 12 + order;
  });
  understroke.material.depthTest = false;
  understroke.renderOrder = 11;
  surveySkeleton.renderOrder = 16;
  group.userData.lines = { understroke, main, echoA, echoB, surveySkeleton, surveyWide, profileSkeleton, profileWide, xray, xraySoft };
  group.add(xraySoft, xray, understroke, main, echoA, echoB, profileWide, profileSkeleton, surveyWide, surveySkeleton);
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

function createArtifactStageViewer(canvas) {
  const previewWidth = 640;
  const previewHeight = 880;
  const context = canvas.getContext("2d");
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const previewScene = new THREE.Scene();
  const previewCamera = new THREE.PerspectiveCamera(28, previewWidth / previewHeight, .01, 100);
  const pivot = new THREE.Group();
  previewScene.add(pivot);
  previewScene.add(new THREE.HemisphereLight(0xfff8ec, 0x6d6258, 2.6));
  const key = new THREE.DirectionalLight(0xffecd6, 3.4);
  key.position.set(4, 6, 7);
  previewScene.add(key);
  const fill = new THREE.DirectionalLight(0xdbe8f2, 1.5);
  fill.position.set(-5, 2, 4);
  previewScene.add(fill);
  const rim = new THREE.DirectionalLight(0xe7b89a, 1.2);
  rim.position.set(2, 3, -5);
  previewScene.add(rim);

  const loader = new GLTFLoader();
  const modelPromises = new Map();
  const previewCache = new Map();
  const renderTarget = new THREE.WebGLRenderTarget(previewWidth, previewHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true
  });
  renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
  let requestToken = 0;

  function frameModel(model) {
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return false;
    const initialSize = box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(3.2 / Math.max(initialSize.y, .001));
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.y -= box.min.y;
    model.position.z -= center.z;
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    box.getSize(size);

    const target = new THREE.Vector3(0, size.y * .48, 0);
    const verticalFov = THREE.MathUtils.degToRad(previewCamera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * previewCamera.aspect);
    const fitHeight = size.y / (2 * Math.tan(verticalFov / 2));
    const fitWidth = Math.max(size.x, size.z) / (2 * Math.tan(horizontalFov / 2));
    const distance = Math.max(fitHeight, fitWidth) * 1.56;
    const direction = new THREE.Vector3(.72, .12, 1).normalize();
    previewCamera.position.copy(target).addScaledVector(direction, distance);
    previewCamera.near = Math.max(.01, distance / 100);
    previewCamera.far = distance * 10;
    previewCamera.lookAt(target);
    previewCamera.updateProjectionMatrix();
    return true;
  }

  function paintPreview(imageData) {
    context.clearRect(0, 0, previewWidth, previewHeight);
    context.putImageData(imageData, 0, 0);
  }

  function renderPreview(modelId, model) {
    pivot.rotation.y = modelId === "lu_39" ? .68 : 1.12;
    const previousTarget = renderer.getRenderTarget();
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(previewScene, previewCamera);
    const pixels = new Uint8Array(previewWidth * previewHeight * 4);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, previewWidth, previewHeight, pixels);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);

    const flipped = new Uint8ClampedArray(pixels.length);
    const rowLength = previewWidth * 4;
    for (let y = 0; y < previewHeight; y++) {
      const sourceStart = (previewHeight - 1 - y) * rowLength;
      flipped.set(pixels.subarray(sourceStart, sourceStart + rowLength), y * rowLength);
    }
    const imageData = new ImageData(flipped, previewWidth, previewHeight);
    previewCache.set(modelId, imageData);
    return imageData;
  }

  async function show(modelId) {
    const token = ++requestToken;
    pivot.clear();
    if (!modelId) return false;
    if (previewCache.has(modelId)) {
      paintPreview(previewCache.get(modelId));
      return true;
    }
    if (!modelPromises.has(modelId)) {
      modelPromises.set(modelId, loader.loadAsync(`${BURIAL_GOODS_OVERVIEW_PATH}/${modelId}.glb`).then(gltf => gltf.scene));
    }
    const source = await modelPromises.get(modelId);
    if (token !== requestToken) return false;
    const model = source.clone(true);
    model.traverse(child => {
      if (!child.isMesh || !child.material) return;
      child.material = Array.isArray(child.material)
        ? child.material.map(material => material.clone())
        : child.material.clone();
    });
    pivot.add(model);
    if (!frameModel(model)) return false;
    paintPreview(renderPreview(modelId, model));
    return true;
  }

  return {
    show,
    clear() {
      requestToken++;
      pivot.clear();
      context.clearRect(0, 0, previewWidth, previewHeight);
    }
  };
}

function tuneArtifactMaterials(model, opacityMaterials) {
  model.traverse(child => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = false;
    child.renderOrder = 240;
    const source = child.material || new THREE.MeshStandardMaterial();
    const material = source.clone();
    material.transparent = true;
    material.opacity = 1;
    material.depthWrite = false;
    material.depthTest = false;
    material.roughness = Math.max(material.roughness ?? .75, .64);
    material.metalness = Math.min(material.metalness ?? 0, .08);
    material.toneMapped = false;
    material.userData.baseOpacity = material.opacity;
    if (material.color && !material.map) material.color.lerp(new THREE.Color(0xb98f66), .28);
    if ("envMapIntensity" in material) material.envMapIntensity = .8;
    child.material = material;
    opacityMaterials.push(material);
  });
}

function tuneMainVisualModel(model) {
  model.name = "lady-lu-tomb-sketch-main-visual";
  model.traverse(child => {
    child.frustumCulled = false;
    child.renderOrder = Math.max(child.renderOrder || 0, 120);
    if (!child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(source => {
      source.userData.baseOpacity = source.opacity ?? 1;
      source.transparent = source.transparent || source.opacity < 1;
      source.depthWrite = false;
      source.depthTest = false;
      source.toneMapped = false;
      if ("linewidth" in source && !source.linewidth) source.linewidth = 1;
      source.needsUpdate = true;
    });
  });
  model.updateMatrixWorld(true);
}

function setMainVisualModelFocus(index) {
  if (!mainVisualModel) return;
  const opacityScale = index < 0 ? 1 : .46;
  mainVisualModel.traverse(child => {
    if (!child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => {
      const baseOpacity = material.userData.baseOpacity ?? material.opacity ?? 1;
      material.opacity = baseOpacity * opacityScale;
      material.transparent = true;
      material.needsUpdate = true;
    });
  });
}

async function loadMainVisualModel() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(MAIN_VISUAL_MODEL_PATH);
  const wrapper = new THREE.Group();
  wrapper.name = "lady-lu-tomb-sketch-axis-adapter";
  const model = gltf.scene;
  // Blender/glTF is Y-up here; the site geometry is Z-up. This maps source Y to site Z
  // and source Z to the site's south-north plane without changing the measured origin.
  model.rotation.x = Math.PI / 2;
  tuneMainVisualModel(model);
  wrapper.add(model);
  wrapper.updateMatrixWorld(true);
  scene.add(wrapper);
  mainVisualModel = wrapper;
  if (structuralSkeletonLayer) structuralSkeletonLayer.visible = false;
  return wrapper;
}

async function loadBurialGoods() {
  const [pointsResponse] = await Promise.all([
    fetch("/data/burial-goods-points.json")
  ]);
  if (!pointsResponse.ok) throw new Error("无法读取随葬品点位数据");
  const pointData = await pointsResponse.json();
  const annotations = pointData.points
    .filter(point => point.properties?.["三维模型"] && point.worldXYZ)
    .sort((a, b) => Number(a.properties?.["平面图编号"] || 0) - Number(b.properties?.["平面图编号"] || 0));
  const modelIds = [...new Set(annotations.map(point => point.properties["三维模型"]))]
    .filter(modelId => PRIORITY_VISUAL_MODEL_IDS.has(modelId));
  const loader = new GLTFLoader();
  const library = new Map();
  await Promise.all(modelIds.map(async modelId => {
    const gltf = await loader.loadAsync(`${BURIAL_GOODS_OVERVIEW_PATH}/${modelId}.glb`);
    library.set(modelId, gltf.scene);
  }));

  const layer = new THREE.Group();
  layer.name = "随葬品三维模型与点位";
  layer.userData.opacityMaterials = [];
  const chamberCenter = structureTargets.get(0) || new THREE.Vector3(7.6, .8, -4.12);
  annotations.forEach((annotation, index) => {
    const source = library.get(annotation.properties["三维模型"]);
    const anchor = annotation.worldXYZ;
    const targetHeight = Number(annotation.properties?.["高度"]) || .22;
    const instance = new THREE.Group();
    instance.name = `${annotation.properties?.["器号"] || annotation.properties?.["平面图编号"]} ${annotation.properties?.["具体名称"] || ""}`;
    instance.position.set(anchor.x, anchor.y, anchor.z + .018);
    instance.rotation.z = Math.atan2(chamberCenter.y - anchor.y, chamberCenter.x - anchor.x) - Math.PI / 2 + (index % 5 - 2) * .045;
    if (source) {
      const model = source.clone(true);
      normalizeArtifactModel(model, targetHeight);
      tuneArtifactMaterials(model, layer.userData.opacityMaterials);
      instance.add(model);
    } else {
      const proxy = createArtifactProxy(targetHeight);
      layer.userData.opacityMaterials.push(...proxy.userData.opacityMaterials);
      instance.add(proxy);
    }
    const marker = createPointMarker(annotation);
    layer.userData.opacityMaterials.push(...marker.userData.opacityMaterials);
    instance.add(marker);
    layer.add(instance);
  });
  scene.add(layer);
  burialGoodsLayer = layer;
  if (artifactMiniState) burialGoodsLayer.visible = false;
  return annotations.length;
}

function createArtifactProxy(targetHeight) {
  const group = new THREE.Group();
  const radius = THREE.MathUtils.clamp(targetHeight * .22, .035, .08);
  const geometry = new THREE.CircleGeometry(radius, 18);
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x8f6d52,
    transparent: true,
    opacity: .42,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  });
  fillMaterial.userData.baseOpacity = fillMaterial.opacity;
  const disc = new THREE.Mesh(geometry, fillMaterial);
  disc.rotation.x = Math.PI / 2;
  disc.renderOrder = 232;
  const ringMaterial = new THREE.LineBasicMaterial({
    color: 0x514940,
    transparent: true,
    opacity: .62,
    depthWrite: false,
    depthTest: false
  });
  ringMaterial.userData.baseOpacity = ringMaterial.opacity;
  const ring = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.renderOrder = 234;
  group.add(disc, ring);
  group.userData.opacityMaterials = [fillMaterial, ringMaterial];
  return group;
}

function createVisualProcessPanel() {
  if (visualProcessPanel) return visualProcessPanel;
  const style = document.createElement("style");
  style.textContent = `
    .visual-process-panel{position:absolute;right:18px;top:104px;z-index:34;width:min(300px,calc(100vw - 42px));max-height:calc(100dvh - 190px);overflow:hidden;border:1px solid rgba(58,50,42,.18);background:rgba(244,240,229,.66);backdrop-filter:blur(12px);box-shadow:0 18px 55px rgba(52,42,31,.1);color:#2d2924;font:11px/1.55 "DengXian","Microsoft YaHei",sans-serif;transition:transform .45s cubic-bezier(.16,1,.3,1),opacity .35s}
    .visual-process-panel.collapsed{transform:translateX(calc(100% - 42px))}
    .visual-process-panel.collapsed:hover,.visual-process-panel.collapsed:focus-within{transform:translateX(0)}
    .visual-process-panel header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 13px 10px;border-bottom:1px solid rgba(70,62,52,.16)}
    .visual-process-panel h3{margin:0;font:13px/1.2 "Noto Serif SC","Songti SC",serif;font-weight:600;letter-spacing:.04em}
    .visual-process-panel small{display:block;margin-top:3px;color:#8f4537;font:8px/1.2 Arial,sans-serif;letter-spacing:.16em}
    .visual-process-panel button{width:24px;height:24px;border:1px solid rgba(143,69,55,.32);background:rgba(246,242,232,.5);color:#8f4537;cursor:pointer}
    .visual-process-panel ol{display:grid;gap:7px;margin:0;padding:12px 13px 8px;list-style:none}
    .visual-process-panel li{display:grid;grid-template-columns:44px 1fr;gap:9px;align-items:start;padding-bottom:7px;border-bottom:1px solid rgba(70,62,52,.1)}
    .visual-process-panel b{color:#8f4537;font:10px/1.5 Arial,sans-serif;letter-spacing:.12em}
    .visual-process-panel span{color:#575047}
    .visual-process-panel .visual-log{margin:0;padding:9px 13px 13px;max-height:92px;overflow:auto;color:#71685f;font:10px/1.7 "DengXian","Microsoft YaHei",sans-serif}
    .visual-process-panel .visual-log p{margin:0 0 4px}
    @media(max-width:800px){.visual-process-panel{right:12px;top:84px;width:min(300px,calc(100vw - 24px));max-height:44dvh}.visual-process-panel ol{display:none}}
  `;
  document.head.append(style);
  const panel = document.createElement("aside");
  panel.className = "visual-process-panel collapsed";
  panel.setAttribute("aria-label", "主视觉迭代过程");
  panel.innerHTML = `
    <header>
      <div><h3>主视觉迭代面板</h3><small>NPR PROCESS / LIVE NOTES</small></div>
      <button type="button" aria-label="折叠主视觉迭代面板">‹</button>
    </header>
    <ol>${VISUAL_PROCESS_STEPS.map(([label, text]) => `<li><b>${label}</b><span>${text}</span></li>`).join("")}</ol>
    <div class="visual-log" aria-live="polite"></div>
  `;
  panel.querySelector("button").addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    panel.querySelector("button").textContent = panel.classList.contains("collapsed") ? "›" : "‹";
  });
  document.querySelector("#app").append(panel);
  visualProcessPanel = panel;
  logVisualProcess("面板已接入：当前显示主视觉管线、镜头和加载状态");
  return panel;
}

function logVisualProcess(message) {
  void message;
}

function setLineLayerOpacity(line, opacity) {
  if (!line?.material) return;
  line.material.userData.selectionOpacity = opacity;
  if (line.material.uniforms?.uOpacity) line.material.uniforms.uOpacity.value = opacity;
  else line.material.opacity = opacity;
}

function applyDepthAwareLineOpacity() {
  if (!objects.length) return;
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection);
  const depths = objects.map(group => group.userData.depthCenter.clone().sub(camera.position).dot(cameraDirection));
  const minDepth = Math.min(...depths);
  const maxDepth = Math.max(...depths);
  const span = Math.max(maxDepth - minDepth, .001);
  objects.forEach((group, groupIndex) => {
    const depth01 = THREE.MathUtils.clamp((depths[groupIndex] - minDepth) / span, 0, 1);
    const exteriorScale = THREE.MathUtils.lerp(1.16, .86, depth01);
    const interiorScale = THREE.MathUtils.lerp(1.28, .82, depth01);
    const softScale = THREE.MathUtils.lerp(1.08, .64, depth01);
    const lines = group.userData.lines || {};
    [[lines.understroke, exteriorScale], [lines.main, exteriorScale], [lines.echoA, softScale], [lines.echoB, softScale],
      [lines.surveySkeleton, exteriorScale], [lines.surveyWide, exteriorScale],
      [lines.profileSkeleton, interiorScale], [lines.profileWide, interiorScale],
      [lines.xray, interiorScale], [lines.xraySoft, softScale]].forEach(([line, scale]) => {
        if (!line?.material) return;
        const base = line.material.userData.selectionOpacity ?? (line.material.uniforms?.uOpacity?.value ?? line.material.opacity ?? 0);
        if (line.material.uniforms?.uOpacity) line.material.uniforms.uOpacity.value = base * scale;
        else line.material.opacity = base * scale;
      });
  });
}

function surveyEdges(item) {
  if (item.name === "墓道" || item.name === FALLBACK_NAMES[8]) return renderedEdges(item);
  return item.edges;
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

function createArtifactLocationLayer() {
  if (artifactLocationLayer) return artifactLocationLayer;
  const red = 0xa43b2e;
  const layer = new THREE.Group();
  layer.name = "第二幕文物空间定位";
  layer.visible = false;

  const marker = new THREE.Group();
  const floorHalo = new THREE.Mesh(
    new THREE.RingGeometry(.16, .27, 40),
    new THREE.MeshBasicMaterial({ color: red, transparent: true, opacity: .26, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
  );
  floorHalo.position.z = .025;
  floorHalo.renderOrder = 80;
  marker.add(floorHalo);

  const floorCore = new THREE.Mesh(
    new THREE.CircleGeometry(.075, 32),
    new THREE.MeshBasicMaterial({ color: red, transparent: true, opacity: .94, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
  );
  floorCore.position.z = .03;
  floorCore.renderOrder = 82;
  marker.add(floorCore);

  const stemGeometry = new THREE.BufferGeometry();
  stemGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, .04, 0, 0, .48], 3));
  const stem = new THREE.Line(
    stemGeometry,
    new THREE.LineDashedMaterial({ color: red, transparent: true, opacity: .74, dashSize: .055, gapSize: .035, depthTest: false, depthWrite: false, toneMapped: false })
  );
  stem.computeLineDistances();
  stem.renderOrder = 81;
  stem.userData.isLocationStem = true;
  marker.add(stem);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(.17, 20, 14),
    new THREE.MeshBasicMaterial({ color: red, transparent: true, opacity: .98, depthTest: false, depthWrite: false, toneMapped: false })
  );
  head.position.z = .48;
  head.renderOrder = 84;
  head.userData.isLocationHead = true;
  marker.add(head);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(.22, .31, 40),
    new THREE.MeshBasicMaterial({ color: red, transparent: true, opacity: .42, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
  );
  halo.position.z = .48;
  halo.renderOrder = 83;
  marker.add(halo);

  const region = new THREE.Group();
  const regionFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: red, transparent: true, opacity: .09, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
  );
  const regionOutlineGeometry = new THREE.BufferGeometry();
  regionOutlineGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -.5, -.5, .012, .5, -.5, .012,
    .5, -.5, .012, .5, .5, .012,
    .5, .5, .012, -.5, .5, .012,
    -.5, .5, .012, -.5, -.5, .012
  ], 3));
  const regionOutline = new THREE.LineSegments(
    regionOutlineGeometry,
    new THREE.LineDashedMaterial({ color: red, transparent: true, opacity: .46, dashSize: .08, gapSize: .055, depthTest: false, depthWrite: false, toneMapped: false })
  );
  regionOutline.computeLineDistances();
  regionFill.renderOrder = 76;
  regionOutline.renderOrder = 77;
  region.add(regionFill, regionOutline);
  region.visible = false;

  layer.add(region, marker);
  scene.add(layer);
  artifactLocationLayer = layer;
  artifactLocationMarker = marker;
  artifactLocationHalo = halo;
  artifactLocationRegion = region;
  return layer;
}

function resolveArtifactSpatialLocation(name, locationKey = "") {
  return ARTIFACT_CONTEXT_LOCATIONS[locationKey] || ARTIFACT_SPATIAL_LOCATIONS[name];
}

function updateArtifactSpatialLocation(name, locationKey = activeArtifactLocationKey) {
  const location = resolveArtifactSpatialLocation(name, locationKey);
  if (!location) return;
  createArtifactLocationLayer();
  artifactLocationMarker.position.fromArray(location.anchor);
  const stem = artifactLocationMarker.children.find(child => child.userData.isLocationStem);
  const head = artifactLocationMarker.children.find(child => child.userData.isLocationHead);
  if (stem) {
    stem.geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, .04, 0, 0, location.markerLift], 3));
    stem.computeLineDistances();
  }
  if (head) head.position.z = location.markerLift;
  if (artifactLocationHalo) artifactLocationHalo.position.z = location.markerLift;

  const region = location.region;
  artifactLocationRegion.visible = Boolean(region);
  if (region) {
    artifactLocationRegion.position.set(region.center[0], region.center[1], region.center[2] + .025);
    artifactLocationRegion.scale.set(region.max[0] - region.min[0], region.max[1] - region.min[1], 1);
  }

  const index = document.querySelector("#artifact-location-index");
  const caption = document.querySelector("#artifact-location-caption");
  const certainty = document.querySelector("#artifact-location-certainty");
  const host = document.querySelector("#artifact-scene-host");
  if (index) index.textContent = `${location.objectId} · ${location.certainty === "exact-group" ? "同类器物组点" : "平面图点位"}`;
  if (caption) caption.textContent = location.label;
  if (certainty) {
    certainty.textContent = location.certainty === "exact-group"
      ? "简报同类器物组点，并非单枚独立坐标"
      : location.certainty === "exact-representative"
        ? region
          ? `代表器号定位 · 同类聚集区 ${region.count} 件`
          : "代表器号定位 · 同类器物复用模型"
        : "简报平面图明确点位";
  }
  host?.setAttribute("aria-label", `${name}，${location.objectId}，出土于${location.label}`);
}

function focusArtifactTopDown(name, locationKey = activeArtifactLocationKey) {
  const location = resolveArtifactSpatialLocation(name, locationKey);
  if (!location || !artifactMiniState || !artifactDetailOpen) return false;
  const token = ++artifactMiniCameraToken;
  artifactMiniState.focusedArtifact = name;
  const target = new THREE.Vector3(location.anchor[0], location.anchor[1], location.anchor[2] + .035);
  const endPosition = target.clone().add(new THREE.Vector3(0, 0, 6.2));
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const startUp = camera.up.clone();
  const endUp = new THREE.Vector3(0, 1, 0);
  const startFov = camera.fov;
  const endFov = 36;
  const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 760;
  const started = performance.now();

  const step = now => {
    if (token !== artifactMiniCameraToken || !artifactMiniState) return;
    const raw = Math.min(1, (now - started) / duration);
    const t = easeBreath(raw);
    camera.position.lerpVectors(startPosition, endPosition, t);
    controls.target.lerpVectors(startTarget, target, t);
    camera.up.lerpVectors(startUp, endUp, t).normalize();
    camera.fov = THREE.MathUtils.lerp(startFov, endFov, t);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    if (raw < 1) {
      requestAnimationFrame(step);
      return;
    }
    camera.position.copy(endPosition);
    controls.target.copy(target);
    camera.up.copy(endUp);
    camera.fov = endFov;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    controls.update();
  };
  requestAnimationFrame(step);
  return true;
}

function enterArtifactMiniView(options = {}) {
  const host = document.querySelector("#artifact-scene-host");
  if (!host || artifactMiniState) return;
  createArtifactLocationLayer();
  artifactMiniState = {
    enablePan: controls.enablePan,
    enableZoom: controls.enableZoom,
    enableRotate: controls.enableRotate,
    measurementVisible: measurementGroup.visible,
    burialGoodsVisible: burialGoodsLayer?.visible,
    compassVisible: groundCompass?.visible
  };
  cameraMoveToken++;
  controls.enabled = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableRotate = matchMedia("(pointer:fine)").matches;
  canvas.style.transform = "none";
  if (!options.deferCanvas) host.append(canvas);
  selectStructure(-1, [], activeNarrativeId);
  measurementGroup.visible = false;
  if (burialGoodsLayer) {
    burialGoodsLayer.visible = true;
    setBurialGoodsOpacity(1);
    setArtifactForegroundMode(true);
  }
  if (groundCompass) groundCompass.visible = false;
  artifactLocationLayer.visible = true;
  updateArtifactSpatialLocation(activeArtifactName || ARTIFACT_SEQUENCE[0], activeArtifactLocationKey);
  artifactMiniState.focusedArtifact = "";
}

function exitArtifactMiniView() {
  if (!artifactMiniState) return;
  artifactMiniCameraToken++;
  cameraMoveToken++;
  artifactLocationLayer.visible = false;
  measurementGroup.visible = artifactMiniState.measurementVisible;
  if (burialGoodsLayer && artifactMiniState.burialGoodsVisible !== undefined) burialGoodsLayer.visible = artifactMiniState.burialGoodsVisible;
  setArtifactForegroundMode(selectedIndex >= 0);
  if (groundCompass && artifactMiniState.compassVisible !== undefined) groundCompass.visible = artifactMiniState.compassVisible;
  controls.enablePan = artifactMiniState.enablePan;
  controls.enableZoom = artifactMiniState.enableZoom;
  controls.enableRotate = artifactMiniState.enableRotate;
  controls.enabled = true;
  sceneHomeParent.insertBefore(canvas, sceneHomeNextSibling);
  canvas.style.transform = "";
  artifactMiniState = null;
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

function addArchitecturalLine(group, points, options = {}) {
  if (points.length < 2) return;
  const positions = [];
  for (let i = 0; i < points.length - 1; i++) positions.push(...points[i], ...points[i + 1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const thinMaterial = new THREE.LineBasicMaterial({
    color: options.color ?? 0x11100d,
    transparent: true,
    opacity: options.opacity ?? .86,
    depthWrite: false,
    depthTest: false
  });
  const thin = new THREE.LineSegments(geometry, thinMaterial);
  thinMaterial.toneMapped = false;
  thinMaterial.userData.baseOpacity = thinMaterial.opacity;
  thin.renderOrder = options.renderOrder ?? 180;
  thin.frustumCulled = false;
  group.add(thin);

  const wideGeometry = new LineSegmentsGeometry();
  wideGeometry.setPositions(positions);
  const wideMaterial = new LineMaterial({
    color: options.color ?? 0x11100d,
    linewidth: options.width ?? 2.8,
    transparent: true,
    opacity: options.wideOpacity ?? ((options.opacity ?? .86) * .56),
    depthWrite: false,
    depthTest: false
  });
  wideMaterial.toneMapped = false;
  wideMaterial.userData.baseOpacity = wideMaterial.opacity;
  wideMaterial.resolution.set(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
  const wide = new LineSegments2(wideGeometry, wideMaterial);
  wide.computeLineDistances();
  wide.renderOrder = (options.renderOrder ?? 180) - 1;
  wide.frustumCulled = false;
  wideMaterials.push(wideMaterial);
  group.add(wide);
}

function addBoxSkeleton(group, box, options = {}) {
  const p = (x, y, z) => [x, y, z];
  const floor = [
    p(box.min.x, box.min.y, box.min.z),
    p(box.max.x, box.min.y, box.min.z),
    p(box.max.x, box.max.y, box.min.z),
    p(box.min.x, box.max.y, box.min.z),
    p(box.min.x, box.min.y, box.min.z)
  ];
  const top = [
    p(box.min.x, box.min.y, box.max.z),
    p(box.max.x, box.min.y, box.max.z),
    p(box.max.x, box.max.y, box.max.z),
    p(box.min.x, box.max.y, box.max.z),
    p(box.min.x, box.min.y, box.max.z)
  ];
  addArchitecturalLine(group, floor, options);
  addArchitecturalLine(group, top, { ...options, opacity: (options.opacity ?? .86) * .86, wideOpacity: (options.wideOpacity ?? .48) * .86 });
  [[box.min.x, box.min.y], [box.max.x, box.min.y], [box.max.x, box.max.y], [box.min.x, box.max.y]].forEach(([x, y]) => {
    addArchitecturalLine(group, [p(x, y, box.min.z), p(x, y, box.max.z)], { ...options, opacity: (options.opacity ?? .86) * .9 });
  });
}

function setArtifactForegroundMode(enabled) {
  if (!burialGoodsLayer) return;
  burialGoodsLayer.traverse(child => {
    if (!child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => {
      if (material.depthTest !== undefined) material.depthTest = !enabled;
      if (material.depthWrite !== undefined) material.depthWrite = false;
      material.needsUpdate = true;
    });
    child.renderOrder = Math.max(child.renderOrder || 0, enabled ? 240 : 120);
  });
}

function addArchRibs(group, box, index, options = {}) {
  if (![0, 1, 3, 5, 7].includes(index)) return;
  const springZ = box.max.z - (index === 0 ? .78 : .46);
  const samples = 14;
  [box.min.x, (box.min.x + box.max.x) / 2, box.max.x].forEach(x => {
    const rib = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      rib.push([x, THREE.MathUtils.lerp(box.min.y, box.max.y, t), springZ + Math.sin(t * Math.PI) * (box.max.z - springZ)]);
    }
    addArchitecturalLine(group, rib, { ...options, opacity: (options.opacity ?? .86) * .78, width: (options.width ?? 2.8) * .82 });
  });
  const yMid = (box.min.y + box.max.y) / 2;
  addArchitecturalLine(group, [[box.min.x, yMid, box.min.z], [box.max.x, yMid, box.min.z]], { ...options, opacity: (options.opacity ?? .86) * .68, width: (options.width ?? 2.8) * .72 });
  addArchitecturalLine(group, [[box.min.x, yMid, springZ], [box.max.x, yMid, springZ]], { ...options, opacity: (options.opacity ?? .86) * .62, width: (options.width ?? 2.8) * .7 });
}

function buildStructuralSkeletonLayer(data) {
  const group = new THREE.Group();
  group.name = "clean-structural-skeleton";
  group.renderOrder = 70;
  const mainOptions = { color: 0x040403, opacity: 1, wideOpacity: .86, width: 4.2, renderOrder: 190 };
  const interiorOptions = { color: 0x0b0907, opacity: .94, wideOpacity: .62, width: 3.35, renderOrder: 188 };

  data.geometries.slice(0, 8).forEach((item, index) => {
    const box = boundsOf(item);
    addBoxSkeleton(group, box, mainOptions);
    addArchRibs(group, box, index, interiorOptions);
  });

  const ramp = data.geometries[8];
  const rp = index => ramp.vertices[index].xyz_m;
  // Clean ramp wedge: no exported rear rectangle, no folded backside corner.
  [[4, 5], [4, 0], [5, 1], [0, 1]].forEach(([a, b]) => {
    addArchitecturalLine(group, [rp(a), rp(b)], { ...mainOptions, width: 4.4 });
  });

  [11, 12].forEach(index => {
    const item = data.geometries[index];
    const box = boundsOf(item);
    surveyEdges(item).forEach(edge => {
      addArchitecturalLine(group, [item.vertices[edge.from_vertex_index].xyz_m, item.vertices[edge.to_vertex_index].xyz_m], {
        color: 0x0b0a08,
        opacity: .98,
        wideOpacity: .64,
        width: 4.7,
        renderOrder: 194
      });
    });
    const mouthY = index === 11 ? box.max.y : box.min.y;
    addArchitecturalLine(group, [[box.min.x, mouthY, box.min.z], [box.max.x, mouthY, box.min.z], [box.max.x, mouthY, box.max.z], [box.min.x, mouthY, box.max.z], [box.min.x, mouthY, box.min.z]], {
      color: 0x080706,
      opacity: 1,
      wideOpacity: .7,
      width: 5.1,
      renderOrder: 196
    });
  });
  return group;
}

function makeProfile(box, vaulted) {
  const yMin = box.min.y;
  const yMax = box.max.y;
  const zFloor = box.min.z;
  const zTop = box.max.z;
  const spring = vaulted ? zTop - Math.min(.78, Math.max(.42, (zTop - zFloor) * .34)) : zTop;
  const points = [
    { y: yMin, z: zFloor },
    { y: yMax, z: zFloor },
    { y: yMax, z: spring }
  ];
  const archSamples = 8;
  for (let i = 1; i < archSamples; i++) {
    const t = i / archSamples;
    const y = THREE.MathUtils.lerp(yMax, yMin, t);
    const z = vaulted ? spring + Math.sin(t * Math.PI) * (zTop - spring) : zTop;
    points.push({ y, z });
  }
  points.push({ y: yMin, z: spring }, { y: yMin, z: zFloor });
  return points;
}

function buildContinuousVolumeLayer(data) {
  const group = new THREE.Group();
  group.name = "continuous-surveyed-npr-body";
  group.userData.opacityMaterials = [];
  const mainIndexes = [8, 7, 6, 5, 4, 3, 2, 1, 0];
  const vaultedIndexes = new Set([0, 1, 3, 5, 7]);
  const sections = [];
  mainIndexes.forEach(index => {
    const box = boundsOf(data.geometries[index]);
    const profile = makeProfile(box, vaultedIndexes.has(index));
    sections.push({ x: box.min.x, profile, index });
    sections.push({ x: box.max.x, profile, index });
  });
  sections.sort((a, b) => a.x - b.x);

  const positions = [];
  const shades = [];
  const grains = [];
  const pushVertex = (x, point, shade, grain) => {
    positions.push(x, point.y, point.z);
    shades.push(shade);
    grains.push(grain);
  };
  const pushQuad = (a, b, c, d, shade, seed) => {
    [a, b, c, a, c, d].forEach((vertex, order) => pushVertex(vertex.x, vertex, shade + (seededNoise(seed + order * 19) - .5) * .08, seededNoise(seed + order * 37)));
  };

  for (let s = 0; s < sections.length - 1; s++) {
    const left = sections[s];
    const right = sections[s + 1];
    if (Math.abs(right.x - left.x) < .001) continue;
    for (let p = 0; p < left.profile.length - 1; p++) {
      const a = { x: left.x, ...left.profile[p] };
      const b = { x: right.x, ...right.profile[p] };
      const c = { x: right.x, ...right.profile[p + 1] };
      const d = { x: left.x, ...left.profile[p + 1] };
      const vertical = Math.abs(left.profile[p].z - left.profile[p + 1].z);
      const floorBand = p === 0;
      const roofBand = p > 1 && p < left.profile.length - 2;
      const shade = floorBand ? .74 : roofBand ? .38 : .52 + Math.min(.24, vertical * .08);
      pushQuad(a, b, c, d, shade, 2100 + s * 71 + p * 13);
    }
  }

  [sections[0], sections[sections.length - 1]].forEach((section, sectionIndex) => {
    const center = section.profile.reduce((sum, point) => {
      sum.y += point.y;
      sum.z += point.z;
      return sum;
    }, { x: section.x, y: 0, z: 0 });
    center.y /= section.profile.length;
    center.z /= section.profile.length;
    for (let p = 0; p < section.profile.length - 1; p++) {
      const a = { x: section.x, ...section.profile[p] };
      const b = { x: section.x, ...section.profile[p + 1] };
      pushQuad(center, a, b, center, sectionIndex ? .48 : .42, 3500 + sectionIndex * 97 + p);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aShade", new THREE.Float32BufferAttribute(shades, 1));
  geometry.setAttribute("aGrain", new THREE.Float32BufferAttribute(grains, 1));
  geometry.computeVertexNormals();
  const material = trackOpacity(group, sketchWashMaterial(0x8a765c, .026), .026);
  material.depthWrite = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "single-continuous-npr-depth-body";
  mesh.renderOrder = -4;
  group.add(mesh);
  return group;
}

function buildNaturalShell(data) {
  const shell = new THREE.Group();
  shell.name = "整体连续墓穴外轮廓";
  data.geometries.slice(0, 9).forEach((item, index) => {
    if (index === 8) {
      surveyEdges(item).forEach(edge => {
        const start = item.vertices[edge.from_vertex_index].xyz_m;
        const end = item.vertices[edge.to_vertex_index].xyz_m;
        shell.add(naturalLine([start, end], .66));
      });
      return;
    }
    const box = boundsOf(item);
    const floor = [
      [box.min.x, box.min.y, box.min.z],
      [box.max.x, box.min.y, box.min.z],
      [box.max.x, box.max.y, box.min.z],
      [box.min.x, box.max.y, box.min.z],
      [box.min.x, box.min.y, box.min.z]
    ];
    const crown = [
      [box.min.x, box.min.y, box.max.z],
      [box.max.x, box.min.y, box.max.z],
      [box.max.x, box.max.y, box.max.z],
      [box.min.x, box.max.y, box.max.z],
      [box.min.x, box.min.y, box.max.z]
    ];
    shell.add(naturalLine(floor, .56));
    shell.add(naturalLine(crown, [0, 1, 3, 5, 7].includes(index) ? .38 : .48));
    [[box.min.x, box.min.y], [box.max.x, box.min.y], [box.max.x, box.max.y], [box.min.x, box.max.y]].forEach(([x, y]) => {
      shell.add(naturalLine([[x, y, box.min.z], [x, y, box.max.z]], .42));
    });
  });

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
    shell.add(naturalLine([[x0,mouthY,floorZ],[x0,mouthY,crownZ],[x0,backY,crownZ],[x0,backY,floorZ],[x0,mouthY,floorZ]], .58));
    shell.add(naturalLine([[x1,mouthY,floorZ],[x1,mouthY,crownZ],[x1,backY,crownZ],[x1,backY,floorZ],[x1,mouthY,floorZ]], .58));
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
    depthWrite: true,
    depthTest: true,
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
controls.addEventListener("change", () => normalizeGroundedCameraView());

function addNicheSketchVolume(group, item, index, seed) {
  const box = boundsOf(item);
  const isEast = index === 11;
  const mouthY = isEast ? box.max.y : box.min.y;
  const backY = isEast ? box.min.y : box.max.y;
  const x0 = box.min.x;
  const x1 = box.max.x;
  const z0 = box.min.z;
  const z1 = box.max.z;

  if (isEast) {
    const point = vertexIndex => item.vertices[vertexIndex].xyz_m;
    const mouthProfile = [0, 1, 2, 3, 4, 5].map(point);
    const backProfile = [10, 6, 9, 8, 7, 11].map(point);
    for (let i = 0; i < mouthProfile.length - 1; i++) {
      addSketchQuad(group, [mouthProfile[i], mouthProfile[i + 1], backProfile[i + 1], backProfile[i]], {
        normal: i < 2 ? [-.55, 0, .45] : i > 2 ? [.55, 0, .45] : [0, 0, 1],
        color: i === 0 || i === mouthProfile.length - 2 ? 0x765d49 : 0x8b7157,
        opacity: i === 2 ? .105 : .135,
        divisionsU: 4,
        divisionsV: 3,
        seed: seed + i * 41,
        hatching: i !== 2
      });
    }
    addSketchQuad(group, [backProfile[0], backProfile[1], backProfile[2], backProfile[0]], {
      normal: [0, -1, 0], color: 0x735a45, opacity: .11, divisionsU: 2, divisionsV: 2, seed: seed + 211
    });
    addSketchQuad(group, [backProfile[0], backProfile[2], backProfile[3], backProfile[0]], {
      normal: [0, -1, 0], color: 0x735a45, opacity: .105, divisionsU: 2, divisionsV: 2, seed: seed + 227
    });
    addSketchQuad(group, [backProfile[0], backProfile[3], backProfile[4], backProfile[5]], {
      normal: [0, -1, 0], color: 0x735a45, opacity: .11, divisionsU: 2, divisionsV: 2, seed: seed + 239
    });
    return;
  }

  addSketchQuad(group, [[x0, mouthY, z0], [x1, mouthY, z0], [x1, backY, z0], [x0, backY, z0]], {
    normal: [0, 0, 1], color: 0xa98b67, opacity: .12, divisionsU: 4, divisionsV: 3, seed
  });
  addSketchQuad(group, [[x0, mouthY, z1], [x1, mouthY, z1], [x1, backY, z1], [x0, backY, z1]], {
    normal: [0, 0, 1], color: 0x7f684f, opacity: .075, divisionsU: 4, divisionsV: 2, seed: seed + 37, hatching: false
  });
  addSketchQuad(group, [[x0, mouthY, z0], [x0, backY, z0], [x0, backY, z1], [x0, mouthY, z1]], {
    normal: [-1, 0, 0], color: 0x725a45, opacity: .13, divisionsU: 3, divisionsV: 2, seed: seed + 83
  });
  addSketchQuad(group, [[x1, backY, z0], [x1, mouthY, z0], [x1, mouthY, z1], [x1, backY, z1]], {
    normal: [1, 0, 0], color: 0x7b634b, opacity: .13, divisionsU: 3, divisionsV: 2, seed: seed + 91
  });
  addSketchQuad(group, [[x0, backY, z0], [x1, backY, z0], [x1, backY, z1], [x0, backY, z1]], {
    normal: [0, isEast ? -1 : 1, 0], color: 0x735a45, opacity: .15, divisionsU: 4, divisionsV: 3, seed: seed + 61
  });
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
    const seed = 1800 + index * 37;
    void nicheIndex;
    addNicheSketchVolume(group, data.geometries[index], index, seed);
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
  const candidates = NARRATIVE_ENTRIES.filter(entry => entry.triggerIndices.includes(index));
  return candidates.find(entry => entry.primary !== false) || candidates[0] || null;
}

function narrativeEntryById(id) {
  return NARRATIVE_ENTRIES.find(entry => entry.id === id) || null;
}

function normalizedNarrativeCardLayout(candidate) {
  const source = candidate?.version === defaultNarrativeCardLayout.version
    && candidate?.coordinateSpace === defaultNarrativeCardLayout.coordinateSpace
    ? candidate
    : defaultNarrativeCardLayout;
  const positions = Object.fromEntries(NARRATIVE_ENTRIES.map(entry => {
    const fallback = defaultNarrativeCardLayout.positions?.[entry.id] || { x: .16, y: .18 };
    const position = source.positions?.[entry.id] || fallback;
    const x = Number.isFinite(position.x) ? THREE.MathUtils.clamp(position.x, 0, 1) : fallback.x;
    const y = Number.isFinite(position.y) ? THREE.MathUtils.clamp(position.y, 0, 1) : fallback.y;
    return [entry.id, { x, y }];
  }));
  return {
    version: defaultNarrativeCardLayout.version,
    coordinateSpace: defaultNarrativeCardLayout.coordinateSpace,
    positions
  };
}

function loadNarrativeCardLayout() {
  let savedLayout = null;
  try {
    savedLayout = JSON.parse(localStorage.getItem(NARRATIVE_LAYOUT_STORAGE_KEY) || "null");
  } catch (error) {
    console.warn("Saved narrative card layout could not be read", error);
  }
  narrativeCardLayout = normalizedNarrativeCardLayout(savedLayout);
}

function saveNarrativeCardLayout() {
  try {
    localStorage.setItem(NARRATIVE_LAYOUT_STORAGE_KEY, JSON.stringify(narrativeCardLayout));
  } catch (error) {
    console.warn("Narrative card layout could not be saved", error);
  }
}

function clampNarrativeCardPixels(left, top, card) {
  const rect = card.getBoundingClientRect();
  const maxLeft = Math.max(NARRATIVE_CARD_VIEWPORT_GAP, innerWidth - rect.width - NARRATIVE_CARD_VIEWPORT_GAP);
  const maxTop = Math.max(NARRATIVE_CARD_VIEWPORT_GAP, innerHeight - rect.height - NARRATIVE_CARD_VIEWPORT_GAP);
  return {
    left: THREE.MathUtils.clamp(left, NARRATIVE_CARD_VIEWPORT_GAP, maxLeft),
    top: THREE.MathUtils.clamp(top, NARRATIVE_CARD_VIEWPORT_GAP, maxTop)
  };
}

function applyNarrativeCardPosition(narrativeId) {
  const card = document.querySelector("#narrative-card");
  const position = narrativeCardLayout?.positions?.[narrativeId]
    || defaultNarrativeCardLayout.positions?.[narrativeId]
    || { x: .16, y: .18 };
  if (!card) return;
  const pixels = clampNarrativeCardPixels(position.x * innerWidth, position.y * innerHeight, card);
  card.style.left = `${pixels.left}px`;
  card.style.top = `${pixels.top}px`;
}

function exportNarrativeCardLayout() {
  const layout = normalizedNarrativeCardLayout(narrativeCardLayout);
  const blob = new Blob([`${JSON.stringify(layout, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "narrative-card-layout.json";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setupNarrativeCardDragging() {
  const card = document.querySelector("#narrative-card");
  let drag = null;

  const finishDrag = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pointerId = drag.pointerId;
    const rect = card.getBoundingClientRect();
    const narrativeId = card.dataset.narrativeId;
    if (narrativeId && narrativeCardLayout?.positions?.[narrativeId]) {
      narrativeCardLayout.positions[narrativeId] = {
        x: Number((rect.left / innerWidth).toFixed(6)),
        y: Number((rect.top / innerHeight).toFixed(6))
      };
      saveNarrativeCardLayout();
    }
    card.classList.remove("dragging");
    drag = null;
    if (card.hasPointerCapture(pointerId)) card.releasePointerCapture(pointerId);
    scheduleAutoDemo();
  };

  card.addEventListener("pointerdown", event => {
    if (!narrativeCardOpen || event.button !== 0
      || event.target.closest("button,a,input,textarea,select,[contenteditable='true']")) return;
    event.preventDefault();
    event.stopPropagation();
    rememberPlaybackPosition();
    stopAutoDemo();
    const rect = card.getBoundingClientRect();
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    drag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top
    };
    card.setPointerCapture(event.pointerId);
    card.classList.add("dragging");
  });
  card.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const pixels = clampNarrativeCardPixels(
      drag.startLeft + event.clientX - drag.startClientX,
      drag.startTop + event.clientY - drag.startClientY,
      card
    );
    card.style.left = `${pixels.left}px`;
    card.style.top = `${pixels.top}px`;
  });
  card.addEventListener("pointerup", finishDrag);
  card.addEventListener("pointercancel", finishDrag);
  card.addEventListener("lostpointercapture", finishDrag);

  document.querySelector("#export-narrative-layout").addEventListener("click", event => {
    event.stopPropagation();
    exportNarrativeCardLayout();
  });
  window.addEventListener("resize", () => {
    if (narrativeCardOpen) applyNarrativeCardPosition(activeNarrativeId);
  });
}

function positionNarrativeArtifactBranch() {
  const branch = document.querySelector("#narrative-artifact-branch");
  const axis = document.querySelector("#report-narrative");
  if (!branch || !axis || branch.getAttribute("aria-hidden") === "true") return;
  if (matchMedia("(max-width: 800px)").matches) {
    branch.style.removeProperty("top");
    branch.style.removeProperty("--connector-y");
    return;
  }
  const node = [...document.querySelectorAll(".narrative-node")]
    .find(item => item.dataset.narrativeId === branch.dataset.narrativeId);
  if (!node) return;
  const axisRect = axis.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const branchRect = branch.getBoundingClientRect();
  const nodeCenter = nodeRect.top + nodeRect.height / 2 - axisRect.top;
  const maxTop = Math.max(0, axisRect.height - branchRect.height);
  const top = THREE.MathUtils.clamp(nodeCenter - branchRect.height / 2, 0, maxTop);
  branch.style.top = `${top}px`;
  branch.style.setProperty("--connector-y", `${THREE.MathUtils.clamp(nodeCenter - top, 10, Math.max(10, branchRect.height - 10))}px`);
}

function syncNarrativeArtifactBranch(entry) {
  const branch = document.querySelector("#narrative-artifact-branch");
  const list = document.querySelector("#narrative-artifact-list");
  if (!branch || !list) return;
  const links = artifactLinksForEntry(entry);
  const visible = Boolean(entry && links.length);
  branch.classList.toggle("open", visible);
  branch.setAttribute("aria-hidden", String(!visible));
  if (!visible) {
    branch.dataset.narrativeId = "";
    list.replaceChildren();
    return;
  }
  if (branch.dataset.narrativeId !== entry.id) {
    branch.dataset.narrativeId = entry.id;
    list.replaceChildren();
    links.forEach(({ name, locationKey }) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "narrative-artifact-option";
      button.dataset.artifact = name;
      button.dataset.narrativeId = entry.id;
      if (locationKey) button.dataset.locationKey = locationKey;
      button.textContent = name;
      button.setAttribute("aria-controls", "artifact-detail");
      button.setAttribute("aria-current", "false");
      button.setAttribute("aria-label", `${entry.name}相关器物：${name}${locationKey ? "，壁龛点位" : ""}`);
      button.addEventListener("click", event => {
        event.stopPropagation();
        showNarrativeArtifact(entry, { name, locationKey }, {
          source: "narrative",
          trigger: event.currentTarget
        });
        noteUserActivity();
      });
      item.append(button);
      list.append(item);
    });
  }
  list.querySelectorAll(".narrative-artifact-option").forEach(button => {
    const active = artifactDetailOpen
      && button.dataset.narrativeId === activeNarrativeId
      && button.dataset.artifact === activeArtifactName
      && (button.dataset.locationKey || "") === activeArtifactLocationKey;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "true" : "false");
  });
  requestAnimationFrame(positionNarrativeArtifactBranch);
}

function renderNarrativeCard(entry) {
  if (!entry) return;
  const card = document.querySelector("#narrative-card");
  card.dataset.narrativeId = entry.id;
  document.querySelector("#narrative-card-index").textContent = `${entry.no} / ${String(NARRATIVE_ENTRIES.length).padStart(2, "0")} · EXCAVATION BRIEF`;
  document.querySelector("#narrative-card-title").textContent = entry.name;
  document.querySelector("#narrative-card-subtitle").textContent = entry.title;
  document.querySelector("#narrative-card-summary").textContent = entry.summary;
  document.querySelector("#narrative-card-quote").textContent = `“${entry.quote}”`;
  applyNarrativeCardPosition(entry.id);
}

function syncNarrativeAxis(index, preferredNarrativeId = "") {
  const preferredEntry = narrativeEntryById(preferredNarrativeId);
  const currentEntry = narrativeEntryById(activeNarrativeId);
  const currentMatches = currentEntry?.triggerIndices.includes(index);
  const entry = preferredEntry || (narrativeCardOpen && currentMatches ? currentEntry : narrativeEntryForStructure(index));
  activeNarrativeId = entry?.id || "";
  document.querySelectorAll(".narrative-node").forEach(button => {
    const active = button.dataset.narrativeId === activeNarrativeId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "step" : "false");
    button.setAttribute("aria-expanded", String(active && (narrativeCardOpen || artifactLinksForEntry(entry).length > 0)));
  });
  if (!entry) {
    closeNarrativeCard();
    syncNarrativeArtifactBranch(null);
    return;
  }
  syncNarrativeArtifactBranch(entry);
  if (narrativeCardOpen) renderNarrativeCard(entry);
}

function openNarrativeCard(entry) {
  if (!entry) return;
  narrativeCardOpen = true;
  activeNarrativeId = entry.id;
  renderNarrativeCard(entry);
  const card = document.querySelector("#narrative-card");
  card.classList.add("open");
  card.setAttribute("aria-hidden", "false");
  syncNarrativeAxis(entry.cameraIndex, entry.id);
}

function closeNarrativeCard() {
  if (!narrativeCardOpen) return false;
  narrativeCardOpen = false;
  const card = document.querySelector("#narrative-card");
  card?.classList.remove("open");
  card?.setAttribute("aria-hidden", "true");
  const activeEntry = narrativeEntryById(activeNarrativeId);
  document.querySelectorAll(".narrative-node").forEach(button => {
    const expanded = button.dataset.narrativeId === activeNarrativeId && artifactLinksForEntry(activeEntry).length > 0;
    button.setAttribute("aria-expanded", String(expanded));
  });
  return true;
}

function setupNarrativeAxis() {
  loadNarrativeCardLayout();
  setupNarrativeCardDragging();
  const list = document.querySelector("#narrative-list");
  NARRATIVE_ENTRIES.forEach(entry => {
    const item = document.createElement("li");
    item.className = "narrative-item";
    item.dataset.narrativeId = entry.id;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "narrative-node";
    button.dataset.narrativeId = entry.id;
    button.setAttribute("aria-controls", artifactLinksForEntry(entry).length
      ? "narrative-card narrative-artifact-branch"
      : "narrative-card");
    button.setAttribute("aria-label", `${entry.no} ${entry.name} ${entry.title}`);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-current", "false");
    button.innerHTML = `<em>${entry.no}</em><span><b>${entry.name}</b><small>${entry.title}</small></span>`;
    button.addEventListener("click", event => {
      event.stopPropagation();
      navigateToNarrativeEntry(entry, { source: "narrative" });
      noteUserActivity();
    });
    item.append(button);
    list.append(item);
  });
  document.querySelector("#narrative-close").addEventListener("click", event => {
    event.stopPropagation();
    closeNarrativeCard();
  });
  window.addEventListener("resize", positionNarrativeArtifactBranch);
  syncNarrativeAxis(selectedIndex);
}

function selectStructure(index, focusIndices = index < 0 ? [] : [index], narrativeId = "") {
  selectedIndex = index;
  selectedFocusIndices = index < 0 ? [] : [...new Set(focusIndices)];
  objects.forEach(group => {
    const active = index < 0 || selectedFocusIndices.includes(group.userData.index);
    const isTheftShaft = group.userData.name === "D1" || group.userData.name === "D2";
    group.visible = index >= 0;
    const { understroke, main, echoA, echoB, surveySkeleton, surveyWide, profileSkeleton, profileWide, xray, xraySoft } = group.userData.lines;
    setLineLayerOpacity(understroke, index < 0 ? .01 : active ? .12 : .012);
    setLineLayerOpacity(main, index < 0 ? .018 : active ? .18 : .018);
    setLineLayerOpacity(echoA, index < 0 ? .006 : active ? .052 : .006);
    setLineLayerOpacity(echoB, index < 0 ? .003 : active ? .026 : .003);
    setLineLayerOpacity(surveySkeleton, index < 0 ? .014 : active ? .20 : .018);
    setLineLayerOpacity(surveyWide, index < 0 ? .008 : active ? .16 : .014);
    setLineLayerOpacity(profileSkeleton, index < 0 ? .014 : active ? .22 : .018);
    setLineLayerOpacity(profileWide, index < 0 ? .008 : active ? .18 : .012);
    setLineLayerOpacity(xray, index < 0 ? .014 : active ? .14 : .014);
    setLineLayerOpacity(xraySoft, index < 0 ? .008 : active ? .056 : .006);
    if (group.userData.interior) group.userData.interior.visible = index < 0 || active;
  });
  if (naturalShell) naturalShell.visible = false;
  if (mainVisualModel) mainVisualModel.visible = true;
  setMainVisualModelFocus(index);
  if (structuralSkeletonLayer) structuralSkeletonLayer.visible = !mainVisualModel;
  if (groundLayer) groundLayer.visible = false;
  if (continuousVolumeLayer) {
    continuousVolumeLayer.visible = false;
    continuousVolumeLayer.userData.opacityMaterials.forEach(material => {
      if (material.uniforms?.uOpacity) material.uniforms.uOpacity.value = material.userData.baseOpacity * (index < 0 ? .038 : .018);
      else material.opacity = material.userData.baseOpacity * (index < 0 ? .038 : .018);
    });
  }
  if (sketchVolumeLayer) {
    sketchVolumeLayer.visible = false;
    sketchVolumeLayer.userData.opacityMaterials.forEach(material => {
      if (material.uniforms?.uOpacity) material.uniforms.uOpacity.value = material.userData.baseOpacity * (index < 0 ? .006 : .0025);
      else material.opacity = material.userData.baseOpacity * (index < 0 ? .006 : .0025);
    });
  }
  if (perspectiveGuides?.material) perspectiveGuides.material.opacity = index < 0 ? .11 : .045;
  setBurialGoodsOpacity(index < 0 || selectedFocusIndices.includes(0) ? 1 : .45);
  setArtifactForegroundMode(index >= 0 || Boolean(artifactMiniState));
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
    } else {
      button.classList.remove("axis-hit");
    }
  });
  document.querySelectorAll(".structure-hotspot-leader").forEach(leader => {
    const leaderIndex = Number(leader.dataset.index);
    leader.classList.toggle("active", index >= 0 && selectedFocusIndices.includes(leaderIndex));
  });
  const selected = objects.find(group => group.userData.index === index);
  const focusNames = selectedFocusIndices.map(focusIndex => objects.find(group => group.userData.index === focusIndex)?.userData.name).filter(Boolean);
  const currentLabel = index < 0 ? "整体结构" : focusNames.join(" ＋ ") || selected?.userData.name || "结构";
  document.querySelector("#status").textContent = index < 0 ? "整体骨架 · 自由检查模式" : `${currentLabel} · 结构已突出`;
  showMeasurements(selectedFocusIndices.length === 1 ? index : -1, selectedFocusIndices.length === 1 ? selected : null);
  syncNarrativeAxis(index, narrativeId);
  applyDepthAwareLineOpacity();
}

function buildControls(data) {
  const hotspots = document.querySelector("#structure-hotspots");
  const overallButton = document.querySelector(".structure-overall");
  overallButton.addEventListener("click", () => { navigateToOverall(); noteUserActivity(); });
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
      leader.dataset.index = index;
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
    button.addEventListener("click", () => { navigateToStructure(index); noteUserActivity(); });
    hotspots.append(button);
  });
  document.querySelector("#reset-view").addEventListener("click", () => { navigateToOverall(); noteUserActivity(); });
}

function easeBreath(t) {
  const smooth = t * t * t * (t * (t * 6 - 15) + 10);
  return THREE.MathUtils.clamp(smooth + Math.sin(t * Math.PI) * .012, 0, 1);
}

function animateCamera(endPosition, endTarget, endFov, onComplete, endUp = SPATIAL_CAMERA_UP) {
  const token = ++cameraMoveToken;
  cameraDestination = {
    token,
    position: endPosition.clone(),
    target: endTarget.clone(),
    up: endUp.clone(),
    fov: endFov
  };
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
    camera.up.copy(SPATIAL_CAMERA_UP);
    camera.fov = THREE.MathUtils.lerp(startFov, endFov, t);
    camera.updateProjectionMatrix();
    normalizeGroundedCameraView();
    camera.lookAt(controls.target);
    if (raw < 1) requestAnimationFrame(step);
    else {
      camera.position.copy(endPosition); controls.target.copy(endTarget); camera.up.copy(SPATIAL_CAMERA_UP); camera.fov = endFov; camera.updateProjectionMatrix(); normalizeGroundedCameraView(); camera.lookAt(endTarget); controls.update(); controls.enabled = true;
      if (cameraDestination?.token === token) cameraDestination = null;
      onComplete?.();
    }
  };
  requestAnimationFrame(step);
}

function applyResponsiveShotOffset(position, target, viewUp = SPATIAL_CAMERA_UP) {
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
  const narrowFactor = THREE.MathUtils.clamp((1.1 - aspect) / .65, 0, 1);
  const narrativeFactor = narrativeCardOpen && aspect > .9 ? THREE.MathUtils.clamp((aspect - .9) / .55, 0, 1) : 0;
  if (!narrowFactor && !narrativeFactor) return;
  const distance = position.distanceTo(target);
  const forward = target.clone().sub(position).normalize();
  const screenRight = new THREE.Vector3().crossVectors(forward, viewUp).normalize();
  const screenUp = new THREE.Vector3().crossVectors(screenRight, forward).normalize();
  const offset = screenRight.multiplyScalar(-distance * (.14 * narrowFactor + .12 * narrativeFactor))
    .add(screenUp.multiplyScalar(-distance * .04 * narrowFactor));
  position.add(offset);
  target.add(offset);
}

function focusBoundsForIndices(focusIndices, fallbackGroup) {
  const bounds = new THREE.Box3();
  focusIndices.forEach(focusIndex => {
    const focusGroup = objects.find(item => item.userData.index === focusIndex);
    if (focusGroup) bounds.union(new THREE.Box3().setFromObject(focusGroup));
  });
  if (bounds.isEmpty() && fallbackGroup) bounds.setFromObject(fallbackGroup);
  return bounds;
}

function cameraOffsetForStructure(index, focusSize) {
  const offset = new THREE.Vector3(...(STRUCTURE_SHOT_OFFSETS[index] || STRUCTURE_SHOT_OFFSETS.default));
  const scale = THREE.MathUtils.clamp(focusSize / 7.2, .72, 1.38);
  return offset.multiplyScalar(scale);
}

function navigateToStructure(index, options = {}) {
  const group = objects.find(item => item.userData.index === index);
  if (!group) return;
  if (!options.narrativeId) closeNarrativeCard();
  const geometricTarget = structureTargets.get(index) || new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
  const preset = CAMERA_PRESETS[index];
  const focusIndices = options.focusIndices || preset?.focus || [index];
  const focusBounds = focusBoundsForIndices(focusIndices, group);
  const focusSizeVector = focusBounds.getSize(new THREE.Vector3());
  const target = focusBounds.isEmpty() ? geometricTarget : focusBounds.getCenter(new THREE.Vector3());
  target.z += THREE.MathUtils.clamp(focusSizeVector.z * .05, .04, .22);
  const size = focusBounds.isEmpty() ? new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).length() : focusSizeVector.length();
  const endPosition = target.clone().add(cameraOffsetForStructure(index, size));
  selectStructure(index, focusIndices, options.narrativeId);
  logVisualProcess(`镜头切换：${group.userData.name}，同侧连续观察`);
  animateCamera(endPosition, target, STRUCTURE_SHOT_FOV[index] || preset?.fov || 42, () => {
    const focusNames = focusIndices.map(focusIndex => objects.find(item => item.userData.index === focusIndex)?.userData.name).filter(Boolean);
    document.querySelector("#status").textContent = `${focusNames.join(" ＋ ")} · ${focusNames.length > 1 ? "组合特写" : "特写视角"}`;
  });
}

function navigateToOverall(options = {}) {
  if (!overallView) return;
  const narrativeEntry = narrativeEntryById(options.narrativeId);
  if (!narrativeEntry) closeNarrativeCard();
  const focusIndices = options.focusIndices || [];
  const anchorIndex = Number.isInteger(options.anchorIndex) ? options.anchorIndex : -1;
  selectStructure(anchorIndex, focusIndices, options.narrativeId);
  const endPosition = overallView.position.clone();
  const endTarget = overallView.target.clone();
  if (narrativeEntry && anchorIndex >= 0) applyResponsiveShotOffset(endPosition, endTarget);
  logVisualProcess("镜头切换：整体总览，同侧轴线视角");
  animateCamera(endPosition, endTarget, overallView.fov, () => {
    document.querySelector("#status").textContent = narrativeEntry
      ? `${narrativeEntry.name} · 空间叙事`
      : "整体结构 · OVERVIEW";
  });
}

function navigateToNarrativeEntry(entry, options = {}) {
  if (!entry) return;
  if (artifactDetailOpen) closeArtifactDetail({ restore: false });
  openNarrativeCard(entry);
  if (entry.mode === "overall") {
    navigateToOverall({
      source: options.source,
      narrativeId: entry.id,
      focusIndices: entry.focusIndices,
      anchorIndex: entry.cameraIndex
    });
    return;
  }
  navigateToStructure(entry.cameraIndex, {
    source: options.source,
    narrativeId: entry.id,
    focusIndices: entry.focusIndices
  });
}

function showNarrativeArtifact(entry, item, options = {}) {
  if (!entry) return false;
  const { name, locationKey } = normalizeArtifactLink(item);
  if (!name) return false;
  const app = document.querySelector("#app");
  const detail = document.querySelector("#artifact-detail");
  if (!app || !detail || app.dataset.view !== "model") return false;
  activeNarrativeId = entry.id;
  if (options.trigger instanceof HTMLElement) artifactReturnFocus = options.trigger;
  if (!artifactDetailOpen) {
    if (!(options.trigger instanceof HTMLElement)) artifactReturnFocus = null;
    spatialReturnState = captureSpatialContext();
    artifactDetailOpen = true;
    app.classList.add("artifact-detail-open");
    detail.classList.add("open");
    detail.setAttribute("aria-hidden", "false");
    detail.inert = false;
    closeNarrativeCard();
    enterArtifactMiniView();
  }
  syncNarrativeAxis(entry.cameraIndex, entry.id);
  const activated = activateArtifactByName(name, {
    force: true,
    auto: options.auto,
    source: options.source || "narrative",
    locationKey,
    narrativeId: entry.id
  });
  syncNarrativeArtifactBranch(entry);
  requestAnimationFrame(resize);
  return activated;
}

function closeArtifactDetail(options = {}) {
  if (!artifactDetailOpen) return false;
  const snapshot = spatialReturnState;
  const returnFocus = artifactReturnFocus;
  const app = document.querySelector("#app");
  const detail = document.querySelector("#artifact-detail");
  artifactDetailOpen = false;
  exitArtifactMiniView();
  app?.classList.remove("artifact-detail-open");
  detail?.classList.remove("open");
  detail?.setAttribute("aria-hidden", "true");
  if (detail) detail.inert = true;
  if (options.restore !== false) restoreSpatialContext(snapshot);
  else spatialReturnState = null;
  artifactReturnFocus = null;
  syncNarrativeArtifactBranch(narrativeEntryById(activeNarrativeId));
  syncAutoDemoUi();
  requestAnimationFrame(() => {
    resize();
    if (options.restore === false) return;
    const fallback = document.querySelector(`.narrative-node[data-narrative-id="${activeNarrativeId}"]`);
    const focusTarget = returnFocus?.isConnected ? returnFocus : fallback;
    focusTarget?.focus({ preventScroll: true });
  });
  return true;
}

function captureSpatialContext() {
  let snapshotPosition = camera.position.clone();
  let snapshotTarget = controls.target.clone();
  let snapshotUp = camera.up.clone();
  let snapshotFov = camera.fov;
  const pendingDestination = controls.enabled === false ? cameraDestination : null;
  if (pendingDestination) {
    snapshotPosition = pendingDestination.position.clone();
    snapshotTarget = pendingDestination.target.clone();
    snapshotUp = pendingDestination.up.clone();
    snapshotFov = pendingDestination.fov;
  }
  return {
    selectedIndex,
    focusIndices: [...selectedFocusIndices],
    narrativeCardOpen,
    activeNarrativeId,
    cameraPosition: snapshotPosition.toArray(),
    cameraTarget: snapshotTarget.toArray(),
    cameraUp: snapshotUp.toArray(),
    cameraFov: snapshotFov
  };
}

function restoreSpatialContext(snapshot = spatialReturnState, options = {}) {
  if (!snapshot) {
    if (options.preserveCamera) {
      selectStructure(-1);
      closeNarrativeCard();
    } else {
      navigateToOverall();
    }
    return;
  }
  cameraMoveToken++;
  cameraDestination = null;
  controls.enabled = true;
  if (!options.preserveCamera) {
    camera.up.fromArray(snapshot.cameraUp || [0, 0, 1]);
    camera.position.fromArray(snapshot.cameraPosition);
    controls.target.fromArray(snapshot.cameraTarget);
    camera.fov = snapshot.cameraFov;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
  }
  selectStructure(snapshot.selectedIndex, snapshot.focusIndices, snapshot.activeNarrativeId);
  if (snapshot.narrativeCardOpen) {
    const entry = narrativeEntryById(snapshot.activeNarrativeId)
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

function openEpitaphModal(options = {}) {
  const modal = document.querySelector("#epitaph-modal");
  if (!modal) return;
  if (!options.auto) stopAutoDemo();
  document.querySelector(".model-interface").inert = true;
  modal.inert = false;
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => modal.querySelector(".epitaph-close")?.focus({ preventScroll: true }), 0);
}

function closeEpitaphModal(restoreFocus = false) {
  const modal = document.querySelector("#epitaph-modal");
  if (!modal || modal.getAttribute("aria-hidden") !== "false") return false;
  modal.setAttribute("aria-hidden", "true");
  modal.inert = true;
  const modelInterface = document.querySelector(".model-interface");
  if (modelInterface) modelInterface.inert = document.querySelector("#app")?.dataset.view !== "model";
  if (restoreFocus && artifactDetailOpen) {
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
  const artifactPhase = autoDemoActive && artifactDetailOpen;
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
  autoDemoTimer = setTimeout(startAutoDemo, delay);
}

function buildAutoDemoSequence() {
  return buildNarrativePlaybackSequence(NARRATIVE_ENTRIES, DEMO_ROUTE);
}

function setAutoDemoResumeAfter(currentStep) {
  autoDemoStep = playbackResumeIndex(buildAutoDemoSequence(), currentStep);
}

function rememberPlaybackPosition() {
  if (isEpitaphModalOpen()) {
    setAutoDemoResumeAfter({ type: "epitaph-open", narrativeId: "epitaph" });
    return;
  }
  if (artifactDetailOpen && activeNarrativeId && activeArtifactName) {
    setAutoDemoResumeAfter({
      type: "artifact",
      narrativeId: activeNarrativeId,
      name: activeArtifactName,
      locationKey: activeArtifactLocationKey
    });
    return;
  }
  if (activeNarrativeId) {
    setAutoDemoResumeAfter({ type: "narrative", narrativeId: activeNarrativeId });
  }
}

function noteUserActivity() {
  rememberPlaybackPosition();
  stopAutoDemo();
  scheduleAutoDemo();
}

function startAutoDemo() {
  const app = document.querySelector("#app");
  const view = app?.dataset.view;
  if (!app || view === "home" || isEpitaphModalOpen()) {
    scheduleAutoDemo(5000);
    return;
  }
  if (!artifactDetailOpen && controls.enabled === false) {
    scheduleAutoDemo(2500);
    return;
  }
  clearAutoDemoTimer();
  const nextItem = buildAutoDemoSequence()[autoDemoStep];
  const keepCurrentDetail = artifactDetailOpen && nextItem
    && (nextItem.type === "artifact" || nextItem.type === "epitaph-open")
    && nextItem.narrativeId === activeNarrativeId;
  if (artifactDetailOpen && !keepCurrentDetail) closeArtifactDetail({ restore: false });
  autoDemoActive = true;
  syncAutoDemoUi();
  autoDemoTimer = setTimeout(runAutoDemoStep, 0);
}

function runAutoDemoStep() {
  if (!autoDemoActive) return;
  autoDemoTimer = 0;
  const sequence = buildAutoDemoSequence();
  if (autoDemoStep >= sequence.length) {
    if (artifactDetailOpen) closeArtifactDetail({ restore: false });
    closeNarrativeCard();
    autoDemoStep = 0;
    spatialReturnState = null;
    syncAutoDemoUi();
    navigateToOverall({ auto: true });
    autoDemoTimer = setTimeout(runAutoDemoStep, AUTO_TIMING.restart);
    return;
  }
  const item = sequence[autoDemoStep++];
  const entry = narrativeEntryById(item.narrativeId);
  if (!entry) {
    autoDemoTimer = setTimeout(runAutoDemoStep, 0);
    return;
  }
  if (item.type === "narrative") {
    navigateToNarrativeEntry(entry, { source: "auto" });
    autoDemoTimer = setTimeout(runAutoDemoStep, AUTO_TIMING.model);
    return;
  }
  if (item.type === "epitaph-open") {
    openEpitaphModal({ auto: true });
    syncAutoDemoUi();
    autoDemoTimer = setTimeout(runAutoDemoStep, AUTO_TIMING.epitaph);
    return;
  }
  if (item.type === "epitaph-close") {
    closeEpitaphModal();
    syncAutoDemoUi();
    autoDemoTimer = setTimeout(runAutoDemoStep, AUTO_TIMING.transition);
    return;
  }
  showNarrativeArtifact(entry, item, { source: "auto", auto: true });
  syncAutoDemoUi();
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

function applyViewLayerState(view) {
  document.querySelectorAll(".page-layer").forEach(layer => {
    const active = layer.id === `${view}-page`;
    layer.classList.toggle("active", active);
    layer.setAttribute("aria-hidden", String(!active));
  });
  const modelInterface = document.querySelector(".model-interface");
  const modelActive = view === "model";
  modelInterface?.setAttribute("aria-hidden", String(!modelActive));
  if (modelInterface) modelInterface.inert = !modelActive;
  document.querySelector("#app").dataset.view = view;
}

function setView(view, event) {
  if (!["home", "model"].includes(view)) return Promise.resolve(false);
  const app = document.querySelector("#app");
  const currentView = app?.dataset.view;
  if (view === currentView) return Promise.resolve(false);
  if (view === "home") {
    closeArtifactDetail({ restore: false });
    if (controls.enabled === false) {
      cameraMoveToken++;
      controls.enabled = true;
    }
    closeNarrativeCard();
    closeEpitaphModal();
  }
  playTransition(event);
  applyViewLayerState(view);
  return Promise.resolve(true);
}

function setupInterface() {
  const app = document.querySelector("#app");
  const veil = document.querySelector("#transition-veil");
  const modelInterface = document.querySelector(".model-interface");
  const modelInitiallyActive = app.dataset.view === "model";
  modelInterface.setAttribute("aria-hidden", String(!modelInitiallyActive));
  modelInterface.inert = !modelInitiallyActive;
  const artifactDetail = document.querySelector("#artifact-detail");
  if (artifactDetail) artifactDetail.inert = true;
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
    autoDemoStep = 0;
    setView("model", event);
    scheduleAutoDemo();
  };
  homePage.addEventListener("click", enterModel);
  homePage.addEventListener("keydown", enterModel);
  setupNarrativeAxis();
  const stage = document.querySelector(".artifact-stage");
  const artifactImage = document.querySelector("#artifact-image");
  artifactStageViewer = createArtifactStageViewer(document.querySelector("#artifact-model-canvas"));
  const artifactCatalog = {
    "镇墓兽": { en:"TOMB BEAST", asset:"/assets/artifacts/catalog/tomb-beast-east.png", location:"/assets/artifacts/location-tomb-beast.jpg", description:"泥质红陶模制，人面短柱冠，白地施红彩，胸前残留金箔痕迹，通高 36 厘米。", facts:[["编号","M2338:4"],["位置","墓室入口东侧"],["通高","36 cm"],["材质","泥质红陶"]], display:{ scale:1.12, x:"0%", y:"1%" } },
    "镇墓武士俑": { en:"GUARDIAN WARRIOR", asset:"/assets/artifacts/guardian-warrior-m2338-1.png", location:"/assets/artifacts/location-guardian-warrior.jpg", description:"镇墓武士俑 M2338:1 出自墓室入口处东侧，身着明光铠，体表施白、红彩，胸甲与护肩残留金箔痕迹。踏板厚 7 厘米、长 17 厘米、宽 19 厘米，通高 65 厘米。", facts:[["编号","M2338:1"],["位置","墓室入口处东侧"],["踏板","厚 7 cm / 长 17 cm / 宽 19 cm"],["通高","65 cm"]], display:{ scale:1.02, x:"0%", y:"0%" } },
    "墓志": { en:"EPITAPH", asset:"/assets/artifacts/catalog/epitaph-set.png", location:"/assets/artifacts/location-epitaph.jpg", description:"墓志由志盖与志石组成，青石质。志盖边长 30 cm、厚 8 cm；志石边长 37 cm、厚 8 cm，正文 23 行、满行 23 字，共 516 字。", facts:[["编号","M2338:52"],["志盖","边长 30 cm / 厚 8 cm"],["志石","边长 37 cm / 厚 8 cm"],["字数","516 字"]], display:{ scale:1.16, x:"0%", y:"0%" } },
    "铜钱": { en:"KAIYUAN COIN", asset:"/assets/artifacts/catalog/kaiyuan-coin.png", location:"/assets/artifacts/location-kaiyuan-coin.jpg", description:"圆形方孔钱，钱文为“开元通宝”。简报记载钱径 2.4 cm、穿径 0.8 cm，是墓葬断代的重要参照。", facts:[["编号","M2338:57-4"],["钱径","2.4 cm"],["穿径","0.8 cm"],["材质","铜"]], display:{ scale:1.42, x:"0%", y:"0%" } },
    "玻璃串珠": { en:"GLASS BEADS", asset:"/assets/artifacts/catalog/glass-beads.png", location:"/assets/artifacts/location-glass-beads.jpg", description:"玻璃串珠共 3 枚，绿色。简报记载直径 0.4-0.5 cm、孔径 0.3 cm，出自棺内北侧。", facts:[["编号","M2338:56"],["数量","3 枚"],["直径","0.4-0.5 cm"],["孔径","0.3 cm"]], display:{ scale:1.44, x:"0%", y:"0%" } },
    "贝壳": { en:"SHELL", asset:"/assets/artifacts/catalog/shell.png", location:"/assets/artifacts/location-shell.jpg", description:"天然贝壳随葬品，出自棺内北侧。简报记载最宽 4.5 cm、长 5.5 cm。", facts:[["编号","M2338:55"],["最宽","4.5 cm"],["长","5.5 cm"],["材质","贝壳"]], display:{ scale:1.44, x:"0%", y:"0%" } },
    "银环": { en:"SILVER RING", asset:"/assets/artifacts/catalog/silver-ring.png", location:"/assets/artifacts/location-silver-cup.jpg", description:"银环出自棺内北侧，扁圆环状。简报记载直径 1.8 cm。", facts:[["编号","M2338:54"],["类别","银环"],["直径","1.8 cm"],["材质","银"]], display:{ scale:1.34, x:"0%", y:"0%" } },
    "铜钵": { en:"BRONZE BOWL", asset:"/assets/artifacts/catalog/bronze-bowl.png", location:"/assets/artifacts/location-bronze-bowl.jpg", description:"铜钵敛口、深弧腹、圜底，器表饰数周暗弦纹。简报记载口径 13 cm、腹径 13.2 cm、底径 8.5 cm、通高 6 cm。", facts:[["编号","M2338:53"],["口径","13 cm"],["腹径","13.2 cm"],["通高","6 cm"]], display:{ scale:1.26, x:"0%", y:"2%" } },
    "骑马俑": { en:"MOUNTED FIGURINE", asset:"/assets/artifacts/catalog/mounted-figurine.png", location:"/assets/artifacts/location-mounted-figurine.jpg", description:"泥质红陶，分模制后粘合，骑手跨乘于马上。墓室东南隅与西壁龛均有发现；I 型标本马体长 23.5 厘米、通高 32 厘米。", facts:[["墓室","M2338:29-32 等"],["西壁龛","WK12"],["I 型","长 23.5 cm / 通高 32 cm"],["类别","陶骑马俑"]], display:{ scale:1.12, x:"0%", y:"0%" } },
    "风帽俑": { en:"HOODED FIGURINE", asset:"/assets/artifacts/catalog/fengmao-figurine.png", description:"泥质红陶，模制。头戴风帽，身着交领长袍，腰系带，左臂下垂，右臂弯曲。标本 M2338:7 通高 21.5 厘米，帽、袍残留红彩，面部施粉彩。", facts:[["代表器号","M2338:7"],["通高","21.5 cm"],["材质","泥质红陶"]], display:{ scale:1.08, x:"0%", y:"0%" } },
    "笼冠俑": { en:"CAGE-CROWN FIGURINE", asset:"/assets/artifacts/catalog/longguan-figurine.png", description:"泥质红陶，模制。头戴黑色笼冠，身着交领广袖袍，腰束宽带，双手捧于胸前。标本 M2338:28 通高 21.2 厘米，衣袍残留橘红色彩。", facts:[["代表器号","M2338:28"],["通高","21.2 cm"],["材质","泥质红陶"]], display:{ scale:1.08, x:"0%", y:"0%" } },
    "女侍俑": { en:"FEMALE ATTENDANT", asset:"/assets/artifacts/catalog/female-mounted-figurine.png", description:"泥质红陶，模制。高髻，面庞清瘦，身着交领窄袖衫与高束长裙，双手合拢置于腹部。标本 M2338:45 通高 28 厘米。", facts:[["代表器号","M2338:45"],["通高","28 cm"],["材质","泥质红陶"]], display:{ scale:1.08, x:"0%", y:"0%" } },
    "陶羊": { en:"POTTERY SHEEP", asset:"/assets/artifacts/catalog/sheep.png", description:"泥质红陶，模制。昂首盘角，小尖耳，身躯肥壮，四蹄盘卧于地，体表残留白色粉底。标本 M2338:39 体长 11.2 厘米、通高 9 厘米。", facts:[["代表器号","M2338:39"],["体长","11.2 cm"],["通高","9 cm"],["材质","泥质红陶"]], display:{ scale:1.18, x:"0%", y:"0%" } }
  };
  const artifactProgress = document.querySelector("#artifact-progress");
  const artifactPlaybackStatus = document.querySelector(".artifact-playback-status");
  const artifactDetails = document.querySelector("#artifact-details");
  let artifactImageRequestToken = 0;
  const activateArtifact = (artifactName, options = {}) => {
    const artifact = artifactCatalog[artifactName];
    if (!artifact) return false;
    const previousLocationKey = activeArtifactLocationKey;
    activeArtifactLocationKey = options.locationKey || "";
    const unchanged = activeArtifactName === artifactName && previousLocationKey === activeArtifactLocationKey;
    activeArtifactName = artifactName;
    updateArtifactSpatialLocation(activeArtifactName, activeArtifactLocationKey);
    if (artifactMiniState && options.focusCamera !== false) focusArtifactTopDown(artifactName, activeArtifactLocationKey);
    if (unchanged && !options.force) return false;
    const entry = narrativeEntryById(options.narrativeId || activeNarrativeId);
    const links = artifactLinksForEntry(entry);
    const artifactIndex = Math.max(0, links.findIndex(item => item.name === artifactName && item.locationKey === activeArtifactLocationKey));
    const artifactTotal = Math.max(1, links.length);
    document.querySelectorAll(".narrative-artifact-option").forEach(button => {
      const active = artifactDetailOpen
        && button.dataset.narrativeId === activeNarrativeId
        && button.dataset.artifact === artifactName
        && (button.dataset.locationKey || "") === activeArtifactLocationKey;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "true" : "false");
    });
    document.querySelector("#artifact-name-cn").textContent = artifactName;
    document.querySelector("#artifact-name-en").textContent = artifact?.en || "SELECTED OBJECT";
    document.querySelector("#artifact-description").textContent = artifact?.description || `${artifactName}的详细考古信息将依据发掘简报继续补充。`;
    artifactProgress.textContent = `${String(artifactIndex + 1).padStart(2, "0")} / ${String(artifactTotal).padStart(2, "0")}`;
    artifactPlaybackStatus.style.setProperty("--progress", `${(artifactIndex + 1) / artifactTotal * 100}%`);
    artifactDetails.hidden = artifactName !== "墓志";
    const asset = artifact?.asset;
    const modelId = artifact?.modelId;
    stage.classList.toggle("has-image", Boolean(asset));
    stage.classList.toggle("has-model", Boolean(modelId));
    if (modelId) artifactStageViewer.show(modelId).catch(error => console.error(`Artifact preview could not load: ${modelId}`, error));
    else artifactStageViewer.clear();
    const display = artifact?.display || {};
    stage.style.setProperty("--artifact-scale", display.scale ?? 1);
    stage.style.setProperty("--artifact-x", display.x || "0%");
    stage.style.setProperty("--artifact-y", display.y || "0%");
    if (asset) {
      const imageRequestToken = ++artifactImageRequestToken;
      stage.classList.add("image-loading");
      preloadArtifactImage(asset).then(() => {
        if (imageRequestToken !== artifactImageRequestToken) return;
        artifactImage.src = asset;
        artifactImage.alt = `${artifactName}考古文物图像`;
        stage.classList.remove("image-loading");
        stage.classList.remove("swap");
        requestAnimationFrame(() => stage.classList.add("swap"));
      }).catch(error => {
        if (imageRequestToken === artifactImageRequestToken) stage.classList.remove("image-loading");
        console.error(error);
      });
    } else {
      artifactImageRequestToken++;
      stage.classList.remove("image-loading");
    }
    const activeBranchButton = document.querySelector(".narrative-artifact-option.active");
    if ((options.auto || options.source === "narrative") && activeBranchButton) activeBranchButton.scrollIntoView({ block: "nearest", inline: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return true;
  };
  activateArtifactByName = (name, options = {}) => {
    return activateArtifact(name, { ...options, source: options.source || "linked" });
  };
  activateArtifact(ARTIFACT_SEQUENCE[0], { force: true, focusCamera: false });

  document.querySelector("#artifact-detail-close").addEventListener("click", event => {
    event.stopPropagation();
    rememberPlaybackPosition();
    stopAutoDemo();
    closeArtifactDetail();
    scheduleAutoDemo();
  });
  artifactDetails.addEventListener("click", event => {
    event.stopPropagation();
    openEpitaphModal();
  });
  document.querySelector(".epitaph-close").addEventListener("click", event => {
    event.stopPropagation();
    if (closeEpitaphModal(true)) {
      setAutoDemoResumeAfter({ type: "epitaph-close", narrativeId: "epitaph" });
      scheduleAutoDemo();
    }
  });
  const canParallax = matchMedia("(pointer:fine) and (prefers-reduced-motion:no-preference)").matches;
  document.addEventListener("pointermove", event => {
    noteUserActivity();
    if (!canParallax) return;
    pointer.x = event.clientX / innerWidth - .5; pointer.y = event.clientY / innerHeight - .5;
    canvas.style.transform = artifactDetailOpen ? "none" : `translate3d(${pointer.x * 3}px,${pointer.y * 2}px,0)`;
    stage.style.transform = `rotateY(${pointer.x * 5}deg) rotateX(${-pointer.y * 3}deg)`;
  });
  ["pointerdown", "wheel", "touchstart"].forEach(type => document.addEventListener(type, noteUserActivity, { passive: true }));
  controls.addEventListener("start", noteUserActivity);
  document.addEventListener("keydown", event => {
    noteUserActivity();
    if (event.key === "Escape") {
      if (closeEpitaphModal(true)) {
        setAutoDemoResumeAfter({ type: "epitaph-close", narrativeId: "epitaph" });
        scheduleAutoDemo();
        return;
      }
      if (closeArtifactDetail()) { scheduleAutoDemo(); return; }
      if (closeNarrativeCard()) return;
      if (app.dataset.view === "model") navigateToOverall();
      return;
    }
    if (isEpitaphModalOpen() && event.key === "Tab") {
      event.preventDefault();
      document.querySelector("#epitaph-modal .epitaph-close")?.focus({ preventScroll: true });
      return;
    }
    if (app.dataset.view !== "model" || artifactDetailOpen) return;
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    if (event.key === "Home" || event.key === "0") {
      navigateToOverall();
      rememberPlaybackPosition();
      return;
    }
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const current = order.indexOf(selectedIndex);
    const next = current < 0 ? (direction > 0 ? 0 : order.length - 1) : (current + direction + order.length) % order.length;
    navigateToStructure(order[next]);
    rememberPlaybackPosition();
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
  const response = await fetch("/geometry-export.json");
  if (!response.ok) throw new Error("无法读取 geometry-export.json");
  const data = await response.json();
  data.geometries.forEach(addStructure);
  data.geometries.forEach((item, index) => {
    if (item.vertices.length) structureTargets.set(index, boundsOf(item).getCenter(new THREE.Vector3()));
  });
  naturalShell = buildNaturalShell(data);
  structuralSkeletonLayer = buildStructuralSkeletonLayer(data);
  continuousVolumeLayer = buildContinuousVolumeLayer(data);
  sketchVolumeLayer = buildSketchVolumeLayer(data);
  groundLayer = buildGroundLayer(data);
  continuousVolumeLayer.renderOrder = -4;
  sketchVolumeLayer.renderOrder = -1;
  naturalShell.visible = false;
  groundLayer.visible = false;
  scene.add(continuousVolumeLayer, sketchVolumeLayer, groundLayer, structuralSkeletonLayer);
  await loadMainVisualModel().catch(error => {
    console.error("Main visual model could not be loaded", error);
    if (structuralSkeletonLayer) structuralSkeletonLayer.visible = true;
  });
  addConstructionGuides();
  addGroundCompass();
  buildControls(data);
  fitView();
  overallView = { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
  selectStructure(-1);
  setupInterface();
  logVisualProcess("连续实体底模完成：NPR 边缘来自测绘体量的深度/法线，不再依赖分块拼接线框");
  logVisualProcess("体量生成完成：测绘几何已作为 NPR 深度/法线底模");
  logVisualProcess("X-ray 内构层完成：内部结构以浅色铅笔线透出，并按深度自然衰减");
  const summary = document.querySelector("#geometry-summary");
  summary.textContent = `${data.summary.vertex_count} vertices / ${data.summary.edge_count} edges / loading artifacts`;
  loadBurialGoods().then(burialGoodsCount => {
    setBurialGoodsOpacity(selectedIndex < 0 || selectedIndex === 0 ? 1 : .45);
    summary.textContent = `${data.summary.vertex_count} vertices / ${data.summary.edge_count} edges / ${burialGoodsCount} artifacts`;
    logVisualProcess(`随葬品加载完成：${burialGoodsCount} 个点位，代表性模型优先`);
  }).catch(error => {
    summary.textContent = `${data.summary.vertex_count} vertices / ${data.summary.edge_count} edges / artifacts unavailable`;
    logVisualProcess("随葬品加载失败：主视觉保留体量和空间线稿");
    console.error("Burial goods could not be loaded", error);
  });
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  if (!clientWidth || !clientHeight) return;
  if (canvas.width !== clientWidth * renderer.getPixelRatio() || canvas.height !== clientHeight * renderer.getPixelRatio()) {
    renderer.setSize(clientWidth, clientHeight, false);
    wideMaterials.forEach(material => material.resolution.set(clientWidth, clientHeight));
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    sketchPipeline.setSize(clientWidth, clientHeight);
  }
}
function animate(now = 0) {
  resize();
  if (artifactLocationHalo?.visible && artifactLocationLayer?.visible) {
    const pulse = 1 + Math.sin(now * .0042) * .14;
    artifactLocationHalo.scale.setScalar(pulse);
    artifactLocationHalo.material.opacity = .32 + (Math.sin(now * .0042) + 1) * .1;
  }
  controls.update();
  normalizeGroundedCameraView();
  applyDepthAwareLineOpacity();
  sketchPipeline.render(now);
  requestAnimationFrame(animate);
}

init().catch(error => { document.querySelector("#status").textContent = error.message; console.error(error); });
animate();
