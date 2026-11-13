import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ThemeId } from "../utils/theme";

type VisualizerState = "idle" | "listening" | "processing" | "speaking";

interface VisualizerProps {
  state: VisualizerState;
  theme?: ThemeId;
  wakeWordActive?: boolean;
}

interface PaletteSpec {
  colorA: number;
  colorB: number;
  colorC: number;
  spinSpeed: number;
  displacement: number;
  waveSpeed: number;
  coronaStrength: number;
  eqIntensity: number;
  particleRadius: number;
  lightIntensity: number;
  textGlow: string;
}

function getTargetPalette(state: VisualizerState, theme: ThemeId): PaletteSpec {
  if (theme === "soft-sunset") {
    switch (state) {
      case "listening":
        return {
          colorA: 0xfbbf24, // Warm Gold
          colorB: 0xf97316, // Tangerine
          colorC: 0xf43f5e, // Coral Rose
          spinSpeed: 1.4,
          displacement: 0.055,
          waveSpeed: 3.2,
          coronaStrength: 0.92,
          eqIntensity: 0.8,
          particleRadius: 1.08,
          lightIntensity: 2.7,
          textGlow: "rgba(251, 191, 36, 0.95)",
        };
      case "processing":
        return {
          colorA: 0xf97316, // Deep Amber
          colorB: 0xe11d48, // Crimson Rose
          colorC: 0xfde047, // Sunbeam
          spinSpeed: 2.4,
          displacement: 0.045,
          waveSpeed: 4.8,
          coronaStrength: 0.98,
          eqIntensity: 0.95,
          particleRadius: 0.96,
          lightIntensity: 2.9,
          textGlow: "rgba(249, 115, 22, 0.95)",
        };
      case "speaking":
        return {
          colorA: 0xf43f5e, // Vibrant Rose
          colorB: 0xf59e0b, // Sunset Gold
          colorC: 0xff80b5, // Soft Blossom Pink
          spinSpeed: 1.95,
          displacement: 0.092,
          waveSpeed: 6.2,
          coronaStrength: 1.15,
          eqIntensity: 1.35,
          particleRadius: 1.2,
          lightIntensity: 3.4,
          textGlow: "rgba(244, 63, 94, 0.98)",
        };
      default:
        return {
          colorA: 0xf59e0b, // Golden Amber
          colorB: 0xfb7185, // Soft Rose
          colorC: 0xc084fc, // Twilight Lavender
          spinSpeed: 0.52,
          displacement: 0.028,
          waveSpeed: 1.6,
          coronaStrength: 0.72,
          eqIntensity: 0.36,
          particleRadius: 1.0,
          lightIntensity: 2.0,
          textGlow: "rgba(251, 191, 36, 0.85)",
        };
    }
  }

  switch (state) {
    case "listening":
      return {
        colorA: 0x22d3ee, // Electric Cyan
        colorB: 0x8b5cf6, // Neon Violet
        colorC: 0xf472b6, // Hot Pink
        spinSpeed: 1.4,
        displacement: 0.055,
        waveSpeed: 3.2,
        coronaStrength: 0.94,
        eqIntensity: 0.82,
        particleRadius: 1.08,
        lightIntensity: 2.7,
        textGlow: "rgba(139, 92, 246, 0.95)",
      };
    case "processing":
      return {
        colorA: 0x38bdf8, // Sky Pulse
        colorB: 0x6366f1, // Indigo
        colorC: 0x34d399, // Mint Aurora
        spinSpeed: 2.45,
        displacement: 0.045,
        waveSpeed: 4.8,
        coronaStrength: 0.98,
        eqIntensity: 0.95,
        particleRadius: 0.96,
        lightIntensity: 2.9,
        textGlow: "rgba(56, 189, 248, 0.95)",
      };
    case "speaking":
      return {
        colorA: 0xec4899, // Vivid Magenta
        colorB: 0x8b5cf6, // Electric Violet
        colorC: 0x22d3ee, // Cyan Spark
        spinSpeed: 1.95,
        displacement: 0.095,
        waveSpeed: 6.4,
        coronaStrength: 1.18,
        eqIntensity: 1.38,
        particleRadius: 1.2,
        lightIntensity: 3.4,
        textGlow: "rgba(236, 72, 153, 0.98)",
      };
    default:
      return {
        colorA: 0x06b6d4, // Aurora Cyan
        colorB: 0xa855f7, // Soft Violet
        colorC: 0xec4899, // Neon Rose
        spinSpeed: 0.52,
        displacement: 0.028,
        waveSpeed: 1.6,
        coronaStrength: 0.74,
        eqIntensity: 0.36,
        particleRadius: 1.0,
        lightIntensity: 2.0,
        textGlow: "rgba(34, 211, 238, 0.85)",
      };
  }
}

function detectSoftwareRenderer(): boolean {
  try {
    const probeCanvas = document.createElement("canvas");
    const gl2 = probeCanvas.getContext("webgl2");
    if (!gl2) return false;
    const dbg = gl2.getExtension("WEBGL_debug_renderer_info");
    const rendererName = dbg ? String(gl2.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererName);
  } catch {
    return false;
  }
}

// Pre-allocated scratch math objects (zero GC allocations in animation loop)
const _targetColorA = new THREE.Color();
const _targetColorB = new THREE.Color();
const _targetColorC = new THREE.Color();
const _curColorA = new THREE.Color();
const _curColorB = new THREE.Color();
const _curColorC = new THREE.Color();
const _mixColor = new THREE.Color();
const _dummy = new THREE.Object3D();
const _particlePos = new THREE.Vector3();

const PARTICLE_COUNT = 96;
const EQ_BAR_COUNT = 36;

export default function Visualizer({
  state,
  theme: activeTheme = "neon-violet",
  wakeWordActive = false,
}: VisualizerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({ state, activeTheme, wakeWordActive });
  propsRef.current = { state, activeTheme, wakeWordActive };

  const [webglFailed, setWebglFailed] = useState(false);

  const currentPalette = getTargetPalette(state, activeTheme);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareRenderer();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        stencil: false,
        powerPreference: "high-performance",
      });
    } catch (err) {
      console.warn("WebGL unavailable, falling back to lightweight core:", err);
      setWebglFailed(true);
      return;
    }

    const dprCap = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dprCap);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    canvas.className = "w-full h-full block pointer-events-none select-none";
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
    camera.position.set(0, 0, 5.4);

    // Lightweight studio reflections for metallic gyro rings
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.78;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const initPal = getTargetPalette(propsRef.current.state, propsRef.current.activeTheme);
    _curColorA.setHex(initPal.colorA);
    _curColorB.setHex(initPal.colorB);
    _curColorC.setHex(initPal.colorC);

    // Three-point lightweight lighting
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e1b4b, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(4, 5, 5);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(initPal.colorC, 1.25);
    rimLight.position.set(-4, -3, -3);
    scene.add(rimLight);

    const corePointLight = new THREE.PointLight(initPal.colorB, initPal.lightIntensity, 9, 2);
    corePointLight.position.set(0, 0, 0.4);
    scene.add(corePointLight);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // 1. Volumetric Aurora Corona Halo (GPU-cheap additive bloom & rotating energy rays)
    const coronaGeo = new THREE.PlaneGeometry(4.6, 4.6);
    const coronaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: _curColorA.clone() },
        uColorB: { value: _curColorB.clone() },
        uColorC: { value: _curColorC.clone() },
        uStrength: { value: initPal.coronaStrength },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uColorC;
        uniform float uStrength;
        varying vec2 vUv;

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float dist = length(p);
          float angle = atan(p.y, p.x);

          // Soft exponential radial bloom
          float coreGlow = exp(-dist * 2.75);
          float outerAura = exp(-dist * 1.45) * 0.42;

          // Flowing multi-color aurora rays
          float ray1 = 0.5 + 0.5 * sin(angle * 3.0 + uTime * 0.9 - dist * 2.2);
          float ray2 = 0.5 + 0.5 * cos(angle * 5.0 - uTime * 1.25 + dist * 1.8);

          vec3 col = mix(uColorA, uColorB, ray1);
          col = mix(col, uColorC, ray2 * 0.65);

          float alpha = (coreGlow * 0.68 + outerAura * (0.65 + 0.35 * ray1)) * uStrength;
          alpha *= smoothstep(1.0, 0.25, dist);

          gl_FragColor = vec4(col * 1.25, clamp(alpha, 0.0, 0.92));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const coronaMesh = new THREE.Mesh(coronaGeo, coronaMat);
    coronaMesh.position.z = -0.45;
    scene.add(coronaMesh);

    // 2. Iridescent Multi-Color Liquid Plasma Core (Custom Vertex + Fragment Shader)
    const coreGeo = new THREE.IcosahedronGeometry(0.58, 4);
    const coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDisplacement: { value: initPal.displacement },
        uWaveSpeed: { value: initPal.waveSpeed },
        uColorA: { value: _curColorA.clone() },
        uColorB: { value: _curColorB.clone() },
        uColorC: { value: _curColorC.clone() },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uDisplacement;
        uniform float uWaveSpeed;

        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec3 vLocalPos;
        varying float vWave;

        void main() {
          float t = uTime * uWaveSpeed;
          float wave = sin(position.x * 4.8 + t)
                     * cos(position.y * 4.4 - t * 0.85)
                     * sin(position.z * 4.6 + t * 0.65);
          float ripple = sin(length(position.xy) * 7.5 - t * 1.3) * 0.35;
          float disp = (wave + ripple) * uDisplacement;

          vec3 displaced = position + normal * disp;
          vWave = wave * 0.5 + 0.5;
          vLocalPos = normalize(position);

          vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
          vViewPos = -mvPosition.xyz;
          vNormal = normalize(normalMatrix * normal);

          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uColorC;

        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec3 vLocalPos;
        varying float vWave;

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPos);
          float ndotv = clamp(dot(normal, viewDir), 0.0, 1.0);
          float fresnel = pow(1.0 - ndotv, 2.4);

          // Flowing multi-hue holographic plasma blend
          float band1 = 0.5 + 0.5 * sin(vLocalPos.y * 3.4 + uTime * 1.3 + vWave * 2.5);
          float band2 = 0.5 + 0.5 * cos(vLocalPos.x * 3.2 - uTime * 1.0 + vLocalPos.z * 2.4);

          vec3 plasma = mix(uColorA, uColorB, band1);
          plasma = mix(plasma, uColorC, band2 * 0.72);

          // Inner luminous depth + bright iridescent rim
          vec3 deepCore = plasma * (0.45 + 0.55 * ndotv);
          vec3 rimGlow = mix(uColorC, vec3(1.0), 0.35) * fresnel * 1.75;
          float shimmer = pow(vWave, 2.0) * 0.28;

          vec3 finalColor = deepCore + rimGlow + plasma * shimmer;
          gl_FragColor = vec4(finalColor, 0.96);
        }
      `,
      transparent: true,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    rootGroup.add(coreMesh);

    // 3. Outer Fresnel Hologram Glass Shell
    const shellGeo = new THREE.SphereGeometry(0.76, 32, 32);
    const shellMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: _curColorA.clone() },
        uColorC: { value: _curColorC.clone() },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorC;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        varying vec2 vUv;

        void main() {
          vec3 n = normalize(vNormal);
          vec3 v = normalize(vViewPos);
          float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
          float scan = 0.7 + 0.3 * sin(vUv.y * 40.0 - uTime * 3.0);
          vec3 col = mix(uColorA, uColorC, 0.5 + 0.5 * sin(uTime + vUv.y * 4.0));
          gl_FragColor = vec4(col * 1.4, rim * 0.62 * scan);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const shellMesh = new THREE.Mesh(shellGeo, shellMat);
    rootGroup.add(shellMesh);

    // 4. Geodesic Energy Lattice
    const cageGeo = new THREE.IcosahedronGeometry(0.84, 1);
    const cageMat = new THREE.MeshStandardMaterial({
      color: initPal.colorC,
      emissive: initPal.colorA,
      emissiveIntensity: 0.65,
      metalness: 0.85,
      roughness: 0.18,
      wireframe: true,
      transparent: true,
      opacity: 0.38,
    });
    const cageMesh = new THREE.Mesh(cageGeo, cageMat);
    rootGroup.add(cageMesh);

    // 5. Flowing Rainbow TorusKnot Energy Ribbon (Multi-color UV Gradient Shader)
    const ribbonGeo = new THREE.TorusKnotGeometry(0.95, 0.015, 96, 8, 2, 3);
    const ribbonMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: _curColorA.clone() },
        uColorB: { value: _curColorB.clone() },
        uColorC: { value: _curColorC.clone() },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uColorC;
        varying vec2 vUv;

        void main() {
          float phase = fract(vUv.x * 2.0 - uTime * 0.32);
          vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.5, phase));
          col = mix(col, uColorC, smoothstep(0.5, 1.0, phase));
          float pulse = 0.75 + 0.45 * sin(vUv.x * 25.1327 - uTime * 3.5);
          gl_FragColor = vec4(col * (1.1 + pulse * 0.45), 0.82);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribbonMesh.rotation.set(0.35, 0.25, 0);
    rootGroup.add(ribbonMesh);

    // 6. Dual Metallic Orbital Gyro Rings
    const ring1Geo = new THREE.TorusGeometry(1.18, 0.02, 14, 90);
    const ring1Mat = new THREE.MeshStandardMaterial({
      color: initPal.colorB,
      emissive: initPal.colorB,
      emissiveIntensity: 0.55,
      metalness: 0.9,
      roughness: 0.16,
    });
    const ring1Mesh = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1Mesh.rotation.set(0.55, 0.2, 0);
    rootGroup.add(ring1Mesh);

    const ring2Geo = new THREE.TorusGeometry(1.52, 0.013, 12, 100);
    const ring2Mat = new THREE.MeshStandardMaterial({
      color: initPal.colorA,
      emissive: initPal.colorC,
      emissiveIntensity: 0.48,
      metalness: 0.86,
      roughness: 0.22,
      transparent: true,
      opacity: 0.88,
    });
    const ring2Mesh = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2Mesh.rotation.set(-0.68, 0.42, 0.2);
    rootGroup.add(ring2Mesh);

    // 7. 3D Circular Spectrum Equalizer Crown (InstancedMesh — single draw call, per-instance colors)
    const eqGeo = new THREE.CapsuleGeometry(0.016, 0.09, 4, 8);
    const eqMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const eqInstanced = new THREE.InstancedMesh(eqGeo, eqMat, EQ_BAR_COUNT);
    eqInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    eqInstanced.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(EQ_BAR_COUNT * 3),
      3
    );
    const eqGroup = new THREE.Group();
    eqGroup.rotation.set(0.32, 0, -0.1);
    eqGroup.add(eqInstanced);
    rootGroup.add(eqGroup);

    // 8. Multi-Color Sparkle Constellation Halo (InstancedMesh — single draw call, per-instance colors)
    const particleGeo = new THREE.OctahedronGeometry(0.025, 0);
    const particleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particleInstanced = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_COUNT);
    particleInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    particleInstanced.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(PARTICLE_COUNT * 3),
      3
    );

    const particleSeeds = new Float32Array(PARTICLE_COUNT * 4);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = goldenAngle * i;
      const baseR = 1.24 + (i % 6) * 0.14;
      particleSeeds[i * 4 + 0] = Math.cos(theta) * radiusAtY;
      particleSeeds[i * 4 + 1] = y;
      particleSeeds[i * 4 + 2] = Math.sin(theta) * radiusAtY;
      particleSeeds[i * 4 + 3] = baseR;
    }
    rootGroup.add(particleInstanced);

    // 9. Dual Staggered Wake-Word 3D Shockwave Rings
    const wakeGeo = new THREE.TorusGeometry(0.92, 0.02, 12, 72);
    const wakeMat1 = new THREE.MeshBasicMaterial({
      color: initPal.colorC,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const wakeMat2 = wakeMat1.clone();
    const wakeMesh1 = new THREE.Mesh(wakeGeo, wakeMat1);
    const wakeMesh2 = new THREE.Mesh(wakeGeo, wakeMat2);
    wakeMesh1.visible = false;
    wakeMesh2.visible = false;
    rootGroup.add(wakeMesh1);
    rootGroup.add(wakeMesh2);

    const updateSize = () => {
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      if (width <= 0 || height <= 0) return;

      camera.aspect = width / height;
      const narrowFactor = width < 520 ? 6.35 : width < 768 ? 5.65 : 5.05;
      camera.position.z = narrowFactor;
      const yLift = height < 740 ? 0.26 : 0.16;
      rootGroup.position.y = yLift;
      coronaMesh.position.y = yLift;
      camera.updateProjectionMatrix();

      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(width, height, false);
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    // Subtle pointer parallax (passive listener, never blocks UI)
    let pointerTargetX = 0;
    let pointerTargetY = 0;
    let pointerCurrentX = 0;
    let pointerCurrentY = 0;

    const handlePointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      const ny = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
      pointerTargetX = THREE.MathUtils.clamp(nx, -1, 1) * 0.24;
      pointerTargetY = THREE.MathUtils.clamp(ny, -1, 1) * 0.18;
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    let rafId = 0;
    let timeoutId = 0;
    let disposed = false;
    let lastTime = performance.now();
    let elapsed = 0;
    let wakePhase = 0;

    let currentSpin = initPal.spinSpeed;
    let currentDisp = initPal.displacement;
    let currentWaveSpeed = initPal.waveSpeed;
    let currentCorona = initPal.coronaStrength;
    let currentEq = initPal.eqIntensity;
    let currentParticleScale = initPal.particleRadius;
    let currentLightIntensity = initPal.lightIntensity;

    const afterDraw = (tickFn: () => void) => {
      if (!isSoftwareGl) {
        rafId = requestAnimationFrame(tickFn);
        return;
      }
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync?.(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        if (!sync || gl.clientWaitSync(sync, 0, 0) !== gl.TIMEOUT_EXPIRED) {
          if (sync) gl.deleteSync(sync);
          timeoutId = window.setTimeout(tickFn, 80);
        } else {
          timeoutId = window.setTimeout(poll, 16);
        }
      };
      poll();
    };

    const tick = () => {
      if (disposed) return;

      if (document.hidden) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(tick);
        return;
      }

      const now = performance.now();
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
      elapsed += dt;

      const { state: curState, activeTheme: curTheme, wakeWordActive: isWake } = propsRef.current;
      const target = getTargetPalette(curState, curTheme);

      const dampLambda = 4.6;
      currentSpin = THREE.MathUtils.damp(currentSpin, target.spinSpeed + (isWake ? 0.85 : 0), dampLambda, dt);
      currentDisp = THREE.MathUtils.damp(currentDisp, target.displacement + (isWake ? 0.025 : 0), dampLambda, dt);
      currentWaveSpeed = THREE.MathUtils.damp(currentWaveSpeed, target.waveSpeed, dampLambda, dt);
      currentCorona = THREE.MathUtils.damp(
        currentCorona,
        target.coronaStrength + (isWake ? 0.25 : 0),
        dampLambda,
        dt
      );
      currentEq = THREE.MathUtils.damp(currentEq, target.eqIntensity + (isWake ? 0.35 : 0), dampLambda, dt);
      currentParticleScale = THREE.MathUtils.damp(
        currentParticleScale,
        target.particleRadius + (isWake ? 0.14 : 0),
        dampLambda,
        dt
      );
      currentLightIntensity = THREE.MathUtils.damp(
        currentLightIntensity,
        target.lightIntensity + (isWake ? 0.8 : 0),
        dampLambda,
        dt
      );

      // Smoothly lerp the 3-hue palette
      _targetColorA.setHex(target.colorA);
      _targetColorB.setHex(target.colorB);
      _targetColorC.setHex(target.colorC);
      const colorAlpha = 1 - Math.exp(-4.5 * dt);

      _curColorA.lerp(_targetColorA, colorAlpha);
      _curColorB.lerp(_targetColorB, colorAlpha);
      _curColorC.lerp(_targetColorC, colorAlpha);

      // Sync ShaderMaterial uniforms
      coronaMat.uniforms.uTime.value = elapsed;
      coronaMat.uniforms.uColorA.value.copy(_curColorA);
      coronaMat.uniforms.uColorB.value.copy(_curColorB);
      coronaMat.uniforms.uColorC.value.copy(_curColorC);
      coronaMat.uniforms.uStrength.value = currentCorona;

      coreMat.uniforms.uTime.value = elapsed;
      coreMat.uniforms.uDisplacement.value = currentDisp;
      coreMat.uniforms.uWaveSpeed.value = currentWaveSpeed;
      coreMat.uniforms.uColorA.value.copy(_curColorA);
      coreMat.uniforms.uColorB.value.copy(_curColorB);
      coreMat.uniforms.uColorC.value.copy(_curColorC);

      shellMat.uniforms.uTime.value = elapsed;
      shellMat.uniforms.uColorA.value.copy(_curColorA);
      shellMat.uniforms.uColorC.value.copy(_curColorC);

      ribbonMat.uniforms.uTime.value = elapsed;
      ribbonMat.uniforms.uColorA.value.copy(_curColorA);
      ribbonMat.uniforms.uColorB.value.copy(_curColorB);
      ribbonMat.uniforms.uColorC.value.copy(_curColorC);

      // Sync metallic rings & lights
      cageMat.color.copy(_curColorC);
      cageMat.emissive.copy(_curColorA);
      ring1Mat.color.copy(_curColorB);
      ring1Mat.emissive.copy(_curColorB);
      ring2Mat.color.copy(_curColorA);
      ring2Mat.emissive.copy(_curColorC);
      corePointLight.color.copy(_curColorB);
      corePointLight.intensity = currentLightIntensity;
      rimLight.color.copy(_curColorC);

      // Smooth pointer parallax + organic floating rotation
      pointerCurrentX = THREE.MathUtils.damp(pointerCurrentX, pointerTargetX, 3.5, dt);
      pointerCurrentY = THREE.MathUtils.damp(pointerCurrentY, pointerTargetY, 3.5, dt);
      rootGroup.rotation.y = Math.sin(elapsed * 0.45) * 0.14 + pointerCurrentX;
      rootGroup.rotation.x = Math.cos(elapsed * 0.35) * 0.06 + pointerCurrentY;

      // Core breathing & multi-axis spin
      const voicePulse =
        curState === "speaking" ? (Math.sin(elapsed * 14.0) * 0.5 + 0.5) * 0.075 : 0;
      const coreScale = 1 + Math.sin(elapsed * 2.2) * 0.03 + voicePulse;
      coreMesh.scale.setScalar(coreScale);
      coreMesh.rotation.y += dt * currentSpin * 0.42;
      coreMesh.rotation.x += dt * currentSpin * 0.2;

      shellMesh.scale.setScalar(1 + voicePulse * 0.65);
      cageMesh.scale.setScalar(1 + voicePulse * 0.5);
      cageMesh.rotation.y -= dt * currentSpin * 0.38;
      cageMesh.rotation.z += dt * currentSpin * 0.26;

      ribbonMesh.rotation.z += dt * currentSpin * 0.55;
      ribbonMesh.rotation.y -= dt * currentSpin * 0.25;

      ring1Mesh.rotation.z += dt * currentSpin * 0.8;
      ring1Mesh.rotation.x += dt * currentSpin * 0.2;

      ring2Mesh.rotation.y -= dt * currentSpin * 0.62;
      ring2Mesh.rotation.z -= dt * currentSpin * 0.3;

      // Update 3D Circular Spectrum Equalizer Crown
      eqGroup.rotation.z -= dt * (0.28 + currentSpin * 0.35);
      const eqRadius = 1.36;
      for (let i = 0; i < EQ_BAR_COUNT; i++) {
        const angle = (i / EQ_BAR_COUNT) * Math.PI * 2;
        const waveA = Math.sin(angle * 4.0 + elapsed * (curState === "speaking" ? 11.5 : 3.2));
        const waveB = Math.cos(angle * 7.0 - elapsed * (curState === "speaking" ? 8.5 : 2.1));
        const amp = Math.max(0.18, (0.45 + 0.55 * ((waveA + waveB) * 0.5)) * currentEq);
        const barScaleY = 0.55 + amp * 1.45;
        const radialOffset = eqRadius + (barScaleY - 0.55) * 0.06;

        _dummy.position.set(Math.cos(angle) * radialOffset, Math.sin(angle) * radialOffset, 0);
        _dummy.rotation.set(0, 0, angle - Math.PI / 2);
        _dummy.scale.set(1, barScaleY, 1);
        _dummy.updateMatrix();
        eqInstanced.setMatrixAt(i, _dummy.matrix);

        // Multi-hue gradient around the crown
        const hueT = (i / EQ_BAR_COUNT + elapsed * 0.14) % 1;
        if (hueT < 0.333) {
          _mixColor.copy(_curColorA).lerp(_curColorB, hueT * 3);
        } else if (hueT < 0.666) {
          _mixColor.copy(_curColorB).lerp(_curColorC, (hueT - 0.333) * 3);
        } else {
          _mixColor.copy(_curColorC).lerp(_curColorA, (hueT - 0.666) * 3);
        }
        eqInstanced.setColorAt(i, _mixColor);
      }
      eqInstanced.instanceMatrix.needsUpdate = true;
      if (eqInstanced.instanceColor) eqInstanced.instanceColor.needsUpdate = true;

      // Update Multi-Color Constellation Halo
      const swirlAngle = elapsed * (0.25 + currentSpin * 0.22);
      const cosSwirl = Math.cos(swirlAngle);
      const sinSwirl = Math.sin(swirlAngle);

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const sx = particleSeeds[i * 4 + 0];
        const sy = particleSeeds[i * 4 + 1];
        const sz = particleSeeds[i * 4 + 2];
        const baseR = particleSeeds[i * 4 + 3];

        const radialWave = 1 + Math.sin(elapsed * 2.3 + i * 0.45) * 0.06;
        const r = baseR * currentParticleScale * radialWave;

        const rx = sx * cosSwirl - sz * sinSwirl;
        const rz = sx * sinSwirl + sz * cosSwirl;

        _particlePos.set(rx * r, sy * r, rz * r);
        _dummy.position.copy(_particlePos);
        _dummy.rotation.set(elapsed + i, elapsed * 0.8, 0);
        const dotScale = 0.72 + 0.52 * Math.sin(elapsed * 3.4 + i);
        _dummy.scale.setScalar(dotScale);
        _dummy.updateMatrix();
        particleInstanced.setMatrixAt(i, _dummy.matrix);

        const bucket = i % 3;
        if (bucket === 0) _mixColor.copy(_curColorA);
        else if (bucket === 1) _mixColor.copy(_curColorB);
        else _mixColor.copy(_curColorC);
        particleInstanced.setColorAt(i, _mixColor);
      }
      particleInstanced.instanceMatrix.needsUpdate = true;
      if (particleInstanced.instanceColor) particleInstanced.instanceColor.needsUpdate = true;

      // Update Dual Wake-Word Shockwave Halos
      if (isWake) {
        wakePhase = (wakePhase + dt * 0.9) % 1;
        const phase2 = (wakePhase + 0.5) % 1;

        wakeMesh1.visible = true;
        wakeMesh1.scale.setScalar(1.0 + wakePhase * 1.5);
        wakeMat1.color.copy(_curColorC);
        wakeMat1.opacity = (1 - wakePhase) * 0.88;

        wakeMesh2.visible = true;
        wakeMesh2.scale.setScalar(1.0 + phase2 * 1.5);
        wakeMat2.color.copy(_curColorA);
        wakeMat2.opacity = (1 - phase2) * 0.78;
      } else {
        if (wakeMesh1.visible) {
          wakeMat1.opacity = Math.max(0, wakeMat1.opacity - dt * 2.5);
          wakeMesh1.scale.addScalar(dt * 1.1);
          if (wakeMat1.opacity <= 0.01) wakeMesh1.visible = false;
        }
        if (wakeMesh2.visible) {
          wakeMat2.opacity = Math.max(0, wakeMat2.opacity - dt * 2.5);
          wakeMesh2.scale.addScalar(dt * 1.1);
          if (wakeMat2.opacity <= 0.01) wakeMesh2.visible = false;
        }
        if (!wakeMesh1.visible && !wakeMesh2.visible) wakePhase = 0;
      }

      renderer.render(scene, camera);
      afterDraw(tick);
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        lastTime = performance.now();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    rafId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pointermove", handlePointerMove);

      coronaGeo.dispose();
      coronaMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      shellGeo.dispose();
      shellMat.dispose();
      cageGeo.dispose();
      cageMat.dispose();
      ribbonGeo.dispose();
      ribbonMat.dispose();
      ring1Geo.dispose();
      ring1Mat.dispose();
      ring2Geo.dispose();
      ring2Mat.dispose();
      eqGeo.dispose();
      eqMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      wakeGeo.dispose();
      wakeMat1.dispose();
      wakeMat2.dispose();
      envTarget.dispose();

      renderer.dispose();
      if (canvas.parentNode === container) {
        container.removeChild(canvas);
      }
    };
  }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none select-none">
      {!webglFailed ? (
        <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      ) : (
        <div className="w-32 h-32 rounded-full border border-white/25 bg-white/5 flex items-center justify-center" />
      )}

      {/* Subtle Crisp Centerpiece Monogram */}
      <div className="relative z-10 flex flex-col items-center justify-center -translate-y-4 sm:-translate-y-2 pointer-events-none">
        <div
          className="font-bold tracking-[0.34em] text-lg md:text-2xl lg:text-3xl text-white/95 pl-[0.34em]"
          style={{
            textShadow: `0 0 16px ${currentPalette.textGlow}, 0 2px 12px rgba(0,0,0,0.9)`,
          }}
        >
          LUNA
        </div>
      </div>
    </div>
  );
}
