import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { palettes } from './helpers/palettes.js';

import { BezierAnimator }      from './animators/BezierAnimator.js';
import { SpiralAnimator }      from './animators/SpiralAnimator.js';
import { ZigzagAnimator }      from './animators/ZigzagAnimator.js';
import { ZigzagBezierAnimator } from './animators/ZigzagBezierAnimator.js';
import { LissajousAnimator }   from './animators/LissajousAnimator.js';
import { PhysicsAnimator }     from './animators/PhysicsAnimator.js';
import { CubeAnimator }        from './animators/CubeAnimator.js';
import { StrokeRenderer }      from './renderers/StrokeRenderer.js';
import { createBrushTexture }  from './helpers/textures.js';

import { SphereAnimator }      from './animators/SphereAnimator.js';
import { ConeAnimator }        from './animators/ConeAnimator.js';
import { CylinderAnimator }    from './animators/CylinderAnimator.js';
import { TorusAnimator }       from './animators/TorusAnimator.js';
import { PyramidAnimator }     from './animators/PyramidAnimator.js';
import { TwistedTubeAnimator } from './animators/TwistedTubeAnimator.js';

// ─── Texture / noise / cap state (mirrors app.js logic) ──────────────────────
const textureCache = {};
const textureConfigs = {
    solid:      { repeat: 1.0,  threshold: 0.0  },
    dry_brush:  { repeat: 6.0,  threshold: 0.25 },
    charcoal:   { repeat: 4.0,  threshold: 0.2  },
    ink_dotted: { repeat: 8.0,  threshold: 0.3  },
    hatching:   { repeat: 12.0, threshold: 0.2  },
    acrylic:    { repeat: 4.0,  threshold: 0.25 }
};

let currentTextureType = 'solid';

function getTexture(type) {
    if (type === 'solid') return null;
    if (!textureCache[type]) textureCache[type] = createBrushTexture(type);
    return textureCache[type];
}

function updateActiveTexture(type) {
    currentTextureType = type;
    const cfg = textureConfigs[type];
    const tex = getTexture(type);
    StrokeRenderer.defaultTexture          = tex;
    StrokeRenderer.defaultTextureRepeat    = cfg.repeat;
    StrokeRenderer.defaultTextureThreshold = cfg.threshold;
    for (const a of animators) {
        if (a.renderer) a.renderer.updateTexture(tex, cfg.repeat, cfg.threshold);
    }
}

// ─── Scene ────────────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container');
const canvas    = document.getElementById('canvas3d');

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 14.5);

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom    = true;
controls.minDistance   = 3;
controls.maxDistance   = 25;

const objectsGroup = new THREE.Group();
scene.add(objectsGroup);

const animators     = [];

// Initialise StrokeRenderer statics to solid/ragged/auto
updateActiveTexture('solid');
StrokeRenderer.defaultCapStyle  = 'ragged';
StrokeRenderer.defaultNoiseMode = null;
const paletteColors = palettes.palette01;

const bgIndex        = Math.floor(Math.random() * paletteColors.length);
const bgPaletteColor = paletteColors[bgIndex];
container.style.backgroundColor = bgPaletteColor.hex;
renderer.setClearColor(new THREE.Color(bgPaletteColor.hex), 1.0);

let strokePaletteColors = paletteColors.filter((_, i) => i !== bgIndex);

// ─── Animator registries ──────────────────────────────────────────────────────
const strokeAnimatorClasses = {
    bezier:          BezierAnimator,
    spiral:          SpiralAnimator,
    zigzag:          ZigzagAnimator,
    'zigzag-bezier': ZigzagBezierAnimator,
    lissajous:       LissajousAnimator,
    physics:         PhysicsAnimator,
    cube:            CubeAnimator
};

const primitiveAnimatorClasses = {
    sphere:        SphereAnimator,
    cone:          ConeAnimator,
    cylinder:      CylinderAnimator,
    torus:         TorusAnimator,
    pyramid:       PyramidAnimator,
    'twisted-tube': TwistedTubeAnimator
};

// ─── State ────────────────────────────────────────────────────────────────────
const selectedStrokes = {
    bezier: true, spiral: true, zigzag: true, 'zigzag-bezier': true,
    lissajous: true, physics: true, cube: true
};

const selectedPrimitives = {
    sphere: true, cone: true, cylinder: true, torus: true, pyramid: true, 'twisted-tube': true
};

const selectedPrimitiveStyles = {
    sphere:        { 0: true, 1: true, 2: true, 3: true, 4: true },
    cone:          { 0: true, 1: true, 2: true, 3: true, 4: true },
    cylinder:      { 0: true, 1: true, 2: true, 3: true, 4: true },
    torus:         { 0: true, 1: true, 2: true, 3: true, 4: true },
    pyramid:       { 0: true, 1: true, 2: true, 3: true, 4: true },
    'twisted-tube': { 0: true, 1: true, 2: true, 3: true, 4: true }
};

let objectCount   = 8;
let sizeMin       = 3.0;
let sizeMax       = 5.0;
let isPaused      = false;
let currentCapStyle   = 'ragged';
let currentNoiseMode  = null; // null = auto

// ─── Persistence ──────────────────────────────────────────────────────────────
const SETTINGS_KEY = 'mix_gallery_settings_v1';

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        selectedStrokes, selectedPrimitives, selectedPrimitiveStyles,
        objectCount, sizeMin, sizeMax,
        currentTextureType, currentCapStyle,
        currentNoiseMode: currentNoiseMode === null ? 'auto' : String(currentNoiseMode)
    }));
}

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return;
    try {
        const s = JSON.parse(saved);
        if (s.selectedStrokes) Object.assign(selectedStrokes, s.selectedStrokes);
        if (s.selectedPrimitives) Object.assign(selectedPrimitives, s.selectedPrimitives);
        if (s.selectedPrimitiveStyles) {
            for (const [shape, styles] of Object.entries(s.selectedPrimitiveStyles)) {
                if (selectedPrimitiveStyles[shape]) Object.assign(selectedPrimitiveStyles[shape], styles);
            }
        }
        if (typeof s.objectCount === 'number') objectCount = s.objectCount;
        if (typeof s.sizeMin    === 'number') sizeMin     = s.sizeMin;
        if (typeof s.sizeMax    === 'number') sizeMax     = s.sizeMax;
        if (s.currentTextureType) {
            updateActiveTexture(s.currentTextureType);
        }
        if (s.currentCapStyle) {
            currentCapStyle = s.currentCapStyle;
            StrokeRenderer.defaultCapStyle = currentCapStyle;
        }
        if (s.currentNoiseMode !== undefined) {
            currentNoiseMode = s.currentNoiseMode === 'auto' ? null : parseInt(s.currentNoiseMode);
            StrokeRenderer.defaultNoiseMode = currentNoiseMode;
        }
    } catch (e) {
        console.error('Error loading settings:', e);
    }
}

function syncUI() {
    // Stroke type checkboxes
    for (const type of Object.keys(selectedStrokes)) {
        const chk = document.getElementById(`chk-stroke-${type}`);
        if (chk) chk.checked = selectedStrokes[type];
    }
    // Primitive shape checkboxes + sub-styles
    for (const shape of Object.keys(selectedPrimitives)) {
        const chk = document.getElementById(`chk-prim-${shape}`);
        if (chk) chk.checked = selectedPrimitives[shape];
        const div = document.getElementById(`pstyles-${shape}`);
        if (div) div.classList.toggle('visible', selectedPrimitives[shape]);
    }
    document.querySelectorAll('.chk-prim-style').forEach(chk => {
        const shape = chk.dataset.shape;
        const style = parseInt(chk.dataset.style);
        if (selectedPrimitiveStyles[shape]) chk.checked = !!selectedPrimitiveStyles[shape][style];
    });
    // Texture radios
    document.querySelectorAll('[name="rad-texture"]').forEach(r => {
        r.checked = r.value === currentTextureType;
    });
    // Noise mode radios
    const noiseSaved = currentNoiseMode === null ? 'auto' : String(currentNoiseMode);
    document.querySelectorAll('[name="rad-noise-mode"]').forEach(r => {
        r.checked = r.value === noiseSaved;
    });
    // Cap style radios
    document.querySelectorAll('[name="rad-cap-style"]').forEach(r => {
        r.checked = r.value === currentCapStyle;
    });
    // Layout steppers
    setStepper('count',    objectCount);
    setStepper('size-min', sizeMin);
    setStepper('size-max', sizeMax);
}

function setStepper(name, val) {
    const num = document.getElementById(`num-${name}`);
    if (num) num.value = val;
}

// ─── Scene build ──────────────────────────────────────────────────────────────
function buildPool() {
    const pool = [];
    for (const [type, on] of Object.entries(selectedStrokes)) {
        if (on) pool.push({ kind: 'stroke', type });
    }
    for (const [shape, on] of Object.entries(selectedPrimitives)) {
        if (!on) continue;
        const styles = Object.entries(selectedPrimitiveStyles[shape])
            .filter(([, v]) => v).map(([s]) => parseInt(s));
        if (styles.length > 0) pool.push({ kind: 'primitive', shape, styles });
    }
    return pool;
}

function rebuildScene() {
    for (const a of animators) a.destroy();
    animators.length = 0;
    while (objectsGroup.children.length > 0) objectsGroup.remove(objectsGroup.children[0]);

    const pool = buildPool();
    if (pool.length === 0) return;

    for (let i = 0; i < objectCount; i++) {
        const item  = pool[Math.floor(Math.random() * pool.length)];
        const scale = sizeMin + Math.random() * Math.max(0, sizeMax - sizeMin);
        const posX  = (Math.random() - 0.5) * 12;
        const posY  = (Math.random() - 0.5) * 10;
        const posZ  = (Math.random() - 0.5) * 2;

        const group = new THREE.Group();
        group.position.set(posX, posY, posZ);
        group.scale.set(scale, scale, scale);
        objectsGroup.add(group);

        let animator;
        if (item.kind === 'stroke') {
            const idxA = Math.floor(Math.random() * strokePaletteColors.length);
            let idxB   = Math.floor(Math.random() * strokePaletteColors.length);
            while (idxB === idxA && strokePaletteColors.length > 1) {
                idxB = Math.floor(Math.random() * strokePaletteColors.length);
            }
            const colorA = new THREE.Color().fromArray(strokePaletteColors[idxA].rgb);
            const colorB = new THREE.Color().fromArray(strokePaletteColors[idxB].rgb);
            animator = new strokeAnimatorClasses[item.type](group, colorA, colorB, camera);
        } else {
            const style = item.styles[Math.floor(Math.random() * item.styles.length)];
            animator = new primitiveAnimatorClasses[item.shape](group, strokePaletteColors, camera, style);
        }
        animators.push(animator);
    }
}

loadSettings();
syncUI();
rebuildScene();

// ─── Resize ───────────────────────────────────────────────────────────────────
function handleResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}
new ResizeObserver(handleResize).observe(container);
handleResize();

// ─── Animation loop ───────────────────────────────────────────────────────────
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt   = clock.getDelta();
    const time = clock.getElapsedTime();
    if (!isPaused) {
        for (const a of animators) a.update(time, dt, camera);
    }
    controls.update();
    renderer.render(scene, camera);
}
animate();

// ─── UI ───────────────────────────────────────────────────────────────────────

// Settings panel toggle
const btnToggleSettings = document.getElementById('btn-toggle-settings');
const settingsPanel     = document.getElementById('settings-panel');
if (btnToggleSettings && settingsPanel) {
    btnToggleSettings.addEventListener('click', () => {
        settingsPanel.classList.toggle('hidden');
        btnToggleSettings.classList.toggle('active');
    });
    document.addEventListener('click', e => {
        if (!settingsPanel.classList.contains('hidden') &&
            !settingsPanel.contains(e.target) &&
            !btnToggleSettings.contains(e.target)) {
            settingsPanel.classList.add('hidden');
            btnToggleSettings.classList.remove('active');
        }
    });
}

// Stroke checkboxes
Object.keys(selectedStrokes).forEach(type => {
    const chk = document.getElementById(`chk-stroke-${type}`);
    if (!chk) return;
    chk.addEventListener('change', () => {
        selectedStrokes[type] = chk.checked;
        rebuildScene();
        saveSettings();
    });
});

// Primitive shape checkboxes
Object.keys(selectedPrimitives).forEach(shape => {
    const chk = document.getElementById(`chk-prim-${shape}`);
    const div = document.getElementById(`pstyles-${shape}`);
    if (!chk) return;
    chk.addEventListener('change', () => {
        selectedPrimitives[shape] = chk.checked;
        if (div) div.classList.toggle('visible', chk.checked);
        rebuildScene();
        saveSettings();
    });
});

// Primitive style checkboxes
document.querySelectorAll('.chk-prim-style').forEach(chk => {
    chk.addEventListener('change', () => {
        const shape = chk.dataset.shape;
        const style = parseInt(chk.dataset.style);
        if (selectedPrimitiveStyles[shape]) {
            selectedPrimitiveStyles[shape][style] = chk.checked;
            rebuildScene();
            saveSettings();
        }
    });
});

// Number stepper binder
function bindStepper(name, isInt, onChange) {
    const num = document.getElementById(`num-${name}`);
    if (!num) return;
    const min = parseFloat(num.min);
    const max = parseFloat(num.max);
    const clamp = v => Math.min(max, Math.max(min, isInt ? Math.round(v) : parseFloat(parseFloat(v).toFixed(1))));
    const fmt   = v => isInt ? String(Math.round(v)) : parseFloat(v).toFixed(1);

    // input fires immediately on spinner arrow clicks — respond without reformatting
    num.addEventListener('input', () => {
        const raw = parseFloat(num.value);
        if (!isNaN(raw)) onChange(clamp(raw));
    });
    // change fires on blur/Enter — clamp and reformat any typed value
    num.addEventListener('change', () => {
        const v = clamp(parseFloat(num.value) || min);
        num.value = fmt(v);
        onChange(v);
    });
}

bindStepper('count', true, v => {
    objectCount = v;
    rebuildScene();
    saveSettings();
});

bindStepper('size-min', false, v => {
    sizeMin = v;
    if (sizeMin > sizeMax) { sizeMax = sizeMin; setStepper('size-max', sizeMax); }
    rebuildScene();
    saveSettings();
});

bindStepper('size-max', false, v => {
    sizeMax = v;
    if (sizeMax < sizeMin) { sizeMin = sizeMax; setStepper('size-min', sizeMin); }
    rebuildScene();
    saveSettings();
});

// Texture radios — update existing stroke renderers in-place, no rebuild
document.querySelectorAll('[name="rad-texture"]').forEach(r => {
    r.addEventListener('change', e => {
        if (e.target.checked) {
            updateActiveTexture(e.target.value);
            saveSettings();
        }
    });
});

// Noise mode radios — update existing stroke renderers in-place
document.querySelectorAll('[name="rad-noise-mode"]').forEach(r => {
    r.addEventListener('change', e => {
        if (!e.target.checked) return;
        const val = e.target.value;
        currentNoiseMode = val === 'auto' ? null : parseInt(val);
        StrokeRenderer.defaultNoiseMode = currentNoiseMode;
        for (const a of animators) {
            if (a.renderer) {
                const mode = currentNoiseMode !== null ? currentNoiseMode
                    : (a.renderer.gradientDirection === 'u' ? 2 : 3);
                a.renderer.updateNoiseMode(mode);
            }
        }
        saveSettings();
    });
});

// Cap style radios — update existing stroke renderers in-place
document.querySelectorAll('[name="rad-cap-style"]').forEach(r => {
    r.addEventListener('change', e => {
        if (!e.target.checked) return;
        currentCapStyle = e.target.value;
        StrokeRenderer.defaultCapStyle = currentCapStyle;
        for (const a of animators) {
            if (a.renderer) a.renderer.updateCapStyle(currentCapStyle);
        }
        saveSettings();
    });
});

// Pause / Resume
const btnPause = document.getElementById('btn-pause');
if (btnPause) {
    btnPause.addEventListener('click', () => {
        isPaused = !isPaused;
        btnPause.textContent = isPaused ? 'Resume' : 'Pause';
        btnPause.classList.toggle('active', isPaused);
    });
}

// Randomize Objects
const btnRandomize = document.getElementById('btn-randomize-objects');
if (btnRandomize) btnRandomize.addEventListener('click', rebuildScene);

// Randomize Color — update colors in-place; never repositions objects
const btnRandomColor = document.getElementById('btn-randomize-color');
if (btnRandomColor) {
    btnRandomColor.addEventListener('click', () => {
        const bgIdx = Math.floor(Math.random() * paletteColors.length);
        const bgCol = paletteColors[bgIdx];
        container.style.backgroundColor = bgCol.hex;
        renderer.setClearColor(new THREE.Color(bgCol.hex), 1.0);
        strokePaletteColors = paletteColors.filter((_, i) => i !== bgIdx);

        for (const animator of animators) {
            if (animator.colorA !== undefined) {
                // Stroke animator — two palette colors
                const idxA = Math.floor(Math.random() * strokePaletteColors.length);
                let idxB = Math.floor(Math.random() * strokePaletteColors.length);
                while (idxB === idxA && strokePaletteColors.length > 1) {
                    idxB = Math.floor(Math.random() * strokePaletteColors.length);
                }
                animator.colorA.fromArray(strokePaletteColors[idxA].rgb);
                animator.colorB.fromArray(strokePaletteColors[idxB].rgb);
            } else if (animator.colorBase !== undefined) {
                // Primitive animator — four distinct palette colors
                const idxs = [];
                const numColors = Math.min(4, strokePaletteColors.length);
                while (idxs.length < numColors) {
                    const rIdx = Math.floor(Math.random() * strokePaletteColors.length);
                    if (!idxs.includes(rIdx)) idxs.push(rIdx);
                }
                while (idxs.length < 4) idxs.push(0);
                animator.colorBase.fromArray(strokePaletteColors[idxs[0]].rgb);
                animator.colorX.fromArray(strokePaletteColors[idxs[1]].rgb);
                animator.colorY.fromArray(strokePaletteColors[idxs[2]].rgb);
                animator.colorZ.fromArray(strokePaletteColors[idxs[3]].rgb);
                // TwistedTubeAnimator cap materials are cloned and need explicit sync
                if (animator.capStartMesh) {
                    animator.capStartMesh.material.color.copy(animator.colorBase);
                    animator.capEndMesh.material.color.copy(animator.colorBase);
                }
            }
        }
    });
}

// Save PNG
const btnSavePng = document.getElementById('btn-save-png');
if (btnSavePng) {
    btnSavePng.addEventListener('click', () => {
        renderer.render(scene, camera);
        const link = document.createElement('a');
        link.download = 'mix_gallery.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
}

// Video recording
const btnRecordVideo = document.getElementById('btn-record-video');
if (btnRecordVideo) {
    btnRecordVideo.addEventListener('click', () => {
        if (btnRecordVideo.classList.contains('recording')) return;
        const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
        const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
        if (!mimeType) { alert('MediaRecorder not supported in this browser.'); return; }
        const chunks = [];
        const rec = new MediaRecorder(canvas.captureStream(60), { mimeType, videoBitsPerSecond: 25000000 });
        rec.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
        rec.onstop = () => {
            const url  = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
            const link = document.createElement('a');
            link.download = 'mix_gallery.webm';
            link.href = url;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 100);
            btnRecordVideo.classList.remove('recording');
            btnRecordVideo.textContent = 'Record Video (16sec)';
        };
        rec.start();
        btnRecordVideo.classList.add('recording');
        let t = 16;
        btnRecordVideo.textContent = `Recording... (${t}s)`;
        const countdown = setInterval(() => {
            t--;
            if (t <= 0) clearInterval(countdown);
            else btnRecordVideo.textContent = `Recording... (${t}s)`;
        }, 1000);
        setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 16000);
    });
}
