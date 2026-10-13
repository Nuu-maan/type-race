import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { TRACK } from "./game";

export const METERS_PER_UNIT = 2;

export type SceneCar = {
  pos: number;
  body: string;
  speed: number;
  slip: boolean;
  nitro: boolean;
  name: string;
  color: string;
};

const LANE_W = 2.6;
const LANE_X = [-2, -1, 0, 1, 2].map((k) => k * LANE_W);
const LANE_SETS: Record<number, number[]> = { 1: [2], 2: [1, 3], 3: [1, 2, 3], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4] };
const ROAD_W = LANE_W * 5 + 1.6;

export function laneX(index: number, count: number) {
  return LANE_X[LANE_SETS[count]?.[index] ?? 2]!;
}
const ROAD_LEN = 760;
const FOG_NEAR = 80;
const FOG_FAR = 620;
const SKY_TOP = new THREE.Color("#070a1f");
const SKY_MID = new THREE.Color("#2b1450");
const HORIZON = new THREE.Color("#ff6a4d");
const FOG = new THREE.Color("#2a1440");

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hdr(color: string, k: number) {
  return new THREE.Color(color).multiplyScalar(k);
}

function roadTexture() {
  const pxPerM = 1024 / 24;
  return canvasTexture(512, 1024, (g) => {
    g.fillStyle = "#24212b";
    g.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 9000; i++) {
      const v = 30 + Math.random() * 30;
      g.fillStyle = `rgb(${v},${v - 2},${v + 6})`;
      g.fillRect(Math.random() * 512, Math.random() * 1024, 2, 2);
    }
    const mx = (m: number) => ((m + ROAD_W / 2) / ROAD_W) * 512;
    for (const lane of LANE_X) {
      const grad = g.createLinearGradient(mx(lane - 1.4), 0, mx(lane + 1.4), 0);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.3, "rgba(0,0,0,0.18)");
      grad.addColorStop(0.7, "rgba(0,0,0,0.18)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(mx(lane - 1.4), 0, mx(lane + 1.4) - mx(lane - 1.4), 1024);
    }
    const line = 0.15 * (512 / ROAD_W);
    g.fillStyle = "#e9e6f0";
    for (const edge of [-ROAD_W / 2 + 0.35, ROAD_W / 2 - 0.5]) g.fillRect(mx(edge), 0, line, 1024);
    g.fillStyle = "rgba(233,230,240,0.7)";
    for (const divider of [-1.5, -0.5, 0.5, 1.5]) {
      for (let k = 0; k < 4; k++) g.fillRect(mx(divider * LANE_W) - line / 2, k * 6 * pxPerM, line, 3 * pxPerM);
    }
  });
}

function kerbTexture() {
  return canvasTexture(8, 64, (g) => {
    g.fillStyle = "#e23b3b";
    g.fillRect(0, 0, 8, 32);
    g.fillStyle = "#f2f2f2";
    g.fillRect(0, 32, 8, 32);
  });
}

function windowTexture() {
  return canvasTexture(64, 128, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 124; y += 8) {
      for (let x = 4; x < 60; x += 8) {
        if (Math.random() < 0.28) {
          g.fillStyle = Math.random() < 0.7 ? "#ffcf8a" : "#7fd8ff";
          g.fillRect(x, y, 4, 5);
        }
      }
    }
  });
}

function radialTexture(inner: string, outer: string) {
  return canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
}

function bannerTexture(label: string, checker: boolean) {
  return canvasTexture(1024, 128, (g) => {
    g.fillStyle = "#111";
    g.fillRect(0, 0, 1024, 128);
    if (checker) {
      for (let x = 0; x < 1024; x += 32) {
        for (let y = 0; y < 128; y += 32) {
          if ((x + y) / 32 % 2 === 0) {
            g.fillStyle = "#f5f5f5";
            g.fillRect(x, y, 32, 32);
          }
        }
      }
    }
    g.fillStyle = "#111";
    g.beginPath();
    g.roundRect(352, 20, 320, 88, 16);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "700 64px 'Public Sans', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, 512, 68);
  });
}

function labelTexture(text: string) {
  return canvasTexture(256, 64, (g) => {
    g.font = "600 30px 'Public Sans', sans-serif";
    const w = Math.min(240, g.measureText(text).width + 32);
    g.fillStyle = "rgba(10,10,20,0.7)";
    g.beginPath();
    g.roundRect(128 - w / 2, 8, w, 48, 14);
    g.fill();
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 128, 33, 220);
  });
}

function makeSky() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1800, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: SKY_TOP }, mid: { value: SKY_MID }, horizon: { value: HORIZON } },
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.14, h));
          c = mix(c, top, smoothstep(0.14, 0.6, h));
          gl_FragColor = vec4(h < 0.0 ? horizon * 0.5 : c, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
}

function makeSun() {
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(170, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv;
        void main() {
          vec3 c = mix(vec3(3.0, 0.55, 0.45), vec3(3.2, 2.4, 0.9), smoothstep(0.2, 0.9, vUv.y));
          float band = step(0.5, fract(vUv.y * 14.0 - 0.2)) + step(0.52, vUv.y);
          if (band < 0.5 && vUv.y < 0.52) discard;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  sun.position.set(0, 60, -1650);
  return sun;
}

function makeMountains(z: number, color: string, height: number, seed: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-2600, -20);
  let h = height * 0.5;
  for (let x = -2600; x <= 2600; x += 60) {
    h = Math.max(height * 0.15, Math.min(height, h + (Math.sin(x * 0.013 + seed) + Math.sin(x * 0.0041 + seed * 2)) * height * 0.12));
    shape.lineTo(x, h);
  }
  shape.lineTo(2600, -20);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, fog: false }));
  mesh.position.z = z;
  return mesh;
}

function makeGround() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      offset: { value: 0 },
      fogColor: { value: FOG },
      line: { value: hdr("#ff3df2", 0.45) },
    },
    vertexShader: `varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float offset; uniform vec3 fogColor; uniform vec3 line; varying vec3 vWorld;
      void main() {
        vec2 p = vec2(vWorld.x, vWorld.z - offset) / 12.0;
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        float l = 1.0 - min(min(g.x, g.y), 1.0);
        float d = length(vWorld.xz - cameraPosition.xz);
        vec3 c = vec3(0.035, 0.02, 0.06) + line * l * (1.0 - smoothstep(60.0, 420.0, d));
        c = mix(c, fogColor, smoothstep(${FOG_NEAR.toFixed(1)}, ${FOG_FAR.toFixed(1)}, d));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 2400), mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, -900);
  return { ground, mat };
}

function repeater(spacing: number, count: number, build: (z: number, group: THREE.Group) => void) {
  const group = new THREE.Group();
  for (let k = -1; k <= count + 1; k++) build(-k * spacing, group);
  return { group, spacing };
}

type BodySpec = {
  chassis: [number, number, number];
  nose: [number, number, number, number];
  cabin: [number, number, number, number, number];
  roof: boolean;
  wing: "low" | "tall" | "lip";
  stripes: number[];
  scoop: boolean;
  fins: boolean;
};

const BODY_SPECS: Record<string, BodySpec> = {
  gt: { chassis: [2.0, 0.55, 0.55], nose: [1.9, 0.3, 0.4, -2.05], cabin: [1.55, 0.5, 2.1, 0.98, 0.25], roof: true, wing: "low", stripes: [0], scoop: false, fins: false },
  muscle: { chassis: [2.15, 0.68, 0.6], nose: [2.05, 0.42, 0.5, -2.05], cabin: [1.6, 0.48, 1.8, 1.1, 0.55], roof: true, wing: "lip", stripes: [-0.22, 0.22], scoop: true, fins: false },
  hyper: { chassis: [2.05, 0.42, 0.45], nose: [1.95, 0.2, 0.3, -2.0], cabin: [1.35, 0.4, 1.7, 0.82, 0.05], roof: false, wing: "tall", stripes: [0], scoop: false, fins: true },
};

function buildShell(body: THREE.Group, spec: BodySpec, paint: THREE.Material, glass: THREE.Material, dark: THREE.Material) {
  const [cw, ch, cy] = spec.chassis;
  const chassis = new THREE.Mesh(new RoundedBoxGeometry(cw, ch, 4.5, 4, Math.min(0.2, ch / 2.5)), paint);
  chassis.position.y = cy;
  const [nw, nh, ny, nz] = spec.nose;
  const nose = new THREE.Mesh(new RoundedBoxGeometry(nw, nh, 1.2, 4, Math.min(0.14, nh / 2.5)), paint);
  nose.position.set(0, ny, nz);
  const [kw, kh, kl, ky, kz] = spec.cabin;
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(kw, kh, kl, 4, 0.2), glass);
  cabin.position.set(0, ky, kz);
  body.add(chassis, nose, cabin);
  const top = cy + ch / 2;
  if (spec.roof) {
    const roof = new THREE.Mesh(new RoundedBoxGeometry(kw - 0.15, 0.08, kl * 0.62, 2, 0.04), paint);
    roof.position.set(0, ky + kh / 2, kz + 0.1);
    body.add(roof);
  }
  if (spec.wing === "lip") {
    const lip = new THREE.Mesh(new RoundedBoxGeometry(cw - 0.15, 0.1, 0.32, 2, 0.04), paint);
    lip.position.set(0, top + 0.04, 2.08);
    body.add(lip);
  } else {
    const tall = spec.wing === "tall";
    const wing = new THREE.Mesh(new RoundedBoxGeometry(tall ? 2.3 : 2.1, 0.07, tall ? 0.6 : 0.45, 2, 0.03), dark);
    const height = tall ? 0.75 : 0.35;
    wing.position.set(0, top + height + 0.1, 2.05);
    body.add(wing);
    for (const x of [-0.6, 0.6]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, height, 0.16), dark);
      strut.position.set(x, top + height / 2 + 0.1, 2.0);
      body.add(strut);
    }
  }
  const stripeMat = new THREE.MeshStandardMaterial({ color: "#f5f5f5", roughness: 0.4 });
  for (const x of spec.stripes) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(spec.stripes.length > 1 ? 0.2 : 0.34, 0.01, 4.4), stripeMat);
    stripe.position.set(x, top + 0.005, 0);
    body.add(stripe);
  }
  if (spec.scoop) {
    const scoop = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.18, 0.8, 2, 0.06), dark);
    scoop.position.set(0, top + 0.08, -1.1);
    body.add(scoop);
  }
  if (spec.fins) {
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.32, 1.3, 2, 0.03), paint);
      fin.position.set(side * (cw / 2 - 0.04), top + 0.14, 1.4);
      body.add(fin);
    }
  }
}

function makeCar(color: string, bodyId: string) {
  const car = new THREE.Group();
  const body = new THREE.Group();
  car.add(body);

  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#0b0d14", metalness: 0.9, roughness: 0.06 });
  const dark = new THREE.MeshStandardMaterial({ color: "#121216", roughness: 0.7 });
  const rimMat = new THREE.MeshStandardMaterial({ color: "#c9ccd6", metalness: 0.9, roughness: 0.25 });
  const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 24);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.34, 6);
  rimGeo.rotateZ(Math.PI / 2);

  buildShell(body, BODY_SPECS[bodyId] ?? BODY_SPECS.gt!, paint, glass, dark);

  const head = new THREE.MeshBasicMaterial({ color: hdr("#e8f2ff", 1.6) });
  for (const x of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.02), head);
    lamp.position.set(x, 0.46, -2.66);
    body.add(lamp);
  }
  const tail = new THREE.MeshBasicMaterial({ color: hdr("#ff2340", 2) });
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.05), tail);
  tailBar.position.set(0, 0.72, 2.26);
  body.add(tailBar);
  for (const x of [-0.72, 0.72]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.06), tail);
    lamp.position.set(x, 0.62, 2.26);
    body.add(lamp);
  }
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.3), dark);
  diffuser.position.set(0, 0.3, 2.12);
  body.add(diffuser);
  const pipeGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.2, 14);
  pipeGeo.rotateX(Math.PI / 2);
  for (const x of [-0.45, 0.45]) {
    const pipe = new THREE.Mesh(pipeGeo, rimMat);
    pipe.position.set(x, 0.32, 2.3);
    body.add(pipe);
  }
  for (const side of [-1, 1]) {
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.14, 0.2, 2, 0.05), paint);
    mirror.position.set(side * 0.95, 0.92, -0.6);
    body.add(mirror);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.9), dark);
    intake.position.set(side * 1.0, 0.55, 0.9);
    body.add(intake);
  }

  const wheels: THREE.Group[] = [];
  for (const [x, z] of [[-0.98, -1.45], [0.98, -1.45], [-0.98, 1.45], [0.98, 1.45]] as const) {
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(tireGeo, dark), new THREE.Mesh(rimGeo, rimMat));
    wheel.position.set(x, 0.38, z);
    car.add(wheel);
    wheels.push(wheel);
  }

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 6),
    new THREE.MeshBasicMaterial({
      map: radialTexture(color, "rgba(0,0,0,0)"),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.8,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.2),
    new THREE.MeshBasicMaterial({ map: radialTexture("rgba(0,0,0,0.85)", "rgba(0,0,0,0)"), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 14),
    new THREE.MeshBasicMaterial({
      map: radialTexture("rgba(255,244,220,0.35)", "rgba(0,0,0,0)"),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0, 0.03, -9);
  car.add(glow, shadow, beam);

  const flameMat = new THREE.MeshBasicMaterial({ color: hdr("#59a8ff", 4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames: THREE.Mesh[] = [];
  for (const x of [-0.45, 0.45]) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.4, 12), flameMat);
    flame.rotation.x = Math.PI / 2;
    flame.position.set(x, 0.42, 3.0);
    flame.visible = false;
    car.add(flame);
    flames.push(flame);
  }

  return { car, body, wheels, tail, glow, beam, flames, prevSpeed: 0, accel: 0 };
}

type Car = ReturnType<typeof makeCar> & { label: THREE.Sprite | null; labelText: string; key: string };

export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, FOG_NEAR, FOG_FAR);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 4000);

  scene.add(new THREE.HemisphereLight("#7a5cc4", "#140b1e", 1.4));
  const sunLight = new THREE.DirectionalLight("#ff9a6b", 2.2);
  sunLight.position.set(0, 12, -40);
  const fill = new THREE.DirectionalLight("#bfd4ff", 1.1);
  fill.position.set(6, 10, 14);
  scene.add(sunLight, fill);

  const sky = makeSky();
  scene.add(sky, makeSun(), makeMountains(-1450, "#3a1a52", 260, 1.3), makeMountains(-1200, "#1d0f30", 170, 4.1));
  const { ground, mat: groundMat } = makeGround();
  scene.add(ground);

  const roadTex = roadTexture();
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1, ROAD_LEN / 24);
  roadTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82 }));
  road.rotation.x = -Math.PI / 2;
  road.position.z = -ROAD_LEN / 2 + 40;
  scene.add(road);

  const kerbTex = kerbTexture();
  kerbTex.wrapS = kerbTex.wrapT = THREE.RepeatWrapping;
  kerbTex.repeat.set(1, ROAD_LEN / 2.4);
  for (const side of [-1, 1]) {
    const kerb = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, ROAD_LEN),
      new THREE.MeshStandardMaterial({ map: kerbTex, emissiveMap: kerbTex, emissive: "#ffffff", emissiveIntensity: 0.18, roughness: 0.6 }),
    );
    kerb.rotation.x = -Math.PI / 2;
    kerb.position.set(side * (ROAD_W / 2 + 0.4), 0.04, road.position.z);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.9, ROAD_LEN), new THREE.MeshStandardMaterial({ color: "#2c2a36", roughness: 0.5, metalness: 0.4 }));
    wall.position.set(side * (ROAD_W / 2 + 2.3), 0.45, road.position.z);
    const neon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, ROAD_LEN), new THREE.MeshBasicMaterial({ color: hdr(side < 0 ? "#2de2ff" : "#ff3df2", 1.4) }));
    neon.position.set(side * (ROAD_W / 2 + 2.15), 0.86, road.position.z);
    scene.add(kerb, wall, neon);
  }

  const repeaters: { group: THREE.Group; spacing: number }[] = [];

  const postGeo = new THREE.BoxGeometry(0.2, 1.1, 0.2);
  const postMat = new THREE.MeshStandardMaterial({ color: "#4a4658", metalness: 0.6, roughness: 0.4 });
  repeaters.push(
    repeater(6, Math.ceil(FOG_FAR / 6), (z, g) => {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(side * (ROAD_W / 2 + 2.6), 0.55, z);
        g.add(post);
      }
    }),
  );

  const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 8, 8);
  const armGeo = new THREE.BoxGeometry(2.6, 0.12, 0.12);
  const lampGeo = new THREE.BoxGeometry(1.1, 0.14, 0.4);
  const lampMat = new THREE.MeshBasicMaterial({ color: hdr("#ffd59a", 4) });
  const pool = new THREE.MeshBasicMaterial({
    map: radialTexture("rgba(255,200,140,0.32)", "rgba(0,0,0,0)"),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const poolGeo = new THREE.PlaneGeometry(9, 9);
  repeaters.push(
    repeater(40, Math.ceil(FOG_FAR / 40), (z, g) => {
      for (const side of [-1, 1]) {
        const x = side * (ROAD_W / 2 + 3.2);
        const pole = new THREE.Mesh(poleGeo, postMat);
        pole.position.set(x, 4, z);
        const arm = new THREE.Mesh(armGeo, postMat);
        arm.position.set(x - side * 1.2, 7.9, z);
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(x - side * 2.2, 7.8, z);
        const light = new THREE.Mesh(poolGeo, pool);
        light.rotation.x = -Math.PI / 2;
        light.position.set(x - side * 3.4, 0.035, z);
        g.add(pole, arm, lamp, light);
      }
    }),
  );

  const windows = windowTexture();
  const buildingMat = new THREE.MeshStandardMaterial({ color: "#14101f", emissive: "#ffffff", emissiveMap: windows, emissiveIntensity: 1.6, roughness: 0.9 });
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const period = 1200;
  const buildings = Array.from({ length: 60 }, (_, i) => {
    const h = 18 + Math.random() * 90;
    return {
      scale: new THREE.Vector3(14 + Math.random() * 26, h, 14 + Math.random() * 20),
      x: (i % 2 ? 1 : -1) * (40 + Math.random() * 160),
      y: h / 2,
      z: -Math.random() * period,
    };
  });
  repeaters.push(
    repeater(period, 0, (z, g) => {
      for (const spec of buildings) {
        const b = new THREE.Mesh(buildingGeo, buildingMat);
        b.scale.copy(spec.scale);
        b.position.set(spec.x, spec.y, z + spec.z);
        g.add(b);
      }
    }),
  );
  for (const r of repeaters) scene.add(r.group);

  function gantry(label: string, checker: boolean) {
    const g = new THREE.Group();
    const banner = new THREE.MeshStandardMaterial({ map: bannerTexture(label, checker), emissive: "#ffffff", emissiveMap: bannerTexture(label, checker), emissiveIntensity: 0.6 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 5, 1.5, 0.5), [postMat, postMat, postMat, postMat, banner, banner]);
    beam.position.y = 7.2;
    g.add(beam);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), postMat);
      pillar.position.set(side * (ROAD_W / 2 + 2.2), 4, 0);
      g.add(pillar);
    }
    if (checker) {
      const tex = canvasTexture(256, 32, (c) => {
        for (let x = 0; x < 256; x += 16) for (let y = 0; y < 32; y += 16) {
          c.fillStyle = (x + y) / 16 % 2 ? "#111" : "#f2f2f2";
          c.fillRect(x, y, 16, 16);
        }
      });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 1.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
      strip.rotation.x = -Math.PI / 2;
      strip.position.y = 0.04;
      g.add(strip);
    }
    scene.add(g);
    return g;
  }
  const startGantry = gantry("START", false);
  const finishGantry = gantry("FINISH", true);

  const cars: Car[] = [];
  function ensureCars(list: SceneCar[]) {
    list.forEach((spec, i) => {
      const key = `${spec.color}/${spec.body}`;
      if (cars[i]?.key === key) return;
      cars[i]?.car.removeFromParent();
      const c = makeCar(spec.color, spec.body);
      scene.add(c.car);
      cars[i] = { ...c, label: null, labelText: "", key };
    });
    for (const extra of cars.splice(list.length)) extra.car.removeFromParent();
  }

  const SPEED_LINES = 90;
  const linePos = new Float32Array(SPEED_LINES * 6);
  const lineSeed = Array.from({ length: SPEED_LINES }, () => respawnLine());
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const speedLines = new THREE.LineSegments(lineGeo, lineMat);
  speedLines.frustumCulled = false;
  scene.add(speedLines);

  function respawnLine(z = -70 - Math.random() * 30) {
    let x = 0;
    let y = 0;
    do {
      x = (Math.random() - 0.5) * 34;
      y = 0.4 + Math.random() * 10;
    } while (Math.abs(x) < 9 && y < 6);
    return { x, y, z };
  }

  const smokeTex = radialTexture("rgba(220,215,235,0.55)", "rgba(220,215,235,0)");
  const smoke = Array.from({ length: 40 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    scene.add(s);
    return { s, life: 0 };
  });
  let smokeIndex = 0;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let fov = 60;
  let time = 0;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(devicePixelRatio, 1.5);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(ratio);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render(dt: number, list: SceneCar[], meIndex: number) {
    time += dt;
    ensureCars(list);
    const me = list[meIndex] ?? list[0];
    if (!me) return;
    const myZ = me.pos * METERS_PER_UNIT;
    const mySpeed = me.speed * METERS_PER_UNIT;
    const kmh = mySpeed * 3.6;
    const fast = Math.min(1, kmh / 260);

    roadTex.offset.y = (myZ / 24) % 1;
    kerbTex.offset.y = (myZ / 2.4) % 1;
    groundMat.uniforms.offset!.value = myZ;
    for (const r of repeaters) r.group.position.z = myZ % r.spacing;
    startGantry.position.z = myZ - 4;
    finishGantry.position.z = -(TRACK * METERS_PER_UNIT - myZ) - 2.3;

    list.forEach((c, i) => {
      const car = cars[i]!;
      const z = -(c.pos - me.pos) * METERS_PER_UNIT;
      const x = laneX(i, list.length);
      car.car.position.set(x, 0, z);
      const speed = c.speed * METERS_PER_UNIT;
      const accel = dt ? (speed - car.prevSpeed) / dt : 0;
      car.prevSpeed = speed;
      car.accel += (accel - car.accel) * Math.min(1, dt * 6);
      car.body.rotation.x = THREE.MathUtils.clamp(car.accel * 0.006, -0.05, 0.05);
      car.body.position.y = Math.sin(time * 18 + i) * 0.012 * Math.min(1, speed / 30);
      car.car.rotation.y = c.slip ? Math.sin(time * 38 + i) * 0.05 : car.car.rotation.y * 0.85;
      for (const w of car.wheels) w.rotation.x -= (speed * dt) / 0.38;
      const braking = car.accel < -2 ? 1 : 0;
      car.tail.color.set("#ff2340").multiplyScalar(2 + braking * 4);
      (car.glow.material as THREE.MeshBasicMaterial).opacity = c.nitro ? 1 : 0.7;
      for (const f of car.flames) {
        f.visible = c.nitro;
        f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
      }
      if (c.slip && Math.random() < 0.7) {
        for (const side of [-0.9, 0.9]) {
          const p = smoke[smokeIndex++ % smoke.length]!;
          p.life = 1;
          p.s.visible = true;
          p.s.position.set(car.car.position.x + side, 0.35, z + 1.6);
          p.s.scale.setScalar(0.45);
        }
      }
      if (i !== meIndex && car.labelText !== c.name) {
        car.labelText = c.name;
        car.label?.removeFromParent();
        car.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(c.name), depthWrite: false, fog: false }));
        car.label.scale.set(4, 1, 1);
        car.label.position.set(0, 2.4, 0);
        car.car.add(car.label);
      }
    });

    for (const p of smoke) {
      if (p.life <= 0) continue;
      p.life -= dt * 1.4;
      p.s.position.z += mySpeed * dt * 0.6;
      p.s.position.y += dt * 0.6;
      p.s.scale.multiplyScalar(1 + dt * 1.1);
      p.s.material.opacity = Math.max(0, p.life) * 0.35;
      if (p.life <= 0) p.s.visible = false;
    }

    lineMat.opacity = THREE.MathUtils.clamp((kmh - 100) / 200, 0, 0.3) + (me.nitro ? 0.1 : 0);
    const len = 0.5 + mySpeed * 0.04;
    lineSeed.forEach((l, i) => {
      l.z += mySpeed * dt * 1.6;
      if (l.z > -4) Object.assign(l, respawnLine());
      linePos.set([l.x, l.y, l.z, l.x, l.y, l.z - len], i * 6);
    });
    lineGeo.attributes.position!.needsUpdate = true;

    const myLane = laneX(meIndex, list.length);
    const targetFov = 58 + 24 * fast + (me.nitro ? 8 : 0);
    fov += (targetFov - fov) * Math.min(1, dt * 3);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    const shake = (0.02 + (me.nitro ? 0.05 : 0)) * fast * fast;
    const narrow = THREE.MathUtils.clamp(1.4 - camera.aspect, 0, 0.8);
    camera.position.set(
      myLane * 0.55 * (1 - narrow) + (Math.random() - 0.5) * shake,
      2.5 + narrow * 1.6 + (Math.random() - 0.5) * shake,
      7.2 + narrow * 7 - fast * 0.8,
    );
    camera.lookAt(myLane * 0.35 * (1 - narrow), 0.9, -16);
    sky.position.copy(camera.position);

    composer.render(dt);
  }

  resize();
  return { render, resize };
}

export function createGarage(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight("#8f74e0", "#140b1e", 1.2));
  const key = new THREE.DirectionalLight("#ffffff", 1.6);
  key.position.set(4, 6, 5);
  const rimL = new THREE.PointLight("#2de2ff", 30, 12);
  rimL.position.set(-4, 1.5, -2);
  const rimR = new THREE.PointLight("#ff3df2", 30, 12);
  rimR.position.set(4, 1.5, -3);
  scene.add(key, rimL, rimR);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 64),
    new THREE.MeshBasicMaterial({ map: radialTexture("rgba(120,80,200,0.35)", "rgba(0,0,0,0)"), transparent: true, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.36, 96), new THREE.MeshBasicMaterial({ color: hdr("#ff3df2", 1.2), transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(floor, ring);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(6.4, 2.8, 7.4);
  camera.lookAt(0, 0.55, 0);

  let current: ReturnType<typeof makeCar> | null = null;
  let currentKey = "";
  let angle = -0.6;
  let spin = 0.35;
  let velocity = spin;
  let dragging = false;
  let lastX = 0;
  let frame = 0;
  let running = false;
  let visible = true;

  function setCar(color: string, body: string) {
    const nextKey = `${color}/${body}`;
    if (nextKey === currentKey) return;
    currentKey = nextKey;
    current?.car.removeFromParent();
    current = makeCar(color, body);
    current.beam.visible = false;
    (current.glow.material as THREE.MeshBasicMaterial).opacity = 0.9;
    scene.add(current.car);
    current.car.scale.setScalar(0.92);
    current.car.userData.pop = 1;
    if (running) loop();
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const back = camera.aspect < 1.2 ? 1.3 : 1;
    camera.position.set(6.4 * back, 2.8 * back, 7.4 * back);
    camera.lookAt(0, 0.55, 0);
    camera.updateProjectionMatrix();
    draw(0);
  }

  function draw(dt: number) {
    if (!dragging) {
      angle += velocity * dt;
      velocity += (spin - velocity) * Math.min(1, dt * 1.5);
    }
    if (current) {
      current.car.rotation.y = angle;
      const pop = current.car.userData.pop as number;
      if (pop > 0) {
        current.car.userData.pop = Math.max(0, pop - dt * 3);
        current.car.scale.setScalar(1 - 0.08 * (current.car.userData.pop as number) ** 2);
      }
    }
    renderer.render(scene, camera);
  }

  let last = 0;
  function loop() {
    cancelAnimationFrame(frame);
    last = performance.now();
    const step = (now: number) => {
      draw(Math.min(0.1, (now - last) / 1000));
      last = now;
      if (running && visible) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    angle += dx * 0.012;
    velocity = dx * 0.6;
  });
  const release = () => (dragging = false);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    if (visible && running) loop();
  }).observe(canvas);
  new ResizeObserver(resize).observe(canvas);

  return {
    setCar,
    start() {
      running = true;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) spin = velocity = 0;
      loop();
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
    },
  };
}
