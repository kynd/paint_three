import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { palettes } from './helpers/palettes.js';
import { SphereAnimator }   from './animators/SphereAnimator.js';
import { ConeAnimator }     from './animators/ConeAnimator.js';
import { CylinderAnimator } from './animators/CylinderAnimator.js';

// DOM elements
const container = document.getElementById('canvas-container');
const canvas    = document.getElementById('canvas3d');

// Scene setup
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 14.5);

// Renderer
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.05;
controls.enableZoom     = true;
controls.minDistance    = 3;
controls.maxDistance    = 25;

// Visual group
const strokesGroup = new THREE.Group();
scene.add(strokesGroup);

const animators      = [];
const paletteColors  = palettes.palette01;

// Background
const bgIndex         = Math.floor(Math.random() * paletteColors.length);
const bgPaletteColor  = paletteColors[bgIndex];
container.style.backgroundColor = bgPaletteColor.hex;
renderer.setClearColor(new THREE.Color(bgPaletteColor.hex), 1.0);

let strokePaletteColors = paletteColors.filter((_, idx) => idx !== bgIndex);

// Animator class map
const animatorClasses = {
    sphere:   SphereAnimator,
    cone:     ConeAnimator,
    cylinder: CylinderAnimator
};

// Paint style names (for display / reference)
const styleNames = { 0: 'Spiral', 1: 'Horizontal Paint', 2: 'Vertical Paint', 3: 'Mix' };

// ─── State ────────────────────────────────────────────────────────────────────
// Which shape types are enabled
const selectedShapes = { sphere: true, cone: true, cylinder: true };

// Which paint styles are enabled per shape
const selectedStyles = {
    sphere:   { 0: true, 1: true, 2: true, 3: true },
    cone:     { 0: true, 1: true, 2: true, 3: true },
    cylinder: { 0: true, 1: true, 2: true, 3: true }
};

// Grid layout state
let currentGridLayout = '2x2';

const gridLayoutConfigs = {
    '2x2': { rows: 2, cols: 2, spacing: 5.2, scale: 2.0 },
    '3x3': { rows: 3, cols: 3, spacing: 3.8, scale: 1.4 },
    '4x4': { rows: 4, cols: 4, spacing: 3.0, scale: 1.0 }
};

// ─── Persistence ──────────────────────────────────────────────────────────────
const SETTINGS_KEY = 'primitives_gallery_settings_v2';

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ selectedShapes, selectedStyles, currentGridLayout }));
}

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return;
    try {
        const s = JSON.parse(saved);

        if (s.selectedShapes) {
            Object.assign(selectedShapes, s.selectedShapes);
            for (const shape of Object.keys(selectedShapes)) {
                const chk = document.getElementById(`chk-${shape}`);
                if (chk) chk.checked = !!selectedShapes[shape];
                const stylesDiv = document.getElementById(`styles-${shape}`);
                if (stylesDiv) stylesDiv.classList.toggle('visible', !!selectedShapes[shape]);
            }
        }

        if (s.selectedStyles) {
            for (const [shape, styles] of Object.entries(s.selectedStyles)) {
                if (selectedStyles[shape]) Object.assign(selectedStyles[shape], styles);
            }
            // Sync checkboxes
            document.querySelectorAll('.chk-style').forEach(chk => {
                const shape = chk.dataset.shape;
                const style = parseInt(chk.dataset.style);
                if (selectedStyles[shape]) chk.checked = !!selectedStyles[shape][style];
            });
        }

        if (s.currentGridLayout) {
            currentGridLayout = s.currentGridLayout;
            document.querySelectorAll('[name="rad-grid-layout"]').forEach(r => {
                r.checked = (r.value === currentGridLayout);
            });
        }
    } catch (e) {
        console.error('Error loading settings:', e);
    }
}

// ─── Grid ─────────────────────────────────────────────────────────────────────
function buildPool() {
    /** Returns all enabled (shape, style) pairs to draw from randomly. */
    const pool = [];
    for (const [shape, enabled] of Object.entries(selectedShapes)) {
        if (!enabled) continue;
        for (const [style, styleEnabled] of Object.entries(selectedStyles[shape])) {
            if (styleEnabled) pool.push({ shape, style: parseInt(style) });
        }
    }
    return pool;
}

function rebuildGrid() {
    // Destroy existing
    for (const animator of animators) animator.destroy();
    animators.length = 0;
    while (strokesGroup.children.length > 0) strokesGroup.remove(strokesGroup.children[0]);

    const pool = buildPool();
    if (pool.length === 0) return;

    const { rows, cols, spacing, scale } = gridLayoutConfigs[currentGridLayout] || gridLayoutConfigs['2x2'];
    const strokeCount = rows * cols;
    const offsetX = -(cols - 1) * spacing / 2;
    const offsetY = -(rows - 1) * spacing / 2;

    for (let i = 0; i < strokeCount; i++) {
        const colIdx = i % cols;
        const rowIdx = Math.floor(i / cols);
        const posX = offsetX + colIdx * spacing;
        const posY = offsetY + (rows - 1 - rowIdx) * spacing;

        const specimenGroup = new THREE.Group();
        specimenGroup.position.set(posX, posY, 0);
        specimenGroup.scale.set(scale, scale, scale);
        strokesGroup.add(specimenGroup);

        // Pick random (shape, style) from the enabled pool
        const { shape, style } = pool[Math.floor(Math.random() * pool.length)];
        const AnimatorClass = animatorClasses[shape];

        const animator = new AnimatorClass(specimenGroup, strokePaletteColors, camera, style);
        animators.push(animator);
    }
}

// Load persisted settings then build
loadSettings();
rebuildGrid();

// ─── Resize ───────────────────────────────────────────────────────────────────
function handleResize() {
    const width  = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
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
    for (const animator of animators) animator.update(time, dt, camera);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// ─── UI Event Handlers ────────────────────────────────────────────────────────

// Settings panel toggle
const btnToggleSettings = document.getElementById('btn-toggle-settings');
const settingsPanel     = document.getElementById('settings-panel');
if (btnToggleSettings && settingsPanel) {
    btnToggleSettings.addEventListener('click', () => {
        settingsPanel.classList.toggle('hidden');
        btnToggleSettings.classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
        if (!settingsPanel.classList.contains('hidden')) {
            if (!settingsPanel.contains(e.target) && !btnToggleSettings.contains(e.target)) {
                settingsPanel.classList.add('hidden');
                btnToggleSettings.classList.remove('active');
            }
        }
    });
}

// Shape checkboxes — toggle shape and show/hide style sub-options
['sphere', 'cone', 'cylinder'].forEach(shape => {
    const chk = document.getElementById(`chk-${shape}`);
    const stylesDiv = document.getElementById(`styles-${shape}`);
    if (chk) {
        chk.addEventListener('change', () => {
            selectedShapes[shape] = chk.checked;
            if (stylesDiv) stylesDiv.classList.toggle('visible', chk.checked);
            rebuildGrid();
            saveSettings();
        });
    }
});

// Paint style checkboxes
document.querySelectorAll('.chk-style').forEach(chk => {
    chk.addEventListener('change', () => {
        const shape = chk.dataset.shape;
        const style = parseInt(chk.dataset.style);
        if (selectedStyles[shape]) {
            selectedStyles[shape][style] = chk.checked;
            rebuildGrid();
            saveSettings();
        }
    });
});

// Grid layout radios
document.querySelectorAll('[name="rad-grid-layout"]').forEach(rad => {
    rad.addEventListener('change', () => {
        if (rad.checked) {
            currentGridLayout = rad.value;
            rebuildGrid();
            saveSettings();
        }
    });
});

// Randomize Objects
const btnRandomizeObjects = document.getElementById('btn-randomize-objects');
if (btnRandomizeObjects) {
    btnRandomizeObjects.addEventListener('click', () => rebuildGrid());
}

// Randomize Color
const btnRandomizeColor = document.getElementById('btn-randomize-color');
if (btnRandomizeColor) {
    btnRandomizeColor.addEventListener('click', () => {
        const bgIdx = Math.floor(Math.random() * paletteColors.length);
        const bgCol = paletteColors[bgIdx];
        container.style.backgroundColor = bgCol.hex;
        renderer.setClearColor(new THREE.Color(bgCol.hex), 1.0);

        strokePaletteColors = paletteColors.filter((_, i) => i !== bgIdx);

        for (const animator of animators) {
            if (!animator.colorBase) continue;
            const idxs = [];
            while (idxs.length < Math.min(4, strokePaletteColors.length)) {
                const r = Math.floor(Math.random() * strokePaletteColors.length);
                if (!idxs.includes(r)) idxs.push(r);
            }
            while (idxs.length < 4) idxs.push(0);

            const colorBase = new THREE.Color().fromArray(strokePaletteColors[idxs[0]].rgb);
            const colorX    = new THREE.Color().fromArray(strokePaletteColors[idxs[1]].rgb);
            const colorY    = new THREE.Color().fromArray(strokePaletteColors[idxs[2]].rgb);
            const colorZ    = new THREE.Color().fromArray(strokePaletteColors[idxs[3]].rgb);

            animator.colorBase.copy(colorBase);
            animator.colorX.copy(colorX);
            animator.colorY.copy(colorY);
            animator.colorZ.copy(colorZ);

            if (animator.mesh?.material?.uniforms) {
                const u = animator.mesh.material.uniforms;
                u.uColorBase.value.copy(colorBase);
                u.uColorX.value.copy(colorX);
                u.uColorY.value.copy(colorY);
                u.uColorZ.value.copy(colorZ);
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
        link.download = 'primitives_gallery.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
}

// Video Recording
const btnRecordVideo = document.getElementById('btn-record-video');
if (btnRecordVideo) {
    btnRecordVideo.addEventListener('click', () => {
        if (btnRecordVideo.classList.contains('recording')) return;

        const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
        const selectedType = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
        if (!selectedType) { alert('MediaRecorder not supported in this browser.'); return; }

        const chunks = [];
        const recorder = new MediaRecorder(canvas.captureStream(60), {
            mimeType: selectedType, videoBitsPerSecond: 25000000
        });

        recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
            const url  = URL.createObjectURL(new Blob(chunks, { type: selectedType }));
            const link = document.createElement('a');
            link.download = 'primitives_gallery.webm';
            link.href = url;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 100);
            btnRecordVideo.classList.remove('recording');
            btnRecordVideo.textContent = 'Record Video (16sec)';
        };

        recorder.start();
        btnRecordVideo.classList.add('recording');

        let timeLeft = 16;
        btnRecordVideo.textContent = `Recording... (${timeLeft}s)`;
        const countdown = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) clearInterval(countdown);
            else btnRecordVideo.textContent = `Recording... (${timeLeft}s)`;
        }, 1000);

        setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 16000);
    });
}
