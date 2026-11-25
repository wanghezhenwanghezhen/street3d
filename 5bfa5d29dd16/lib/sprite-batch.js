import * as THREE from 'three';

const hiddenLayer = 31;
function displayed(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
function canonicalUrl(value) {
  try { return decodeURI(new URL(value, 'http://local.invalid').pathname); }
  catch { return value; }
}
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const aborted = () => new DOMException('Sprite request cancelled', 'AbortError');

// A cancelled download cannot keep decoded image pixels after the layer closes.
// HTMLImageElement preserves the previous texture flipY / color-space behavior.
async function loadSpriteTexture(url, { signal }) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Sprite image HTTP ${response.status}: ${url}`);
  const blob = await response.blob();
  if (signal.aborted) throw aborted();
  const objectUrl = URL.createObjectURL(blob), image = new Image(); image.decoding = 'async';
  try {
    await new Promise((resolve, reject) => {
      const clean = () => { image.onload = image.onerror = null; signal.removeEventListener('abort', cancel); };
      const cancel = () => { clean(); image.src = ''; reject(aborted()); };
      image.onload = () => { clean(); resolve(); };
      image.onerror = () => { clean(); reject(new Error(`Sprite decode failed: ${url}`)); };
      signal.addEventListener('abort', cancel, { once: true }); image.src = objectUrl;
      if (signal.aborted) cancel();
    });
    if (signal.aborted) { image.src = ''; throw aborted(); }
    return new THREE.Texture(image);
  } finally { URL.revokeObjectURL(objectUrl); }
}

/**
 * Call after logical visibility and environment.install. Optional pictures are
 * individual lossless crops; NPC pages contain NPC pixels only. Original meshes
 * retain identity, transforms, schedules and bindings, without issuing GPU draws.
 * profile can be a name or { mapping, loadTexture, retireTextures } for CPU tests.
 */
export async function createSpriteBatches({ scene, billboards, interactables, profile = 'desktop',
  camera = null, radius = Infinity, keepRadius = radius * 1.35, loadConcurrency = 2,
  distanceInterval = 250, retryDelay = 2000 }) {
  const options = typeof profile === 'string' ? { name: profile } : profile;
  const mapping = options.mapping ?? await fetch(`/assets/sprite-stream-r10/mapping-${options.name ?? 'desktop'}.json`).then(r => {
    if (!r.ok) throw new Error(`Sprite manifest HTTP ${r.status}`); return r.json();
  });
  radius = Math.max(0, radius); keepRadius = Math.max(radius, keepRadius);
  loadConcurrency = Math.max(1, Math.floor(loadConcurrency));
  const entries = new Map(Object.entries(mapping.entries).map(([url, entry]) => [canonicalUrl(url), entry]));
  const groups = new Map(), skipped = [], records = [];
  for (const original of billboards) {
    const entry = entries.get(canonicalUrl(original.userData.sourceImage));
    if (!entry) { skipped.push({ id: original.userData.instanceId, reason: 'missing-atlas-entry' }); continue; }
    if (original.material?.type !== 'MeshBasicMaterial' || !original.geometry?.attributes.position) {
      skipped.push({ id: original.userData.instanceId, reason: 'unsupported-material-or-geometry' }); continue;
    }
    original.geometry.computeBoundingBox();
    const box = original.geometry.boundingBox, extent = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    if (extent.z > 1e-6 || extent.x <= 0 || extent.y <= 0) {
      skipped.push({ id: original.userData.instanceId, reason: 'not-flat-XY-plane' }); continue;
    }
    const record = { original, entry, shape: new THREE.Matrix4().makeScale(extent.x, extent.y, 1).setPosition(center),
      layerMask: original.layers.mask, visible: false, allowed: false, inRange: false, distance: Infinity,
      localRadius: Math.max(extent.x, extent.y) * .5, hitUv: null };
    const group = groups.get(entry.atlasIndex) ?? []; group.push(record); groups.set(entry.atlasIndex, group); records.push(record);
  }
  const pages = [...groups].map(([index, pageRecords]) => {
    const atlas = mapping.atlases.find(a => a.index === index);
    if (!atlas) throw new Error(`Missing sprite atlas ${index}`);
    return { index, atlas, records: pageRecords, kind: pageRecords[0].entry.kind, mesh: null, texture: null,
      pixels: null, state: 'idle', wanted: false, distance: Infinity, task: null, controller: null,
      generation: 0, attempts: 0, nextRetry: 0, lastError: null };
  });
  const originals = new Set(records.map(r => r.original)), byId = new Map(), meshPages = new Map(), meshes = [];
  for (const page of pages) for (const record of page.records) {
    byId.set(record.original.userData.instanceId, { page, record });
    record.original.layers.set(hiddenLayer); record.original.userData.spriteAtlasOriginal = true;
  }
  const oldTextures = new Set(records.map(r => r.original.material.map).filter(Boolean)), externallyUsed = new Set();
  scene.traverse(object => {
    if (originals.has(object)) return;
    for (const material of [object.material].flat().filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture) externallyUsed.add(value);
      for (const uniform of Object.values(material.uniforms ?? {})) if (uniform.value?.isTexture) externallyUsed.add(uniform.value);
    }
  });
  let retiredTextures = 0;
  if (options.retireTextures !== false) for (const texture of oldTextures) {
    if (externallyUsed.has(texture)) continue;
    texture.dispose(); texture.userData.spriteAtlasGPURetired = true; retiredTextures++;
  }
  const loadTexture = options.loadTexture ?? loadSpriteTexture;
  const inverse = new THREE.Matrix4(), matrix = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const focus = new THREE.Vector3(), lastFocus = new THREE.Vector3(Infinity, Infinity, Infinity), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const requests = new Map(), errors = [];
  const lifecycle = { loaded: 0, released: 0, aborted: 0, failed: 0, retries: 0, discardedLate: 0 };
  let disposed = false, active = 0, lastDistance = -Infinity;
  const counts = {};

  function destroyTexture(texture) {
    if (!texture) return; texture.dispose(); const image = texture.image;
    if (image?.close) image.close(); else if (image && typeof image.src === 'string') image.src = '';
    texture.image = null;
  }
  function release(page) {
    if (page.state === 'loading') {
      page.generation++; page.controller?.abort(); page.controller = null; page.state = 'idle'; lifecycle.aborted++;
      const request = requests.get(page.atlas.url); if (request) request.aborted++;
    }
    if (page.mesh) {
      const mesh = page.mesh, ix = interactables.indexOf(mesh), mx = meshes.indexOf(mesh);
      if (ix >= 0) interactables.splice(ix, 1); if (mx >= 0) meshes.splice(mx, 1);
      meshPages.delete(mesh); mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose?.();
      page.mesh = null; lifecycle.released++;
    }
    destroyTexture(page.texture); page.texture = null; page.pixels = null;
    if (page.state === 'resident') page.state = 'idle';
  }
  function createPage(page, texture) {
    texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true; texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.anisotropy = 1; texture.name = page.atlas.url; texture.needsUpdate = true;
    const originalMaterial = page.records[0].original.material, material = originalMaterial.clone(); material.map = texture;
    const priorCompile = originalMaterial.onBeforeCompile, priorKey = originalMaterial.customProgramCacheKey();
    material.onBeforeCompile = function(shader, renderer) {
      priorCompile.call(this, shader, renderer);
      shader.vertexShader = 'attribute vec4 spriteAtlasRect;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
          vMapUv = spriteAtlasRect.xy + vMapUv * spriteAtlasRect.zw;
        #endif`);
    };
    material.customProgramCacheKey = () => `${priorKey}-sprite-atlas-v1`;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('spriteAtlasRect', new THREE.InstancedBufferAttribute(new Float32Array(page.records.flatMap(r => r.entry.uvRect)), 4));
    const mesh = new THREE.InstancedMesh(geometry, material, page.records.length); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = `sprite-stream-${mapping.summary.profile}-${page.index}`; mesh.frustumCulled = false;
    mesh.instanceIds = page.records.map(r => r.original.userData.instanceId);
    Object.assign(mesh.userData, { instanceIds: mesh.instanceIds, spriteAtlasBatch: true, spriteAtlasIndex: page.index,
      spriteOriginals: page.records.map(r => r.original), spriteEntries: page.records.map(r => r.entry) });
    const inheritedRaycast = mesh.raycast;
    mesh.raycast = function(raycaster, hits) {
      if (!displayed(this)) return; const candidates = []; inheritedRaycast.call(this, raycaster, candidates);
      for (const hit of candidates) {
        const record = page.records[hit.instanceId]; if (record?.visible && displayed(record.original)) hits.push(hit);
      }
    };
    page.mesh = mesh; page.texture = texture; page.state = 'resident';
    scene.add(mesh); interactables.push(mesh); meshPages.set(mesh, page); meshes.push(mesh); updateMatrices(page);
  }
  function start(page) {
    const generation = ++page.generation, controller = new AbortController();
    page.controller = controller; page.state = 'loading'; page.attempts++; active++;
    if (page.attempts > 1) lifecycle.retries++;
    const request = requests.get(page.atlas.url) ?? { attempts: 0, completed: 0, failed: 0, aborted: 0, kind: page.kind };
    request.attempts++; requests.set(page.atlas.url, request);
    const task = Promise.resolve().then(() => loadTexture(page.atlas.url, { signal: controller.signal })).then(texture => {
      if (disposed || controller.signal.aborted || generation !== page.generation || !page.wanted) {
        destroyTexture(texture); lifecycle.discardedLate++; return;
      }
      createPage(page, texture); page.lastError = null; lifecycle.loaded++; request.completed++;
    }).catch(error => {
      if (controller.signal.aborted || generation !== page.generation || disposed) return;
      page.state = 'error'; page.lastError = String(error?.message ?? error);
      page.nextRetry = clock() + retryDelay * Math.min(page.attempts, 5); lifecycle.failed++; request.failed++;
      errors.push({ url: page.atlas.url, attempt: page.attempts, error: page.lastError, at: new Date().toISOString() });
      if (errors.length > 40) errors.shift();
    }).finally(() => {
      active--; if (page.task === task) { page.task = null; page.controller = null; } pump(); refreshCounts();
    });
    page.task = task;
  }
  function pump() {
    if (disposed) return; const now = clock();
    const queue = pages.filter(p => p.wanted && !p.task && (p.state === 'idle' || (p.state === 'error' && now >= p.nextRetry)));
    queue.sort((a, b) => Number(b.kind === 'npc') - Number(a.kind === 'npc') || a.distance - b.distance);
    for (const page of queue) { if (active >= loadConcurrency) break; start(page); }
  }
  function updateMatrices(page) {
    const mesh = page.mesh; if (!mesh) return;
    mesh.visible = page.wanted; mesh.updateWorldMatrix(true, false); inverse.copy(mesh.matrixWorld).invert();
    for (let slot = 0; slot < page.records.length; slot++) {
      const record = page.records[slot];
      if (record.visible) {
        record.original.updateWorldMatrix(true, false);
        matrix.multiplyMatrices(inverse, record.original.matrixWorld).multiply(record.shape); mesh.setMatrixAt(slot, matrix);
      } else mesh.setMatrixAt(slot, zero);
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
  }
  function refreshCounts() {
    Object.assign(counts, { total: records.length, visible: 0, npc: 0, landscape: 0, visibleNear: 0, rendered: 0,
      pages: pages.length, drawablePages: 0, submittedDrawPages: 0, submittedSlots: 0,
      resident: 0, residentNpcPages: 0, residentLandscapePages: 0, pending: active, queued: 0,
      residentRgbaBytes: 0, residentHitPixelBytes: 0, failures: lifecycle.failed, retiredTextures, skipped });
    for (const page of pages) {
      if (page.wanted && !page.task && page.state === 'idle') counts.queued++;
      if (page.state === 'resident') {
        counts.resident++; counts[page.kind === 'npc' ? 'residentNpcPages' : 'residentLandscapePages']++;
        counts.residentRgbaBytes += page.atlas.rgbaBytes ?? page.texture.image.width * page.texture.image.height * 4;
        counts.residentHitPixelBytes += page.pixels?.data.byteLength ?? 0;
        if (page.wanted) { counts.drawablePages++; counts.submittedDrawPages++; counts.submittedSlots += page.mesh.count; }
      }
      for (const record of page.records) {
        if (record.allowed) { counts.visible++; counts[record.entry.kind === 'npc' ? 'npc' : 'landscape']++; }
        if (record.visible) { counts.visibleNear++; if (page.mesh) counts.rendered++; }
      }
    }
    counts.totalLogicalCount = counts.total; counts.visibleLogicalCount = counts.visible; counts.hiddenLogicalCount = counts.total - counts.visible;
    counts.slotNote = 'Logical visibility preserves layer state; only nearby resident records draw. Submitted slots include zero-scale slots.';
    return counts;
  }
  function update(nextCamera, force = false) {
    if (nextCamera?.isCamera) camera = nextCamera; if (disposed) return counts;
    const now = clock(); if (camera) camera.getWorldPosition(focus);
    const checkDistance = force || now - lastDistance >= distanceInterval || focus.distanceToSquared(lastFocus) > 4;
    for (const page of pages) {
      page.wanted = false; page.distance = Infinity;
      for (const record of page.records) {
        const allowed = displayed(record.original);
        if (allowed && (checkDistance || !record.allowed)) {
          if (camera && Number.isFinite(radius)) {
            record.original.updateWorldMatrix(true, false); position.setFromMatrixPosition(record.original.matrixWorld);
            scale.setFromMatrixScale(record.original.matrixWorld);
            record.distance = Math.max(0, Math.hypot(position.x - focus.x, position.z - focus.z) - record.localRadius * Math.max(scale.x, scale.y));
            record.inRange = record.distance <= (record.inRange ? keepRadius : radius);
          } else { record.distance = 0; record.inRange = true; }
        }
        record.allowed = allowed; record.visible = allowed && record.inRange;
        if (record.visible) { page.wanted = true; page.distance = Math.min(page.distance, record.distance); }
      }
      if (!page.wanted) release(page); else updateMatrices(page);
    }
    if (checkDistance) { lastDistance = now; lastFocus.copy(focus); }
    pump(); return refreshCounts();
  }
  function visibleCounts() { return { ...refreshCounts() }; }
  function snapshot() {
    return { ...refreshCounts(), radius, keepRadius, concurrency: loadConcurrency, disposed,
      residentUrls: pages.filter(p => p.state === 'resident').map(p => p.atlas.url),
      pendingUrls: pages.filter(p => p.task).map(p => p.atlas.url),
      requestedUrls: [...requests.keys()], requests: Object.fromEntries([...requests].map(([url, v]) => [url, { ...v }])),
      lifecycle: { ...lifecycle }, errors: errors.map(e => ({ ...e })),
      failedPages: pages.filter(p => p.state === 'error').map(p => ({ url: p.atlas.url, error: p.lastError, attempts: p.attempts })) };
  }
  function hitRecord(hit) {
    if (!hit.object?.userData.spriteAtlasBatch) return undefined;
    const page = meshPages.get(hit.object), record = page?.records[hit.instanceId];
    return record ? { page, record, original: record.original, instanceId: record.original.userData.instanceId, entry: record.entry } : null;
  }
  function pagePixels(page) {
    if (!page.texture?.image) return null;
    if (!page.pixels) {
      const image = page.texture.image, canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0); page.pixels = context.getImageData(0, 0, canvas.width, canvas.height); canvas.width = canvas.height = 0;
    }
    return page.pixels;
  }
  function alphaHit(hit, threshold = 50) {
    const found = hitRecord(hit); if (found === undefined) return undefined;
    if (!found || !found.record.visible || !displayed(found.original) || !displayed(found.page.mesh) || !hit.uv) return false;
    const pixels = pagePixels(found.page); if (!pixels) return false;
    const [rx, ry, width, height] = found.entry.pixelRect;
    const x = rx + THREE.MathUtils.clamp(Math.floor(hit.uv.x * width), 0, width - 1);
    const y = ry + THREE.MathUtils.clamp(Math.floor((1 - hit.uv.y) * height), 0, height - 1);
    return pixels.data[(y * pixels.width + x) * 4 + 3] > threshold;
  }
  function getHitPoint(id) {
    const found = byId.get(id); if (!found || !found.record.visible || !found.page.texture) return null;
    const { page, record } = found;
    if (!record.hitUv) {
      const pixels = pagePixels(page); if (!pixels) return null;
      const [rx, ry, width, height] = record.entry.pixelRect; let best = null, distance = Infinity;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (pixels.data[((ry + y) * pixels.width + rx + x) * 4 + 3] <= 220) continue;
        const d = (x / width - .5) ** 2 + (y / height - .5) ** 2;
        if (d < distance) { distance = d; best = [x / width, y / height]; }
      }
      record.hitUv = best;
    }
    if (!record.hitUv) return null;
    const original = record.original, [w, h] = original.userData.imageSize, [ax, ay] = original.userData.alphaAnchor;
    original.updateWorldMatrix(true, false);
    return original.localToWorld(new THREE.Vector3((record.hitUv[0] - ax) * w, (ay - record.hitUv[1]) * h, 0));
  }
  async function settle({ npcOnly = false } = {}) {
    // An error stays observable/retryable rather than hanging startup indefinitely.
    while (!disposed) {
      pump();
      const pending = pages.filter(p => p.wanted && (!npcOnly || p.kind === 'npc') && (p.task || p.state === 'idle'));
      if (!pending.length) break;
      const tasks = pages.filter(p => p.task).map(p => p.task); if (!tasks.length) break; await Promise.race(tasks);
    }
    return visibleCounts();
  }
  function retry() {
    for (const page of pages) if (page.state === 'error') { page.nextRetry = 0; page.state = 'idle'; }
    pump(); return settle();
  }
  function dispose() {
    if (disposed) return; disposed = true;
    for (const page of pages) { page.wanted = false; release(page); }
    for (const record of records) {
      record.original.layers.mask = record.layerMask; delete record.original.userData.spriteAtlasOriginal; record.visible = record.allowed = false;
    }
    for (const texture of oldTextures) if (texture.userData.spriteAtlasGPURetired) {
      delete texture.userData.spriteAtlasGPURetired; texture.needsUpdate = true;
    }
    refreshCounts();
  }
  update(null, true); await settle({ npcOnly: true });
  return { meshes, update, visibleCounts, snapshot, settle, retry, hitRecord, alphaHit, getHitPoint, dispose, mapping, skipped };
}
