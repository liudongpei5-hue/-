import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const FALLBACK_NAMES = ["墓室", "甬道", "第三天井", "第三过洞", "第二天井", "第二过洞", "第一天井", "第一过洞", "墓道", "D2", "D1", "东壁龛", "西壁龛"];
const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
scene.up.set(0, 0, 1);
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

const root = new THREE.Group();
scene.add(root);
const objects = [];
const wideMaterials = [];
let selectedIndex = -1;
let perspectiveGuides;
let naturalShell;
let groundLayer;
let overallView;
let cameraMoveToken = 0;
let dimensionAnchor = null;
const structureTargets = new Map();
const pointer = { x: 0, y: 0 };
const STRUCTURE_ORDER = [0, 1, 2, 3, 11, 12, 4, 5, 6, 7, 8, 9, 10];
const STRUCTURE_DIMENSIONS = {
  0: ["进深 3.68 米", "宽 3.04 米", "高 2.52 米"],
  1: ["进深 1.08 米", "宽 1.28 米", "高 1.92 米"],
  2: ["上口长 2.04 米", "南宽 1.16 米 · 北宽 1.28 米", "底长 1.80 米 · 宽 1.40-1.48 米"],
  3: ["进深 1.08 米", "宽 1.24 米", "高 1.76 米"],
  4: ["上口长 1.96 米", "南宽 1.00 米 · 北宽 0.96 米", "底长 1.80 米 · 宽 1.24-1.32 米"],
  5: ["进深 0.90 米", "宽 0.92 米", "高 1.60 米"],
  6: ["上口长 1.96 米 · 宽 1.08 米", "底长 1.70 米 · 宽 1.34 米", "南壁上口略有坍塌"],
  7: ["进深 1.08 米", "宽 1.24 米", "高 1.52 米"],
  8: ["开口长 5.52 米", "南宽 1.52 米 · 北宽 1.20 米", "最深 3.32 米 · 坡度 27°"],
  9: ["长约 0.60 米", "宽约 0.40 米", "椭圆形盗洞"],
  10: ["直径约 1.30 米", "圆形盗洞", "直达壁龛位置"],
  11: ["进深 1.80-1.90 米", "宽 1.40 米", "高 1.40 米 · 拱顶平底"],
  12: ["口深 0.50 米 · 口宽 1.92 米", "内宽 2.08 米", "进深 2.36-2.40 米 · 高 1.60 米"]
};
const CAMERA_PRESETS = {
  8: { position: [-12.8, 5.2, 8.3], target: [0, 0, 0], fov: 48 },
  7: { position: [-9.9, 6.0, 6.4], target: [0, 0, 0], fov: 48 },
  6: { position: [-7.6, 5.2, 9.0], target: [0, 0, 0], fov: 48 },
  5: { position: [-5.3, 6.4, 4.3], target: [0, 0, 0], fov: 48 },
  4: { position: [-5.6, 5.4, 8.9], target: [0, 0, 0], fov: 48 },
  3: { position: [-4.8, 7.7, 4.1], target: [0, 0, 0], fov: 48 },
  2: { position: [-1.7, 8.7, 10.6], target: [0, 0, 0], fov: 48 },
  1: { position: [-1.2, 10.8, -0.2], target: [0, 0, 0], fov: 48 },
  0: { position: [15.4, 10.8, -2.1], target: [0, 0, 0], fov: 48 },
  12: { position: [2.08, -3.7, -1.15], target: [2.08, 1.95, -1.55], fov: 45 }
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

function geometryFrom(item, layer = 0) {
  const positions = [];
  item.edges.forEach((edge, edgeIndex) => {
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
  camera.position.copy(center).add(new THREE.Vector3(radius * .85, -radius * 1.25, radius * .7));
  camera.fov = 38;
  camera.updateProjectionMatrix();
  controls.update();
}

function selectStructure(index) {
  selectedIndex = index;
  objects.forEach(group => {
    const active = index < 0 || group.userData.index === index;
    const isTheftShaft = group.userData.name === "D1" || group.userData.name === "D2";
    const { understroke, main, echoA, echoB } = group.userData.lines;
    understroke.material.opacity = index < 0 ? (isTheftShaft ? .26 : .12) : active ? .48 : .035;
    main.material.uniforms.uOpacity.value = index < 0 ? (isTheftShaft ? .62 : .3) : active ? .99 : .065;
    echoA.material.uniforms.uOpacity.value = index < 0 ? (isTheftShaft ? .18 : .09) : active ? .34 : .025;
    echoB.material.uniforms.uOpacity.value = index < 0 ? .075 : active ? .22 : .012;
    if (group.userData.interior) group.userData.interior.visible = index < 0 || active;
  });
  // Keep the post-JSON replacement skeleton appearance: only the 13 exported geometries render.
  if (naturalShell) naturalShell.visible = false;
  if (perspectiveGuides?.material) perspectiveGuides.material.opacity = index < 0 ? .11 : .045;
  document.querySelectorAll(".structure-list button").forEach(button => button.classList.toggle("active", Number(button.dataset.index) === index));
  document.querySelector(".structure-list .overall")?.classList.toggle("active", index < 0);
  const selected = objects.find(group => group.userData.index === index);
  document.querySelector("#status").textContent = index < 0 ? "整体骨架 · 自由检查模式" : `${selected?.userData.name || "结构"} · 结构已突出`;
  const callout = document.querySelector("#dimension-callout");
  if (index < 0 || !selected) {
    dimensionAnchor = null;
    callout.setAttribute("aria-hidden","true");
    callout.classList.remove("visible");
  } else {
    const box = new THREE.Box3().setFromObject(selected);
    dimensionAnchor = new THREE.Vector3(box.max.x, box.min.y, box.max.z);
    callout.querySelector("strong").textContent = selected.userData.name;
    callout.querySelector("p").textContent = (STRUCTURE_DIMENSIONS[index] || ["尺寸以考古简报为准"]).join(" ｜ ");
    callout.setAttribute("aria-hidden","false");
    callout.classList.add("visible");
  }
}

function buildControls(data) {
  const list = document.querySelector("#structure-list");
  const overallButton = document.createElement("button");
  overallButton.type = "button";
  overallButton.className = "overall active";
  overallButton.textContent = "整体";
  overallButton.addEventListener("click", navigateToOverall);
  list.append(overallButton);
  STRUCTURE_ORDER.forEach(index => {
    const item = data.geometries[index];
    if (!item.vertices.length) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = index;
    button.textContent = item.name || FALLBACK_NAMES[index] || `结构 ${index + 1}`;
    button.addEventListener("click", () => navigateToStructure(index));
    list.append(button);
  });
  document.querySelector("#reset-view").addEventListener("click", navigateToOverall);
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
  const lift = THREE.MathUtils.clamp(distance * .11, .7, 4.8);
  const controlA = startPosition.clone().lerp(endPosition, .3).add(new THREE.Vector3(0, 0, lift));
  const controlB = startPosition.clone().lerp(endPosition, .7).add(new THREE.Vector3(0, 0, lift * .72));
  const curve = new THREE.CubicBezierCurve3(startPosition, controlA, controlB, endPosition);
  const duration = THREE.MathUtils.clamp(1250 + distance * 62, 1450, 2850);
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

function navigateToStructure(index) {
  const group = objects.find(item => item.userData.index === index);
  if (!group) return;
  const geometricTarget = structureTargets.get(index) || new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
  const bbox = new THREE.Box3().setFromObject(group);
  const size = bbox.getSize(new THREE.Vector3()).length();
  const preset = CAMERA_PRESETS[index];
  const target = preset ? new THREE.Vector3(...preset.target) : geometricTarget;
  const endPosition = preset ? new THREE.Vector3(...preset.position) : target.clone().add(new THREE.Vector3(size * .8, -size * 1.15, size * .65));
  selectStructure(index);
  animateCamera(endPosition, target, preset?.fov || 42, () => {
    document.querySelector("#status").textContent = `${group.userData.name} · 特写视角`;
  });
}

function navigateToOverall() {
  if (!overallView) return;
  selectStructure(-1);
  animateCamera(overallView.position.clone(), overallView.target.clone(), overallView.fov, () => {
    document.querySelector("#status").textContent = "整体结构 · OVERVIEW";
  });
}

function playTransition(origin) {
  const veil = document.querySelector("#transition-veil");
  if (origin) { veil.style.setProperty("--x", `${origin.clientX / innerWidth * 100}%`); veil.style.setProperty("--y", `${origin.clientY / innerHeight * 100}%`); }
  veil.classList.remove("play"); void veil.offsetWidth; veil.classList.add("play");
}

function setView(view, event) {
  playTransition(event);
  document.querySelectorAll(".page-layer").forEach(layer => { const active = layer.id === `${view}-page`; layer.classList.toggle("active", active); layer.setAttribute("aria-hidden", String(!active)); });
  document.querySelector("#app").dataset.view = view;
}

function setupInterface() {
  const app = document.querySelector("#app");
  const veil = document.querySelector("#transition-veil");
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
  document.querySelector("#menu-trigger").addEventListener("click", event => setView(app.dataset.view === "menu" ? "model" : "menu", event));
  const navButtons = [...document.querySelectorAll(".chapter-nav button")];
  navButtons.forEach((button, index) => {
    button.addEventListener("mouseenter", () => { document.querySelector(".menu-progress i").style.transform = `translateY(${index * 100}%)`; document.querySelector(".menu-progress span").textContent = `0${index + 1} / 04`; });
    button.addEventListener("click", event => setView(button.dataset.target, event));
  });
  const stage = document.querySelector(".artifact-stage");
  const artifactImage = document.querySelector("#artifact-image");
  const artifactAssets = {
    "镇墓武士俑": "/public/assets/artifacts/guardian-warrior-m2338-1.png",
    "镇墓兽": "/public/assets/artifacts/tomb-beast-m2338-2.png"
  };
  Object.values(artifactAssets).forEach(src => {
    const image = new Image();
    image.src = src;
    image.decode?.().catch(() => {});
  });
  const artifactText = {
    "镇墓武士俑":"泥质红陶，模制。出土于墓室入口处东侧，通高约65厘米。体表原施白、红彩，胸甲与护肩残存少量金箔痕迹。",
    "镇墓兽":"泥质红陶，模制。两件分置墓室入口东西两侧，具有镇护墓门的象征意义。",
    "骑马俑":"共11件，主要出土于墓室东南隅。人物服饰与马具保留了明确的时代信息。",
    "铜钵":"出土于墓室东壁下偏中，敛口、深弧腹、圜底，器表饰数周暗弦纹。"
  };
  const artifactButtons = [...document.querySelectorAll(".artifact-list button")];
  const activateArtifact = button => {
    artifactButtons.forEach(item => item.classList.toggle("active", item === button));
    document.querySelector(".artifact-copy h2 span").textContent = button.dataset.artifact;
    document.querySelector(".artifact-copy>p:not(.artifact-kicker)").textContent = artifactText[button.dataset.artifact] || `${button.dataset.artifact}的详细考古信息将依据发掘简报继续补充。`;
    const asset = artifactAssets[button.dataset.artifact];
    stage.classList.toggle("has-image", Boolean(asset));
    if (asset) artifactImage.src = asset;
    stage.classList.remove("swap"); void stage.offsetWidth; stage.classList.add("swap");
  };
  artifactButtons.forEach(button => { button.addEventListener("mouseenter", () => activateArtifact(button)); button.addEventListener("click", () => activateArtifact(button)); });
  const canParallax = matchMedia("(pointer:fine) and (prefers-reduced-motion:no-preference)").matches;
  document.addEventListener("pointermove", event => {
    if (!canParallax) return;
    pointer.x = event.clientX / innerWidth - .5; pointer.y = event.clientY / innerHeight - .5;
    canvas.style.transform = `translate3d(${pointer.x * 3}px,${pointer.y * 2}px,0)`;
    stage.style.transform = `rotateY(${pointer.x * 5}deg) rotateX(${-pointer.y * 3}deg)`;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") { setView(app.dataset.view === "model" ? "menu" : "model", event); return; }
    if (app.dataset.view !== "model") return;
    const order = [8, 7, 6, 5, 4, 3, 2, 1, 0];
    if (event.key === "Home" || event.key === "0") { navigateToOverall(); return; }
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const current = order.indexOf(selectedIndex);
    const next = current < 0 ? (direction > 0 ? 0 : order.length - 1) : (current + direction + order.length) % order.length;
    navigateToStructure(order[next]);
  });
}

function bindSlider(id, callback) {
  const input = document.querySelector(`#${id}`);
  const output = document.querySelector(`#${id}-value`);
  input.addEventListener("input", () => { output.value = input.value; callback(Number(input.value)); });
}
bindSlider("density", value => objects.forEach(group => { const active = selectedIndex < 0 || group.userData.index === selectedIndex; const { understroke, main } = group.userData.lines; main.material.uniforms.uOpacity.value = active ? value / 100 : value / 600; understroke.material.opacity = active ? value / 245 : value / 900; }));
bindSlider("jitter", value => objects.forEach(group => [group.userData.lines.main, group.userData.lines.echoA, group.userData.lines.echoB].forEach((line, i) => line.material.uniforms.uJitter.value = value / 9000 * (i + 1))));
bindSlider("grain", value => document.querySelector(".paper-grain").style.opacity = value / 100);

async function init() {
  const response = await fetch("/public/geometry-export.json?v=20260711-new-13");
  if (!response.ok) throw new Error("无法读取 geometry-export.json");
  const data = await response.json();
  data.geometries.forEach(addStructure);
  data.geometries.forEach((item, index) => {
    if (item.vertices.length) structureTargets.set(index, boundsOf(item).getCenter(new THREE.Vector3()));
  });
  document.querySelector("#geometry-summary").textContent = `${data.summary.vertex_count} vertices / ${data.summary.edge_count} edges`;
  naturalShell = buildNaturalShell(data);
  groundLayer = buildGroundLayer(data);
  scene.add(naturalShell, groundLayer);
  addConstructionGuides();
  buildControls(data);
  fitView();
  overallView = { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
  selectStructure(-1);
  setupInterface();
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
function updateDimensionCallout() {
  if (!dimensionAnchor) return;
  const callout = document.querySelector("#dimension-callout");
  if (!callout.classList.contains("visible")) return;
  const projected = dimensionAnchor.clone().project(camera);
  const x = (projected.x * .5 + .5) * canvas.clientWidth;
  const y = (-projected.y * .5 + .5) * canvas.clientHeight;
  const panel = callout.querySelector("div").getBoundingClientRect();
  const endX = panel.left;
  const endY = panel.top + panel.height * .5;
  const dx = endX - x, dy = endY - y;
  const length = Math.hypot(dx,dy);
  const line = callout.querySelector("i");
  const origin = callout.querySelector(".dimension-origin");
  origin.style.transform = `translate(${x}px,${y}px)`;
  line.style.width = `${length}px`;
  line.style.transform = `translate(${x}px,${y}px) rotate(${Math.atan2(dy,dx)}rad)`;
  callout.classList.toggle("offscreen", projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2);
}
function animate() { resize(); controls.update(); updateDimensionCallout(); renderer.render(scene, camera); requestAnimationFrame(animate); }

init().catch(error => { document.querySelector("#status").textContent = error.message; console.error(error); });
animate();
