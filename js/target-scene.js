/* ============================================================
   LakshyaGram — the target
   A Three.js archery target on a straw boss. Messages are fired
   into it as arrows. Used by the landing hero and the app's
   empty state.
============================================================ */
import * as THREE from 'three';

const gsap = window.gsap;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const COLORS = {
  white: 0xF4F6FA,
  black: 0x0B1626,
  blue:  0x2F6FB5,
  red:   0xEF4B4B,
  gold:  0xFFC93C,
  straw: 0xD9B66C,
  shaft: 0xE9E1CF,
};

// Outer to inner, the five colour bands of a target face.
const RINGS = [
  { outer: 5.0, inner: 4.0, color: COLORS.white },
  { outer: 4.0, inner: 3.0, color: COLORS.black },
  { outer: 3.0, inner: 2.0, color: COLORS.blue },
  { outer: 2.0, inner: 1.0, color: COLORS.red },
  { outer: 1.0, inner: 0.0, color: COLORS.gold },
];
const FACE_Z = 0.85;
const MAX_ARROWS = 14;
const FOV = 35;
const CAMERA_Z = 16;

export function createTargetScene(canvas, { layout = 'hero', onHit } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAMERA_Z);

  scene.add(new THREE.HemisphereLight(0xCFE0F7, 0x0A1F38, 1.1));
  const key = new THREE.DirectionalLight(0xFFF1D6, 2.4);
  key.position.set(-6, 8, 10);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6FA8FF, 1.6);
  rim.position.set(8, -2, -6);
  scene.add(rim);

  // ---- target ------------------------------------------------
  const rig = new THREE.Group();      // layout position and scale
  const target = new THREE.Group();   // tilt, float and recoil
  rig.add(target);
  scene.add(rig);

  const boss = new THREE.Mesh(
    new THREE.CylinderGeometry(5.35, 5.35, 1.7, 96, 1),
    new THREE.MeshStandardMaterial({ color: COLORS.straw, roughness: .95, metalness: 0 })
  );
  boss.rotation.x = Math.PI / 2;
  target.add(boss);

  RINGS.forEach((ring, i) => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, ring.outer, 0, Math.PI * 2, false);
    if (ring.inner > 0) {
      const hole = new THREE.Path();
      hole.absarc(0, 0, ring.inner, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.08, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 2, curveSegments: 96,
    });
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: ring.color, roughness: .55, metalness: .05 }));
    mesh.position.z = FACE_Z + i * 0.045;
    target.add(mesh);
  });

  // ---- dust --------------------------------------------------
  const dustCount = layout === 'hero' ? 260 : 90;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3]     = (Math.random() - .5) * 34;
    dustPos[i * 3 + 1] = (Math.random() - .5) * 20;
    dustPos[i * 3 + 2] = (Math.random() - .5) * 12;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: .07, color: 0xBFD2EE, transparent: true, opacity: .55, depthWrite: false, map: dotTexture(),
  }));
  scene.add(dust);

  // ---- arrows (pooled, shared geometry) ----------------------
  const arrowParts = makeArrowParts();
  const arrows = [];
  const tmp = new THREE.Vector3();

  function makeArrow() {
    const g = new THREE.Group();
    // Built along +Z with the tip at the origin, so lookAt() aims it.
    const shaft = new THREE.Mesh(arrowParts.shaft, arrowParts.shaftMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -1.7;
    const tip = new THREE.Mesh(arrowParts.tip, arrowParts.tipMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = .05;
    g.add(shaft, tip);
    for (let k = 0; k < 3; k++) {
      const vane = new THREE.Mesh(arrowParts.vane, k === 0 ? arrowParts.goldMat : arrowParts.redMat);
      const holder = new THREE.Group();
      holder.rotation.z = (k / 3) * Math.PI * 2;
      vane.rotation.set(0, Math.PI / 2, 0);
      vane.position.set(0, .12, -3.05);
      holder.add(vane);
      g.add(holder);
    }
    const nock = new THREE.Mesh(arrowParts.nock, arrowParts.goldMat);
    nock.rotation.x = Math.PI / 2;
    nock.position.z = -3.45;
    g.add(nock);
    return g;
  }

  // Hits pull toward the centre: Lakshya is the aim.
  function pickHit(precise) {
    const r = precise ? Math.random() * 1.6 : Math.sqrt(Math.random()) * 4.4;
    const a = Math.random() * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, FACE_Z + .05);
  }

  function fire({ precise = false } = {}) {
    let arrow;
    if (arrows.length >= MAX_ARROWS) {
      arrow = arrows.shift();
      target.remove(arrow);
    } else {
      arrow = makeArrow();
    }
    arrows.push(arrow);

    const hitLocal = pickHit(precise);
    const end = hitLocal.clone().applyMatrix4(target.matrixWorld);
    const start = new THREE.Vector3(end.x - 22, end.y + 3.5 + Math.random() * 2, end.z + 9);
    const ctrl = new THREE.Vector3((start.x + end.x) / 2, Math.max(start.y, end.y) + 2.2, (start.z + end.z) / 2);
    arrow.scale.setScalar(rig.scale.x);
    scene.add(arrow);

    const land = () => {
      // Re-parent into the target so it moves with it.
      arrow.scale.setScalar(1);
      target.worldToLocal(arrow.position);
      const worldQuat = arrow.quaternion.clone();
      const targetQuat = new THREE.Quaternion();
      target.getWorldQuaternion(targetQuat);
      arrow.quaternion.copy(targetQuat.invert().multiply(worldQuat));
      scene.remove(arrow);
      target.add(arrow);
      impact(hitLocal);
      if (onHit) {
        tmp.copy(hitLocal).applyMatrix4(target.matrixWorld).project(camera);
        const rect = canvas.getBoundingClientRect();
        onHit({ x: rect.left + (tmp.x + 1) / 2 * rect.width, y: rect.top + (1 - tmp.y) / 2 * rect.height, ring: ringFor(hitLocal) });
      }
    };

    if (reduceMotion.matches || !gsap) {
      arrow.position.copy(end);
      tmp.copy(end).sub(ctrl).add(end);
      arrow.lookAt(tmp);
      land();
      render();
      return;
    }

    const state = { t: 0 };
    const pt = new THREE.Vector3();
    gsap.to(state, {
      t: 1, duration: .62, ease: 'power1.in',
      onUpdate() {
        bezier(start, ctrl, end, state.t, pt);
        arrow.position.copy(pt);
        bezier(start, ctrl, end, Math.min(state.t + .02, 1), tmp);
        if (state.t < .99) arrow.lookAt(tmp);
      },
      onComplete: land,
    });
  }

  function impact(hitLocal) {
    // The boss gives a little, and the face ripples from the hit.
    gsap.fromTo(target.position, { z: -.35 }, { z: 0, duration: 1.1, ease: 'elastic.out(1, .35)' });
    const wave = new THREE.Mesh(
      new THREE.RingGeometry(.15, .26, 48),
      new THREE.MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: .95, depthWrite: false })
    );
    wave.position.copy(hitLocal);
    wave.position.z = FACE_Z + .4;
    target.add(wave);
    gsap.to(wave.scale, { x: 9, y: 9, duration: .9, ease: 'power3.out' });
    gsap.to(wave.material, {
      opacity: 0, duration: .9, ease: 'power2.out',
      onComplete() { target.remove(wave); wave.geometry.dispose(); wave.material.dispose(); },
    });
    const last = arrows[arrows.length - 1];
    gsap.fromTo(last.rotation, { x: last.rotation.x + .06 }, { x: last.rotation.x, duration: .9, ease: 'elastic.out(1.2, .25)' });
  }

  function ringFor(p) {
    const r = Math.hypot(p.x, p.y);
    return Math.max(1, 10 - Math.floor(r / .5));
  }

  // ---- layout ------------------------------------------------
  let width = 1, height = 1;
  function resize() {
    const box = canvas.parentElement.getBoundingClientRect();
    width = Math.max(1, box.width);
    height = Math.max(1, box.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    const viewH = 2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const viewW = viewH * camera.aspect;
    const diameter = 10.7;
    if (layout === 'center') {
      const s = Math.min(viewW, viewH) * .72 / diameter;
      rig.scale.setScalar(s);
      rig.position.set(0, 0, 0);
    } else if (camera.aspect < .9) {
      // Phone: 130vw across, its top below the hero copy.
      const s = viewW * 1.3 / diameter;
      rig.scale.setScalar(s);
      const radius = diameter * s / 2;
      rig.position.set(0, viewH / 2 - (.7 * viewH + radius), 0);
    } else {
      // Desktop: 120vh across, centred near 78% / 55%.
      const s = viewH * 1.2 / diameter;
      rig.scale.setScalar(s);
      rig.position.set((.78 - .5) * viewW, -(.55 - .5) * viewH, 0);
    }
    render();
  }

  // ---- motion ------------------------------------------------
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let scroll = 0;
  const baseTilt = layout === 'hero' ? -.38 : -.25;
  function onPointer(e) {
    pointer.tx = (e.clientX / window.innerWidth - .5) * 2;
    pointer.ty = (e.clientY / window.innerHeight - .5) * 2;
  }
  window.addEventListener('pointermove', onPointer, { passive: true });

  const clock = new THREE.Clock();
  function tick() {
    const t = clock.getElapsedTime();
    pointer.x += (pointer.tx - pointer.x) * .05;
    pointer.y += (pointer.ty - pointer.y) * .05;
    const still = reduceMotion.matches;
    target.rotation.y = baseTilt + pointer.x * .12 - scroll * .9;
    target.rotation.x = -.08 + pointer.y * .08 + scroll * .25 + (still ? 0 : Math.sin(t * .6) * .03);
    target.position.y = still ? 0 : Math.sin(t * .8) * .12;
    rig.rotation.z = scroll * .25;
    if (!still) {
      dust.rotation.y = t * .015;
      dust.position.y = Math.sin(t * .2) * .3;
    }
    render();
  }
  function render() { renderer.render(scene, camera); }

  let running = false;
  function start() { if (!running) { running = true; renderer.setAnimationLoop(tick); } }
  function stop() { if (running) { running = false; renderer.setAnimationLoop(null); } }

  const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()), { threshold: 0 });
  io.observe(canvas);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  resize();
  target.updateMatrixWorld(true);

  return {
    fire,
    setScroll(p) { scroll = p; },
    intro() {
      if (reduceMotion.matches || !gsap) return;
      const tl = gsap.timeline();
      tl.from(rig.position, { x: rig.position.x + 8, duration: 1.4, ease: 'expo.out' }, 0)
        .from(target.rotation, { y: baseTilt - 1.4, duration: 1.6, ease: 'expo.out' }, 0)
        .from(rig.scale, { x: rig.scale.x * .7, y: rig.scale.y * .7, z: rig.scale.z * .7, duration: 1.4, ease: 'expo.out' }, 0);
      return tl;
    },
    dispose() {
      stop();
      io.disconnect(); ro.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach(m => { m.map?.dispose(); m.dispose(); });
      });
      renderer.dispose();
    },
  };
}

function bezier(a, b, c, t, out) {
  const u = 1 - t;
  out.set(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z
  );
  return out;
}

function makeArrowParts() {
  return {
    shaft: new THREE.CylinderGeometry(.045, .045, 3.4, 10),
    tip: new THREE.ConeGeometry(.1, .32, 12),
    vane: new THREE.PlaneGeometry(.62, .2),
    nock: new THREE.CylinderGeometry(.06, .06, .14, 10),
    shaftMat: new THREE.MeshStandardMaterial({ color: COLORS.shaft, roughness: .6 }),
    tipMat: new THREE.MeshStandardMaterial({ color: 0x9FB0C4, roughness: .3, metalness: .8 }),
    goldMat: new THREE.MeshStandardMaterial({ color: COLORS.gold, roughness: .5, side: THREE.DoubleSide }),
    redMat: new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: .5, side: THREE.DoubleSide }),
  };
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(16, 16, 14, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
