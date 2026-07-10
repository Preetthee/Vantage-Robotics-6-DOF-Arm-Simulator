import { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useArmState } from '../context/ArmStateContext';
import { solveIK as ikSolve, type JointInfo } from '../ik/iksolver';

export interface Scene3DHandle {
  /** Update a joint angle by name */
  setJointAngle: (name: string, angle: number) => void;
  /** Get the Three.js scene for external manipulation */
  getScene: () => THREE.Scene;
  /** Get all joint objects currently in the scene */
  getJoints: () => Map<string, THREE.Object3D>;
  /** Get the end-effector world position */
  getEEPosition: () => THREE.Vector3;
  /** Get the end-effector world orientation */
  getEEOrientation: () => THREE.Quaternion;
  /** Run inverse kinematics to reach a target position with optional orientation */
  solveIK: (targetPos: THREE.Vector3, targetOrientation?: THREE.Quaternion) => import('../ik/iksolver').IKSolution;
  /** Show/hide the target position marker in the scene */
  updateTargetMarker: (position: THREE.Vector3 | null) => void;
  /** Highlight a test-panel key by ID (0 = none/clear). The key will glow with a pulsing emissive. */
  highlightKey: (keyId: number | null) => void;
  /** Flash a test-panel key green (success) or red (failure) for brief visual confirmation. */
  flashKey: (keyId: number, success: boolean) => void;
  /** Clear all key highlights and reset emissive intensities to their original values. */
  clearHighlights: () => void;
}

interface Scene3DProps {
  urdfPath?: string;
  urdfContent?: string;
  urdfFileName?: string;
  /** Called when the user clicks on the ground plane in 3D space */
  onGroundClick?: (position: THREE.Vector3) => void;
}

const Scene3D = forwardRef<Scene3DHandle, Scene3DProps>(({ urdfPath, urdfContent, urdfFileName, onGroundClick }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const robotRef = useRef<THREE.Group | null>(null);
  const jointsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const animFrameRef = useRef<number>(0);
  const anglesRef = useRef<Map<string, number>>(new Map());
  const targetMarkerRef = useRef<THREE.Mesh | null>(null);
  const targetLineRef = useRef<THREE.Line | null>(null);
  const ikHoverRef = useRef(false);
  const mouseRef = useRef(new THREE.Vector2());
  const raycasterRef = useRef(new THREE.Raycaster());
  const onGroundClickRef = useRef<((pos: THREE.Vector3) => void) | undefined>(undefined);
  onGroundClickRef.current = onGroundClick;

  /** Map of keyId → { mesh, material } for visual feedback highlighting */
  const keyMeshRefs = useRef<Map<number, { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }>>(new Map());
  /** The key currently glowing/active during autonomous playback */
  const activeKeyIdRef = useRef<number | null>(null);
  /** Yellow highlight ring around the active key */
  const activeKeyRingRef = useRef<THREE.Mesh | null>(null);
  /** Accumulated time for pulse animation */
  const pulseTimeRef = useRef<number>(0);

  /** Original emissive intensities stored per key for reset */
  const originalEmissiveIntensityRef = useRef<Map<number, number>>(new Map());

  const { initializeJoints, state, setIKTarget, updateJointAngle } = useArmState();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Set up the Three.js scene */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e1a);
    sceneRef.current = scene;

    // Camera
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    camera.position.set(4, 3, 5);
    camera.lookAt(0, 0.5, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2;
    controls.maxDistance = 15;
    controls.target.set(0, 0.5, 0);
    controls.update();
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0x334466, 0.5);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffeedd, 1.8);
    mainLight.position.set(5, 8, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.6);
    fillLight.position.set(-3, 4, -2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x88ccff, 0.4);
    rimLight.position.set(-1, 0.5, -5);
    scene.add(rimLight);

    // Ground grid helper (industrial floor look)
    const gridHelper = new THREE.GridHelper(10, 20, 0x2a3a5a, 0x1a2a4a);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    // Ground plane for shadows
    const groundGeo = new THREE.PlaneGeometry(10, 10);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.4, color: 0x000000 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    // Animation loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);

      // Pulse the active key's emissive intensity and ring
      if (activeKeyIdRef.current !== null) {
        const entry = keyMeshRefs.current.get(activeKeyIdRef.current);
        if (entry) {
          const t = pulseTimeRef.current;
          // Smooth sine pulse: 0.3 → 1.0 → 0.3
          const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 5));
          entry.mat.emissiveIntensity = pulse;
        }
        // Pulse the yellow ring
        const ring = activeKeyRingRef.current;
        if (ring) {
          const t = pulseTimeRef.current;
          const opacity = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 4 + 1));
          (ring.material as THREE.MeshBasicMaterial).opacity = opacity;
          const scale = 1 + 0.05 * Math.sin(t * 3);
          ring.scale.set(scale, scale, scale);
        }
      }
      pulseTimeRef.current += 0.016; // ~60fps

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // ── Click-to-set IK target on ground plane ──────────
    const pointerDownPos = { x: 0, y: 0 };
    const handlePointerDown = (e: PointerEvent) => {
      pointerDownPos.x = e.clientX;
      pointerDownPos.y = e.clientY;
    };
    const handlePointerUp = (e: PointerEvent) => {
      // Ignore if it was a drag (OrbitControls movement)
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;
      if (!onGroundClickRef.current) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, camera);
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const point = new THREE.Vector3();
      if (raycasterRef.current.ray.intersectPlane(groundPlane, point)) {
        onGroundClickRef.current(point.clone());
      }
    };
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  /** Load key config JSON and render test panel markers */
  useEffect(() => {
    let cancelled = false;

    fetch('/key.config.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((config: { frame: string; units: string; approach_axis: string; keys: Record<string, { x: number; y: number; z: number }> }) => {
        if (cancelled) return;
        const scene = sceneRef.current;
        if (!scene) return;

        // Create a group for the test panel
        const panelGroup = new THREE.Group();
        panelGroup.name = 'test-panel';
        // URDF uses Z-up, Three.js uses Y-up — same rotation as the robot
        panelGroup.rotation.x = -Math.PI / 2;

        // Determine bounds of the keys to build a panel base
        const keyEntries = Object.entries(config.keys);
        if (keyEntries.length === 0) return;

        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        keyEntries.forEach(([, pos]) => {
          if (pos.x < minX) minX = pos.x;
          if (pos.x > maxX) maxX = pos.x;
          if (pos.z < minZ) minZ = pos.z;
          if (pos.z > maxZ) maxZ = pos.z;
        });
        const midX = (minX + maxX) / 2;
        const midZ = (minZ + maxZ) / 2;
        const panelWidth = (maxX - minX) + 0.04;
        const panelDepth = (maxZ - minZ) + 0.04;

        // Panel base — a thin dark rectangle beneath the keys
        const baseGeo = new THREE.BoxGeometry(panelWidth, 0.003, panelDepth);
        const baseMat = new THREE.MeshStandardMaterial({
          color: 0x1a1a2e,
          metalness: 0.6,
          roughness: 0.4,
        });
        const baseMesh = new THREE.Mesh(baseGeo, baseMat);
        // Place base at the average y of keys (slightly below)
        const baseY = keyEntries[0][1].y - 0.003;
        baseMesh.position.set(midX, baseY, midZ);
        baseMesh.receiveShadow = true;
        panelGroup.add(baseMesh);

        // Render each key as a colored marker cube
        keyEntries.forEach(([id, pos]) => {
          const keyNum = parseInt(id, 10);
          const { x, y, z } = pos;
          const size = 0.034;
          // The panel is vertical after the URDF Z-up → Y-up conversion. A
          // shallow source-Y depth becomes a front-facing world-Z button, so
          // the pressable face is on the side/front rather than on top.
          // A taller local-Z dimension becomes world-Y after the frame
          // conversion, making each key visibly stand upright.
          const geo = new THREE.BoxGeometry(size, 0.012, 0.065);
          const mat = new THREE.MeshStandardMaterial({
            color: keyNum === 1 ? 0x4488ff : 0x3388cc,
            metalness: 0.2,
            roughness: 0.3,
            transparent: true,
            opacity: 0.85,
            emissive: keyNum === 1 ? 0x4488ff : 0x2266aa,
            emissiveIntensity: keyNum === 1 ? 1.2 : 0.6,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(x, y, z);
          mesh.castShadow = true;
          mesh.userData = { keyId: keyNum, label: id };
          keyMeshRefs.current.set(keyNum, { mesh, mat });
          originalEmissiveIntensityRef.current.set(keyNum, mat.emissiveIntensity);
          panelGroup.add(mesh);

          // Small label sprite
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = 'rgba(0,0,0,0)';
          ctx.fillRect(0, 0, 64, 64);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 40px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(id, 32, 32);

          const texture = new THREE.CanvasTexture(canvas);
          texture.needsUpdate = true;
          const spriteMat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            sizeAttenuation: true,
          });
          const sprite = new THREE.Sprite(spriteMat);
          sprite.position.set(x, y + 0.015, z);
          sprite.scale.set(0.05, 0.05, 1);
          panelGroup.add(sprite);
        });

        scene.add(panelGroup);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('Could not load key.config.json — test panel not rendered:', err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Load URDF model from path or raw content */
  useEffect(() => {
    if (!urdfPath && !urdfContent) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    // Dynamic import to avoid blocking initial render
    import('urdf-loader').then(mod => {
      if (cancelled) return;

      const scene = sceneRef.current;
      if (!scene) return;

      // Remove previous robot if any
      if (robotRef.current) {
        scene.remove(robotRef.current);
        robotRef.current = null;
        jointsRef.current.clear();
      }

      // Handle both ESM default export and CJS module interop
      const URDFLoader = mod.default || mod;
      if (typeof URDFLoader !== 'function') {
        throw new Error('URDFLoader constructor not found in module exports');
      }

      const loader = new URDFLoader();

      // Whether we're loading from content or a path, wrap in the same Promise pattern
      const loadPromise: Promise<THREE.Group & { joints?: Record<string, THREE.Object3D> }> =
        urdfContent
          ? Promise.resolve().then(() => {
              // urdf-loader.parse(content) returns the robot synchronously
              const robot = (loader as any).parse(urdfContent, { filename: urdfFileName || 'uploaded.urdf' });
              if (!robot) throw new Error('URDF parse returned empty — check the file format');
              return robot as THREE.Group & { joints?: Record<string, THREE.Object3D> };
            })
          : loader.loadAsync(urdfPath!);

      loadPromise.then((robot: THREE.Group & { joints?: Record<string, THREE.Object3D> }) => {
        if (cancelled) return;
        robotRef.current = robot;
        robot.position.set(0, 0, 0);
        // URDF uses Z-up, Three.js uses Y-up — rotate the entire robot
        robot.rotation.x = -Math.PI / 2;
        robot.traverse(child => {
          child.castShadow = true;
          child.receiveShadow = true;
        });
        scene.add(robot);

        // Extract joints from the loaded robot model
        const jointMap = new Map<string, THREE.Object3D>();
        if (robot.joints) {
          // robot.joints may be a Map (v0.13+) or a plain object (older versions)
          const entries = robot.joints instanceof Map
            ? Array.from(robot.joints.entries())
            : Object.entries(robot.joints);
          for (const [name, jointObj] of entries) {
            jointMap.set(name, jointObj);
          }
        }
        jointsRef.current = jointMap;

        // Populate the arm state context with joint data from the loaded model
        // Only include actuatable joints (revolute, continuous, prismatic) — skip fixed joints
        const jointData = jointMap.size > 0
          ? Array.from(jointMap.entries())
              .filter(([_, jointObj]) => {
                const jt = (jointObj as any).jointType;
                return jt === 'revolute' || jt === 'continuous' || jt === 'prismatic';
              })
              .map(([name, jointObj]) => {
                const limit = (jointObj as any).limit || { lower: -Math.PI, upper: Math.PI };
                const currentAngle = typeof (jointObj as any).angle === 'number' ? (jointObj as any).angle : 0;
                return {
                  name,
                  angle: currentAngle,
                  minAngle: limit.lower ?? -Math.PI,
                  maxAngle: limit.upper ?? Math.PI,
                  velocity: 0,
                  target: currentAngle,
                };
              })
          : [];
        initializeJoints(jointData);

        setLoading(false);
      }).catch((err: Error) => {
        if (cancelled) return;
        console.error('URDF load error:', err);
        setLoadError(`Failed to load: ${err.message}`);
        setLoading(false);
      });
    }).catch((err: Error) => {
      if (cancelled) return;
      console.error('Failed to load urdf-loader module:', err);
      setLoadError(`Module error: ${err.message}`);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [urdfPath, urdfContent, urdfFileName]);

  /** Set a joint angle by name and track it in the angles ref */
  const setJointAngle = useCallback((name: string, angle: number) => {
    const joint = jointsRef.current.get(name);
    if (!joint) return;

    const jointAny = joint as any;
    const axis = jointAny.axis;

    // Direct quaternion rotation — more reliable than calling setAngle(), which
    // can silently fail on certain joints or throw due to the getter-only .angle.
    if (axis && typeof axis.x === 'number' && typeof axis.y === 'number' && typeof axis.z === 'number') {
      if (axis.lengthSq() > 0) {
        // Reset to identity, then rotate by axis*angle
        joint.quaternion.setFromAxisAngle(axis, angle);
      }
    }
    // Track the angle for IK solver reading
    anglesRef.current.set(name, angle);
    // If no axis info, silently skip (e.g. fixed / non-revolute joints)
  }, []);

  /** Find the end-effector link in the robot scene graph */
  const getEndEffector = useCallback((): THREE.Object3D | null => {
    const robot = robotRef.current;
    if (!robot) return null;
    let ee: THREE.Object3D | null = null;
    robot.traverse(child => {
      if (child.name === 'stylus_tip' || child.name === 'stylus') {
        ee = child;
      }
    });
    if (ee) {
      const p = new THREE.Vector3();
      ee.getWorldPosition(p);
      console.log('[EE] found:', ee.name, 'pos:', p.toArray().map(v => v.toFixed(4)));
    } else {
      console.warn('[EE] No stylus_tip or stylus found in scene');
    }
    return ee;
  }, []);

  /** Get the end-effector world position */
  const getEEPosition = useCallback((): THREE.Vector3 => {
    const ee = getEndEffector();
    if (!ee) return new THREE.Vector3();
    const pos = new THREE.Vector3();
    ee.getWorldPosition(pos);
    return pos;
  }, [getEndEffector]);

  /** Get the end-effector world orientation (quaternion) */
  const getEEOrientation = useCallback((): THREE.Quaternion => {
    const ee = getEndEffector();
    if (!ee) return new THREE.Quaternion();
    const q = new THREE.Quaternion();
    ee.getWorldQuaternion(q);
    return q;
  }, [getEndEffector]);

  /** Apply angles directly to scene joints (used by IK solver during iteration) */
  const applyAnglesDirect = useCallback((jointNames: string[], angles: number[]) => {
    for (let i = 0; i < jointNames.length; i++) {
      const joint = jointsRef.current.get(jointNames[i]);
      if (!joint) continue;
      const axis = (joint as any).axis;
      if (axis && axis.lengthSq() > 0) {
        joint.quaternion.setFromAxisAngle(axis, angles[i]);
        anglesRef.current.set(jointNames[i], angles[i]);
      }
    }
  }, []);

  /** Read current angles from the angles ref */
  const readAngles = useCallback((jointNames: string[]): number[] => {
    return jointNames.map(name => anglesRef.current.get(name) || 0);
  }, []);

  /** Create or update the target marker in the scene */
  const updateTargetMarker = useCallback((position: THREE.Vector3 | null) => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove existing marker
    if (targetMarkerRef.current) {
      scene.remove(targetMarkerRef.current);
      targetMarkerRef.current = null;
    }
    if (targetLineRef.current) {
      scene.remove(targetLineRef.current);
      targetLineRef.current = null;
    }

    if (!position) return;

    // Target sphere
    const sphereGeo = new THREE.SphereGeometry(0.03, 16, 16);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xff4488,
      emissive: 0xff4488,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.9,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.copy(position);
    scene.add(sphere);
    targetMarkerRef.current = sphere;

    // Vertical dashed line from ground to target
    const linePoints = [
      new THREE.Vector3(position.x, 0, position.z),
      new THREE.Vector3(position.x, 0 + 0.02, position.z),
      position.clone(),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xff4488,
      dashSize: 0.01,
      gapSize: 0.008,
      transparent: true,
      opacity: 0.3,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    line.computeLineDistances();
    scene.add(line);
    targetLineRef.current = line;
  }, []);

  /** Run IK solver to reach a target world position with optional orientation */
  const solveIK = useCallback((targetPos: THREE.Vector3, targetOrientation?: THREE.Quaternion): import('../ik/iksolver').IKSolution => {
    const joints = jointsRef.current;
    // Keep the solver order identical to the controllable-joint order used by
    // MotionPipeline. Including fixed joints shifts the returned angles and
    // makes a target command rotate the wrong links.
    const jointNames = Array.from(joints.entries())
      .filter(([_, joint]) => {
        const type = (joint as any).jointType;
        return type === 'revolute' || type === 'continuous' || type === 'prismatic';
      })
      .map(([name]) => name);
    console.log('[IK-SCENE] jointNames:', jointNames);
    if (jointNames.length === 0) {
      return { angles: [], error: Infinity, iterations: 0, converged: false };
    }

    // Build JointInfo array with joint limits from URDF
    const jointInfo: JointInfo[] = jointNames.map((name, idx) => {
      const jointObj = joints.get(name)!;
      const axis = ((jointObj as any).axis as THREE.Vector3)?.clone() || new THREE.Vector3(0, 0, 1);
      const limit = (jointObj as any).limit || {};
      const jt = (jointObj as any).jointType;
      return {
        object: jointObj,
        axis,
        angle: anglesRef.current.get(name) || 0,
        stateIndex: idx,
        lower: limit.lower,
        upper: limit.upper,
      };
    });

    const eePos = getEEPosition();
    console.log('[IK-SCENE] EE pos:', eePos.toArray().map(v => v.toFixed(4)), 'target:', targetPos.toArray().map(v => v.toFixed(4)));

    const useOri = !!targetOrientation;
    return ikSolve(jointInfo, targetPos, {
      // Key presses require millimetre accuracy. Give the positional target
      // enough iterations and keep orientation as a secondary preference.
      maxIterations: 250,
      positionTolerance: 0.0005,
      stepSize: 0.3,
      useOrientation: useOri,
      orientationWeight: 0.05,
      targetOrientation: targetOrientation,
      getEEPosition,
      getEEOrientation,
      applyAngles: (angles: number[]) => applyAnglesDirect(jointNames, angles),
      readAngles: () => readAngles(jointNames),
    });
  }, [getEEPosition, getEEOrientation, applyAnglesDirect, readAngles]);

  /** Reset all test-panel key emissive intensities to their original values */
  const resetAllKeyEmissive = useCallback(() => {
    keyMeshRefs.current.forEach(({ mat }, keyId) => {
      const orig = originalEmissiveIntensityRef.current.get(keyId);
      if (orig !== undefined) {
        mat.emissiveIntensity = orig;
      }
    });
  }, []);

  /** Highlight a single key by ID (null/0 to clear). Sets it pulsing via the animation loop. */
  const highlightKey = useCallback((keyId: number | null) => {
    // Clear previous key pulse state
    if (activeKeyIdRef.current !== null) {
      resetAllKeyEmissive();
      // Remove previous ring
      if (activeKeyRingRef.current) {
        const scene = sceneRef.current;
        if (scene) scene.remove(activeKeyRingRef.current);
        activeKeyRingRef.current?.geometry?.dispose();
        (activeKeyRingRef.current.material as THREE.Material)?.dispose();
        activeKeyRingRef.current = null;
      }
    }
    activeKeyIdRef.current = keyId;
    pulseTimeRef.current = 0;
    if (keyId !== null) {
      const entry = keyMeshRefs.current.get(keyId);
      if (entry) {
        entry.mat.emissiveIntensity = 0.8; // immediate bright highlight

        // Create a yellow ring around the key
        const scene = sceneRef.current;
        if (scene) {
          const ringGeo = new THREE.RingGeometry(0.045, 0.06, 32);
          const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffcc00,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.6,
          });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.position.copy(entry.mesh.position);
          ring.position.y += 0.001;
          ring.rotation.x = -Math.PI / 2;
          scene.add(ring);
          activeKeyRingRef.current = ring;
        }
      }
    }
  }, [resetAllKeyEmissive]);

  /** Flash a key green (success) or red (failure) for 400ms, then restore original */
  const flashKey = useCallback((keyId: number, success: boolean) => {
    const entry = keyMeshRefs.current.get(keyId);
    if (!entry) return;

    const orig = originalEmissiveIntensityRef.current.get(keyId) ?? 0;
    entry.mat.emissive.setHex(success ? 0x22cc66 : 0xcc2244);
    entry.mat.emissiveIntensity = 1.2;
    entry.mat.needsUpdate = true;

    setTimeout(() => {
      // Restore original emissive color and intensity
      entry.mat.emissive.setHex(keyId === 1 ? 0x4488ff : 0x2266aa);
      entry.mat.emissiveIntensity = orig;
      entry.mat.needsUpdate = true;
    }, 400);
  }, []);

  /** Clear all key highlights */
  const clearHighlights = useCallback(() => {
    activeKeyIdRef.current = null;
    resetAllKeyEmissive();
    if (activeKeyRingRef.current) {
      const scene = sceneRef.current;
      if (scene) scene.remove(activeKeyRingRef.current);
      activeKeyRingRef.current?.geometry?.dispose();
      (activeKeyRingRef.current.material as THREE.Material)?.dispose();
      activeKeyRingRef.current = null;
    }
  }, [resetAllKeyEmissive]);

  useImperativeHandle(ref, () => ({
    setJointAngle,
    getScene: () => sceneRef.current!,
    getJoints: () => jointsRef.current,
    getEEPosition,
    getEEOrientation,
    solveIK,
    updateTargetMarker,
    highlightKey,
    flashKey,
    clearHighlights,
  }));

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Loading overlay */}
      {loading && (urdfPath || urdfContent) && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-foreground/70 font-heading">Loading robot model...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="flex flex-col items-center gap-3 max-w-sm text-center px-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-sm text-foreground/80">{loadError}</p>
            <p className="text-xs text-foreground/50">
              Try re-uploading a valid <code className="text-primary font-mono">.urdf</code> file
            </p>
          </div>
        </div>
      )}

      {/* Status overlay: show joint count when loaded */}
      {!loading && !loadError && (urdfPath || urdfContent) && (
        <div className="absolute top-3 right-3 flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface/80 backdrop-blur-sm border border-border/50 text-xs text-foreground/60">
          <span className="live-dot" />
          {jointsRef.current.size} joints
        </div>
      )}
    </div>
  );
});

Scene3D.displayName = 'Scene3D';
export default Scene3D;
