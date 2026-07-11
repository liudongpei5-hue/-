import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const STRUCTURE_NAMES = ["墓室", "甬道", "第三天井", "第三过洞", "第二天井", "第二过洞", "第一天井", "第一过洞", "墓道", "辅助线"];
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

const root = new THREE.Group();
scene.add(root);
const objects = [];
let selectedIndex = -1;

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

function geometryFrom(item) {
  const positions = [];
  for (const edge of item.edges) {
    positions.push(...item.vertices[edge.from_vertex_index].xyz_m, ...item.vertices[edge.to_vertex_index].xyz_m);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function addStructure(item, index) {
  if (!item.vertices.length || !item.edges.length) return;
  const group = new THREE.Group();
  group.userData = { index, name: STRUCTURE_NAMES[index] };
  const geo = geometryFrom(item);
  const main = new THREE.LineSegments(geo, material(0, .72));
  const echoA = new THREE.LineSegments(geo, material(1, .18));
  const echoB = new THREE.LineSegments(geo, material(2, .11));
  group.add(main, echoA, echoB);
  root.add(group);
  objects.push(group);
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
    group.children[0].material.uniforms.uOpacity.value = index < 0 ? .72 : active ? .94 : .12;
    group.children[1].material.uniforms.uOpacity.value = active ? .18 : .035;
    group.children[2].material.uniforms.uOpacity.value = active ? .11 : .02;
  });
  document.querySelectorAll(".structure-list button").forEach(button => button.classList.toggle("active", Number(button.dataset.index) === index));
  document.querySelector("#status").textContent = index < 0 ? "整体骨架 · 自由检查模式" : `${STRUCTURE_NAMES[index]} · 结构已突出`;
}

function buildControls(data) {
  const list = document.querySelector("#structure-list");
  data.geometries.forEach((item, index) => {
    if (!item.vertices.length) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = index;
    button.textContent = STRUCTURE_NAMES[index];
    button.addEventListener("click", () => selectStructure(index));
    list.append(button);
  });
  document.querySelector("#reset-view").addEventListener("click", () => { selectStructure(-1); fitView(); });
}

function bindSlider(id, callback) {
  const input = document.querySelector(`#${id}`);
  const output = document.querySelector(`#${id}-value`);
  input.addEventListener("input", () => { output.value = input.value; callback(Number(input.value)); });
}
bindSlider("density", value => objects.forEach(group => { const active = selectedIndex < 0 || group.userData.index === selectedIndex; group.children[0].material.uniforms.uOpacity.value = active ? value / 100 : value / 600; }));
bindSlider("jitter", value => objects.forEach(group => group.children.slice(1).forEach((line, i) => line.material.uniforms.uJitter.value = value / 4200 * (i + 1))));
bindSlider("grain", value => document.querySelector(".paper-grain").style.opacity = value / 100);

async function init() {
  const response = await fetch("/public/geometry-export.json");
  if (!response.ok) throw new Error("无法读取 geometry-export.json");
  const data = await response.json();
  data.geometries.forEach(addStructure);
  buildControls(data);
  fitView();
  selectStructure(-1);
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  if (canvas.width !== clientWidth * renderer.getPixelRatio() || canvas.height !== clientHeight * renderer.getPixelRatio()) {
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }
}
function animate() { resize(); controls.update(); renderer.render(scene, camera); requestAnimationFrame(animate); }

init().catch(error => { document.querySelector("#status").textContent = error.message; console.error(error); });
animate();
