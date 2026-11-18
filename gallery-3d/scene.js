import * as THREE from './vendor/three.module.js';
import { Reflector } from './vendor/Reflector.js';
import { floorShader } from './floor.js';

// A photographic exhibition. Every visible surface uses supplied photography.
const sourceItems = [...document.querySelectorAll('#galleryGrid .gallery-item')];
const photographs = sourceItems.map(item => ({
  file: item.querySelector('img').getAttribute('src').replace(/\.jpg$/, '.webp'),
  credit: item.dataset.credit,
  label: item.getAttribute('aria-label'),
}));
const gallery = document.querySelector('#gallery');
const sourceGrid = document.querySelector('#galleryGrid');

const host = document.querySelector('#scene-stage');
const phone = matchMedia('(max-width: 760px), (hover: none) and (max-width: 1024px)');

if (host && photographs.length) {
  // Keep the original grid available until a nearby WebGL scene has loaded.
  const preload = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    preload.disconnect();
    bootExhibition(host);
  }, { rootMargin: '900px 0px' });
  preload.observe(gallery);
}

async function bootExhibition(stage) {
  const previous = document.querySelector('#scene-prev');
  const next = document.querySelector('#scene-next');
  const counter = document.querySelector('#scene-counter');
  const caption = document.querySelector('#scene-caption');
  const motionButton = document.querySelector('#scene-motion');
  // Full motion even with iOS Reduce Motion (the artist's iPhone has it on).
  const reducedMotion = { matches: false, addEventListener() {} };
  const finePointer = window.matchMedia('(pointer: fine)');
  const openButton = document.querySelector('#scene-open');
  const controls = [previous, next, motionButton, openButton].filter(Boolean);
  const pointer = new THREE.Vector2();
  const pointerTarget = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const rayPosition = new THREE.Vector2();
  const panels = [];
  const architecture = new THREE.Group();
  const cameraRest = 10;
  let renderer;
  let camera;
  let scene;
  let active = 0;
  let width = 1;
  let height = 1;
  let frame = 0;
  let lastTime = 0;
  let transition = null;
  let ready = false;
  let intersecting = true;
  let motionEnabled = !reducedMotion.matches;
  let pointerDown = null;
  let floorY = -2;
  let layout = null;
  let floor;
  let roomLines;
  let wheelFrame = 0;
  let wheelDelta = 0;
  let lastWheel = 0;

  controls.forEach(control => { control.disabled = true; });
  stage.dataset.ready = 'false';
  stage.dataset.active = '0';

  function language() {
    const selected = document.documentElement.lang.split('-')[0];
    return ['fr', 'en', 'ko'].includes(selected) ? selected : 'fr';
  }

  function updateLabels() {
    const lang = language();
    const current = photographs[active];
    if (counter) counter.textContent = `${String(active + 1).padStart(2, '0')} / ${String(photographs.length).padStart(2, '0')}`;
    if (caption) caption.textContent = current.credit;
    stage.setAttribute('aria-label', current.label);
    openButton.setAttribute('aria-label', { fr: 'Agrandir la photographie', en: 'Enlarge photograph', ko: '사진 확대' }[lang]);
    if (ready) {
      previous.disabled = active === 0;
      next.disabled = active === photographs.length - 1;
    }
    if (previous) previous.setAttribute('aria-label', { fr: 'Photographie précédente', en: 'Previous photograph', ko: '이전 사진' }[lang]);
    if (next) next.setAttribute('aria-label', { fr: 'Photographie suivante', en: 'Next photograph', ko: '다음 사진' }[lang]);
    if (motionButton) {
      const labels = motionEnabled
        ? { fr: 'Désactiver le mouvement', en: 'Disable motion', ko: '움직임 끄기' }
        : { fr: 'Activer le mouvement', en: 'Enable motion', ko: '움직임 켜기' };
      motionButton.setAttribute('aria-label', labels[lang]);
      motionButton.setAttribute('aria-pressed', String(motionEnabled));
      motionButton.title = labels[lang];
      motionButton.dataset.sceneMotion = motionEnabled ? 'on' : 'off';
      motionButton.disabled = !ready || reducedMotion.matches;
    }
  }

  function syncGalleryMode() {
    const desktop = ready && !phone.matches;
    gallery.classList.toggle('gallery-3d-ready', desktop);
    sourceGrid.inert = desktop;
    if (desktop) sourceGrid.setAttribute('aria-hidden', 'true');
    else sourceGrid.removeAttribute('aria-hidden');
    stage.closest('.gallery-exhibition').inert = !desktop;
    if (!desktop) stopRender();
    else { resize(); requestRender(); }
  }
  phone.addEventListener('change', syncGalleryMode);

  function canAnimate() {
    return !phone.matches && motionEnabled && !reducedMotion.matches;
  }

  function requestRender() {
    if (phone.matches || !ready || !intersecting || document.hidden || frame) return;
    frame = requestAnimationFrame(render);
  }

  function stopRender() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }

  function panelState(panel) {
    return {
      x: panel.group.position.x, y: panel.group.position.y, z: panel.group.position.z,
      rotation: panel.group.rotation.y,
      width: panel.mesh.scale.x, height: panel.mesh.scale.y,
      opacity: panel.mesh.material.opacity,
    };
  }

  function destination(index) {
    const mobile = width < 700;
    const { viewHeight, viewWidth, mainWidth, mainHeight, centerY } = layout;
    let relative = (index - active + panels.length) % panels.length;
    if (relative > panels.length / 2) relative -= panels.length;

    if (relative === 0) {
      return { x: 0, y: centerY, z: 0, rotation: -0.018, width: mainWidth, height: mainHeight, opacity: 1 };
    }
    const sideHeight = Math.min(mainHeight * 1.10, viewHeight * 0.72);
    const isAdjacent = Math.abs(relative) === 1;
    const direction = Math.sign(relative);
    return {
      x: direction * viewWidth * (isAdjacent ? (mobile ? 0.69 : 0.59) : 1.05),
      y: floorY + sideHeight / 2 + 0.025,
      z: isAdjacent ? -2.6 : -7,
      rotation: direction * -0.70,
      width: sideHeight * panels[index].ratio,
      height: sideHeight,
      opacity: isAdjacent ? 0.50 : 0,
    };
  }

  function applyState(panel, state) {
    panel.group.position.set(state.x, state.y, state.z);
    panel.group.rotation.y = state.rotation;
    panel.mesh.scale.set(state.width, state.height, 1);
    panel.mesh.material.opacity = state.opacity;
    panel.group.visible = state.opacity > 0.002;
    panel.backing.scale.set(state.width + 0.032, state.height + 0.032, 0.085);
    panel.backing.material.opacity = state.opacity;
    panel.edge.scale.copy(panel.backing.scale);
    panel.edge.material.opacity = state.opacity * 0.30;
  }

  function composeRoom() {
    const mobile = width < 700;
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * cameraRest;
    const viewWidth = viewHeight * camera.aspect;
    // All photographs stand on the same horizontal surface, including side frames.
    const availableHeight = viewHeight * 0.54;
    const ratio = panels[active].ratio;
    const mainWidth = Math.min(viewWidth * (mobile ? 0.88 : 0.76), availableHeight * ratio);
    const mainHeight = mainWidth / ratio;
    floorY = -viewHeight * 0.12;
    const centerY = floorY + mainHeight / 2 + 0.025;
    layout = { viewHeight, viewWidth, mainWidth, mainHeight, centerY };
    floor.position.y = floorY;
    floor.scale.set(Math.max(18, viewWidth * 3), 48, 1);

    // The chamber is articulated only by its physical floor and wall junctions.
    const halfRoom = Math.max(viewWidth * 0.68, mainWidth * 0.60);
    const ceiling = viewHeight * 0.70;
    const seamVertices = [
      -halfRoom, floorY, 7, -halfRoom, floorY, -18,
      halfRoom, floorY, 7, halfRoom, floorY, -18,
      -halfRoom, floorY, -18, halfRoom, floorY, -18,
      -halfRoom, floorY, -18, -halfRoom, ceiling, -18,
      halfRoom, floorY, -18, halfRoom, ceiling, -18,
      -halfRoom, ceiling, -18, -halfRoom, ceiling, 4,
      halfRoom, ceiling, -18, halfRoom, ceiling, 4,
    ];
    roomLines.geometry.dispose();
    roomLines.geometry = new THREE.BufferGeometry();
    roomLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(seamVertices, 3));
  }

  function updatePanels(instant = false) {
    composeRoom();
    const targets = panels.map((_, index) => destination(index));
    if (instant || !canAnimate()) {
      panels.forEach((panel, index) => applyState(panel, targets[index]));
      transition = null;
    } else {
      transition = {
        start: performance.now(),
        from: panels.map(panelState),
        to: targets,
      };
    }
    requestRender();
  }

  function select(index) {
    if (!ready) return;
    const selected = Math.max(0, Math.min(panels.length - 1, index));
    if (selected === active) return;
    active = selected;
    stage.dataset.active = String(active);
    updateLabels();
    updatePanels();
  }

  function render(now) {
    frame = 0;
    if (phone.matches || !ready || !intersecting || document.hidden) return;
    const elapsed = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
    lastTime = now;
    const ease = 1 - Math.exp(-9 * elapsed);
    let moving = false;

    if (transition) {
      const progress = Math.min(1, (now - transition.start) / 300);
      const eased = 1 - (1 - progress) ** 3;
      panels.forEach((panel, index) => {
        const state = {};
        for (const key of Object.keys(transition.to[index])) {
          state[key] = THREE.MathUtils.lerp(transition.from[index][key], transition.to[index][key], eased);
        }
        applyState(panel, state);
      });
      if (progress === 1) transition = null;
      else moving = true;
    }

    if (canAnimate()) {
      pointer.lerp(pointerTarget, ease);
      moving ||= pointer.distanceToSquared(pointerTarget) > 0.000001;
      if (!moving) {
        pointer.copy(pointerTarget);
      }
    } else {
      pointer.set(0, 0);
    }

    camera.position.set(pointer.x * 0.18, pointer.y * 0.10, cameraRest);
    camera.lookAt(pointer.x * 0.10, pointer.y * 0.035, 0);
    const contacts = floor.material.uniforms.uContacts.value;
    panels.forEach((panel, index) => {
      contacts[index].set(panel.group.position.x, panel.group.position.z, panel.mesh.scale.x * 0.5, panel.group.visible ? panel.mesh.material.opacity : 0);
    });
    renderer.render(scene, camera);
    if (moving) requestRender();
    else lastTime = 0;
  }

  function resize() {
    if (phone.matches) return;
    const bounds = stage.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 700 ? 1.25 : 1.5));
    renderer.setSize(width, height, false);
    const reflectionWidth = Math.min(1280, Math.round(width));
    const reflectionHeight = Math.min(900, Math.round(height));
    floor.getRenderTarget().setSize(reflectionWidth, reflectionHeight);
    floor.material.uniforms.uTexel.value.set(1 / reflectionWidth, 1 / reflectionHeight);
    updatePanels(true);
  }

  function navigate(index) {
    // Gallery input never changes page scroll position or calls the site's Lenis.
    select(Math.max(0, Math.min(photographs.length - 1, index)));
  }

  function openPhotograph() {
    openButton.focus({ preventScroll: true });
    sourceItems[active].click();
    // The original thumbnail is hidden; retain the existing viewer without its grid morph.
    document.querySelector('#lbFrame').getAnimations().forEach(animation => animation.cancel());
  }

  function fail(error) {
    ready = false;
    gallery.classList.remove('gallery-3d-ready');
    sourceGrid.removeAttribute('aria-hidden');
    sourceGrid.inert = false;
    stopRender();
    stage.dataset.ready = 'false';
    stage.dataset.error = error instanceof Error ? error.message : String(error);
    controls.forEach(control => { control.disabled = true; });
    console.warn('Photographic scene unavailable; using the original photographic grid.', error);
  }

  updateLabels();

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;';
    stage.append(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 14, 34);
    camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
    camera.position.z = cameraRest;
    scene.add(architecture);
    scene.add(new THREE.AmbientLight(0xffffff, 0.70));
    const edgeLight = new THREE.DirectionalLight(0xffffff, 2.0);
    edgeLight.position.set(-4, 8, 7);
    scene.add(edgeLight);
    const oppositeLight = new THREE.DirectionalLight(0xffffff, 0.80);
    oppositeLight.position.set(6, 3, 1);
    scene.add(oppositeLight);
    floor = new Reflector(new THREE.PlaneGeometry(1, 1), {
      textureWidth: 1024, textureHeight: 768, clipBias: 0.003,
      multisample: 0, shader: floorShader(photographs.length),
    });
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -6;
    architecture.add(floor);
    roomLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x858585, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    architecture.add(roomLines);
    const textureLoader = new THREE.TextureLoader();
    const textures = await Promise.all(photographs.map(async photo => {
      try {
        return await textureLoader.loadAsync(new URL(photo.file, document.baseURI).href);
      } catch (_) {
        // The original JPEG is an equivalent local fallback if a WebP request fails.
        try { return await textureLoader.loadAsync(new URL(photo.file.replace(/\.webp$/, '.jpg'), document.baseURI).href); }
        catch (_) { throw new Error(`Unable to load gallery photograph: ${photo.file}`); }
      }
    }));
    const geometry = new THREE.PlaneGeometry(1, 1);
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const edgeGeometry = new THREE.EdgesGeometry(boxGeometry);

    textures.forEach((texture, index) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      renderer.initTexture(texture); // Upload every photograph now, avoiding a first-selection GPU stall.
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        depthWrite: true,
        toneMapped: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.z = 0.051;
      mesh.userData.index = index;
      const backing = new THREE.Mesh(boxGeometry, new THREE.MeshStandardMaterial({
        color: 0x181818, roughness: 0.43, metalness: 0.45, transparent: true,
      }));
      const edge = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({
        color: 0x8c8c8c, transparent: true, opacity: 0.3,
      }));
      const group = new THREE.Group();
      group.add(backing, edge, mesh);
      scene.add(group);

      panels.push({ mesh, group, backing, edge, ratio: texture.image.naturalWidth / texture.image.naturalHeight });
    });

    ready = true;
    syncGalleryMode();
    resize();
    camera.position.z = cameraRest;
    renderer.render(scene, camera);
    stage.dataset.ready = 'true';
    delete stage.dataset.error;
    controls.forEach(control => { control.disabled = false; });
    updateLabels();

    previous?.addEventListener('click', () => navigate(active - 1));
    next?.addEventListener('click', () => navigate(active + 1));
    openButton.addEventListener('click', openPhotograph);
    stage.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Enter') openPhotograph();
      else navigate(event.key === 'Home' ? 0 : event.key === 'End' ? photographs.length - 1 : active + (event.key === 'ArrowLeft' ? -1 : 1));
    });
    motionButton?.addEventListener('click', () => {
      motionEnabled = !motionEnabled;
      updateLabels();
      if (!canAnimate()) {
        updatePanels(true);
      }
      requestRender();
    });

    stage.addEventListener('wheel', event => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.2 || event.shiftKey;
      if (!horizontal || event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
      const now = performance.now();
      if (now - lastWheel > 160 || Math.sign(delta) !== Math.sign(wheelDelta)) wheelDelta = 0;
      lastWheel = now;
      wheelDelta += delta * multiplier;
      if (wheelFrame) return;
      wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0;
        if (Math.abs(wheelDelta) >= 60) {
          navigate(active + Math.sign(wheelDelta));
          wheelDelta = 0;
        }
      });
    }, { passive: false });

    stage.addEventListener('pointermove', event => {
      if (!canAnimate() || !finePointer.matches || event.pointerType === 'touch') return;
      const bounds = stage.getBoundingClientRect();
      pointerTarget.set(
        Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1)),
        Math.max(-1, Math.min(1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1)),
      );
      requestRender();
    });
    stage.addEventListener('pointerleave', () => {
      pointerTarget.set(0, 0);
      requestRender();
    });
    renderer.domElement.addEventListener('pointerdown', event => {
      pointerDown = { x: event.clientX, y: event.clientY, t: performance.now() };
      if (event.pointerType === 'mouse') renderer.domElement.setPointerCapture(event.pointerId);
    });
    renderer.domElement.addEventListener('pointerup', event => {
      if (!pointerDown) return;
      const dx = event.clientX - pointerDown.x;
      const dy = event.clientY - pointerDown.y;
      const distance = Math.hypot(dx, dy);
      const speed = Math.abs(dx) / Math.max(1, performance.now() - pointerDown.t); // px per ms
      pointerDown = null;
      // A long drag or a quick flick both turn the page.
      if ((Math.abs(dx) > 48 || (speed > 0.35 && Math.abs(dx) > 16)) && Math.abs(dx) > Math.abs(dy) * 1.25) {
        navigate(active + (dx < 0 ? 1 : -1));
        return;
      }
      if (distance > 8) return;
      const bounds = stage.getBoundingClientRect();
      rayPosition.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(rayPosition, camera);
      const candidates = panels.filter(panel => panel.mesh.visible && panel.mesh.material.opacity > 0.1).map(panel => panel.mesh);
      const hit = raycaster.intersectObjects(candidates, false)[0];
      if (hit) {
        if (hit.object.userData.index === active) openPhotograph();
        else navigate(hit.object.userData.index);
      }
    });
    renderer.domElement.addEventListener('pointercancel', () => { pointerDown = null; });

    new ResizeObserver(resize).observe(stage);
    new MutationObserver(updateLabels).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    new IntersectionObserver(entries => {
      intersecting = entries[0].isIntersecting;
      if (intersecting) requestRender();
      else stopRender();
    }, { threshold: 0 }).observe(stage);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopRender();
      else requestRender();
    });
    reducedMotion.addEventListener('change', () => {
      motionEnabled = !reducedMotion.matches;
        updateLabels();
      updatePanels(true);
    });
    window.addEventListener('pagehide', stopRender);
    window.addEventListener('pageshow', requestRender);
    renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      fail('webgl-context-lost');
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      ready = true;
      stage.dataset.ready = 'true';
      syncGalleryMode();
      delete stage.dataset.error;
      controls.forEach(control => { control.disabled = false; });
      updateLabels();
      resize();
      requestRender();
    });
  } catch (error) {
    renderer?.dispose();
    fail(error);
  }
}
