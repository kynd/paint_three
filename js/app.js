import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { palettes } from './helpers/palettes.js';
import { BezierAnimator } from './animators/BezierAnimator.js';
import { SpiralAnimator } from './animators/SpiralAnimator.js';
import { ZigzagAnimator } from './animators/ZigzagAnimator.js';
import { ZigzagBezierAnimator } from './animators/ZigzagBezierAnimator.js';
import { LissajousAnimator } from './animators/LissajousAnimator.js';
import { PhysicsAnimator } from './animators/PhysicsAnimator.js';
import { CubeAnimator } from './animators/CubeAnimator.js';
import { StrokeRenderer } from './renderers/StrokeRenderer.js';
import { createBrushTexture } from './helpers/textures.js';

// DOM elements
const container = document.getElementById('canvas-container');
const canvas = document.getElementById('canvas3d');

// Scene setup
const scene = new THREE.Scene();

// Camera setup
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 14.5);

// WebGL Renderer setup
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
});

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom = true;
controls.minDistance = 3;
controls.maxDistance = 25;

// Visual group
const strokesGroup = new THREE.Group();
scene.add(strokesGroup);

const animators = [];
const paletteColors = palettes.palette01;

// Background set
const bgIndex = Math.floor(Math.random() * paletteColors.length);
const bgPaletteColor = paletteColors[bgIndex];
container.style.backgroundColor = bgPaletteColor.hex;
renderer.setClearColor(new THREE.Color(bgPaletteColor.hex), 1.0);

let strokePaletteColors = paletteColors.filter((_, idx) => idx !== bgIndex);

const animatorClasses = {
    cube: CubeAnimator,
    bezier: BezierAnimator,
    spiral: SpiralAnimator,
    zigzag: ZigzagAnimator,
    zigzag_bezier: ZigzagBezierAnimator,
    lissajous: LissajousAnimator,
    physics: PhysicsAnimator
};

const selectedShapes = {
    cube: true,
    bezier: true,
    spiral: true,
    zigzag: true,
    zigzag_bezier: true,
    lissajous: true,
    physics: true
};

const checkboxIds = {
    cube: 'chk-cube',
    bezier: 'chk-bezier',
    spiral: 'chk-spiral',
    zigzag: 'chk-zigzag',
    zigzag_bezier: 'chk-zigzag-bezier',
    lissajous: 'chk-lissajous',
    physics: 'chk-physics'
};

// Texture settings & cache
const textureCache = {};
let currentTextureType = 'solid';
let currentTexture = null;
let currentTextureRepeat = 1.0;
let currentTextureThreshold = 0.0;

function getTexture(type) {
    if (type === 'solid') return null;
    if (!textureCache[type]) {
        textureCache[type] = createBrushTexture(type);
    }
    return textureCache[type];
}

const textureConfigs = {
    solid: { repeat: 1.0, threshold: 0.0 },
    dry_brush: { repeat: 6.0, threshold: 0.25 },
    charcoal: { repeat: 4.0, threshold: 0.2 },
    ink_dotted: { repeat: 8.0, threshold: 0.3 },
    hatching: { repeat: 12.0, threshold: 0.2 },
    acrylic: { repeat: 4.0, threshold: 0.25 }
};

function updateActiveTexture(type) {
    currentTextureType = type;
    currentTexture = getTexture(type);
    const config = textureConfigs[type];
    currentTextureRepeat = config.repeat;
    currentTextureThreshold = config.threshold;

    // Update StrokeRenderer static defaults for future instantiations
    StrokeRenderer.defaultTexture = currentTexture;
    StrokeRenderer.defaultTextureRepeat = currentTextureRepeat;
    StrokeRenderer.defaultTextureThreshold = currentTextureThreshold;

    // Update all active animators' renderers in real-time
    for (let animator of animators) {
        if (animator.renderer) {
            animator.renderer.updateTexture(currentTexture, currentTextureRepeat, currentTextureThreshold);
        }
    }
}

// Initial settings setup
updateActiveTexture('solid');

// Set default cap style to ragged for testing on load (matches checked in index.html)
StrokeRenderer.defaultCapStyle = 'ragged';

// Set default noise mode to null (meaning Auto) since Auto is checked by default in index.html
StrokeRenderer.defaultNoiseMode = null;

// Grid layout state
let currentGridLayout = '2x2';

const gridLayoutConfigs = {
    '2x2': { rows: 2, cols: 2, spacing: 5.2, scale: 2.0 },
    '3x3': { rows: 3, cols: 3, spacing: 3.8, scale: 1.4 },
    '4x4': { rows: 4, cols: 4, spacing: 3.0, scale: 1.0 }
};

// LocalStorage Persistence logic
const SETTINGS_KEY = 'stroke_gallery_settings';

function saveSettings() {
    const settings = {
        selectedShapes,
        currentTextureType,
        noiseMode: StrokeRenderer.defaultNoiseMode,
        capStyle: StrokeRenderer.defaultCapStyle,
        currentGridLayout
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return;
    try {
        const settings = JSON.parse(saved);
        
        // Restore shapes
        if (settings.selectedShapes) {
            Object.assign(selectedShapes, settings.selectedShapes);
            Object.entries(checkboxIds).forEach(([shapeKey, id]) => {
                const chk = document.getElementById(id);
                if (chk) {
                    chk.checked = !!selectedShapes[shapeKey];
                }
            });
        }
        
        // Restore textures
        if (settings.currentTextureType) {
            currentTextureType = settings.currentTextureType;
            const rads = document.getElementsByName('rad-texture');
            rads.forEach(rad => {
                rad.checked = (rad.value === currentTextureType);
            });
            updateActiveTexture(currentTextureType);
        }
        
        // Restore cap style
        if (settings.capStyle) {
            StrokeRenderer.defaultCapStyle = settings.capStyle;
            const rads = document.getElementsByName('rad-cap-style');
            rads.forEach(rad => {
                rad.checked = (rad.value === settings.capStyle);
            });
        }
        
        // Restore noise mode
        if (settings.noiseMode !== undefined) {
            StrokeRenderer.defaultNoiseMode = settings.noiseMode;
            const rads = document.getElementsByName('rad-noise-mode');
            const noiseValStr = settings.noiseMode === null ? 'auto' : String(settings.noiseMode);
            rads.forEach(rad => {
                rad.checked = (rad.value === noiseValStr);
            });
        }
        
        // Restore grid layout
        if (settings.currentGridLayout) {
            currentGridLayout = settings.currentGridLayout;
            const rads = document.getElementsByName('rad-grid-layout');
            rads.forEach(rad => {
                rad.checked = (rad.value === currentGridLayout);
            });
        }
    } catch (e) {
        console.error("Error loading settings from localStorage:", e);
    }
}

// Load settings from localStorage before building the initial grid
loadSettings();

function rebuildGrid() {
    // 1. Destroy existing animators
    for (let animator of animators) {
        animator.destroy();
    }
    animators.length = 0;
    
    // 2. Clear visual groups
    while (strokesGroup.children.length > 0) {
        strokesGroup.remove(strokesGroup.children[0]);
    }
    
    const activeKeys = Object.keys(animatorClasses).filter(k => selectedShapes[k]);
    if (activeKeys.length === 0) return;

    // Get configuration for the current layout
    const config = gridLayoutConfigs[currentGridLayout] || gridLayoutConfigs['2x2'];
    const rows = config.rows;
    const cols = config.cols;
    const spacing = config.spacing;
    const scale = config.scale;
    const strokeCount = rows * cols;

    const offsetX = -(cols - 1) * spacing / 2;
    const offsetY = -(rows - 1) * spacing / 2;

    // 3. Rebuild grid
    for (let i = 0; i < strokeCount; i++) {
        const idxA = Math.floor(Math.random() * strokePaletteColors.length);
        let idxB = Math.floor(Math.random() * strokePaletteColors.length);
        while (idxB === idxA) {
            idxB = Math.floor(Math.random() * strokePaletteColors.length);
        }
        
        const colorA = new THREE.Color().fromArray(strokePaletteColors[idxA].rgb);
        const colorB = new THREE.Color().fromArray(strokePaletteColors[idxB].rgb);
        
        const colIdx = i % cols;
        const rowIdx = Math.floor(i / cols);
        const posX = offsetX + colIdx * spacing;
        const posY = offsetY + (rows - 1 - rowIdx) * spacing; // flip row so 0 is top
        
        const specimenGroup = new THREE.Group();
        specimenGroup.position.set(posX, posY, 0);
        specimenGroup.scale.set(scale, scale, scale);
        strokesGroup.add(specimenGroup);
        
        const randomKey = activeKeys[Math.floor(Math.random() * activeKeys.length)];
        const AnimatorClass = animatorClasses[randomKey];
        
        const animator = new AnimatorClass(specimenGroup, colorA, colorB, camera);
        animators.push(animator);
    }
}

// Initial grid generation
rebuildGrid();

// Resize observer
function handleResize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

const resizeObserver = new ResizeObserver(() => handleResize());
resizeObserver.observe(container);
handleResize();

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const time = clock.getElapsedTime();
    
    for (let animator of animators) {
        animator.update(time, dt, camera);
    }
    controls.update();
    renderer.render(scene, camera);
}

animate();

// Save PNG handler
const btnSavePng = document.getElementById('btn-save-png');
if (btnSavePng) {
    btnSavePng.addEventListener('click', () => {
        renderer.render(scene, camera);
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = 'stroke_gallery.png';
        link.href = dataUrl;
        link.click();
    });
}

// Video Recording handler
const btnRecordVideo = document.getElementById('btn-record-video');
if (btnRecordVideo) {
    btnRecordVideo.addEventListener('click', () => {
        if (btnRecordVideo.classList.contains('recording')) return;

        const types = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4'
        ];
        let selectedType = '';
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                selectedType = type;
                break;
            }
        }

        if (!selectedType) {
            alert('MediaRecorder is not supported in this browser.');
            return;
        }

        const chunks = [];
        const stream = canvas.captureStream(60);
        const recorder = new MediaRecorder(stream, {
            mimeType: selectedType,
            videoBitsPerSecond: 25000000
        });

        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                chunks.push(e.data);
            }
        };

        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: selectedType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = 'stroke_gallery.webm';
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
        const countdownInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
            } else {
                btnRecordVideo.textContent = `Recording... (${timeLeft}s)`;
            }
        }, 1000);

        setTimeout(() => {
            if (recorder.state !== 'inactive') {
                recorder.stop();
            }
        }, 16000);
    });
}

// Randomize color
const btnRandomizeColor = document.getElementById('btn-randomize-color');
if (btnRandomizeColor) {
    btnRandomizeColor.addEventListener('click', () => {
        const bgIndex = Math.floor(Math.random() * paletteColors.length);
        const bgPaletteColor = paletteColors[bgIndex];
        container.style.backgroundColor = bgPaletteColor.hex;
        renderer.setClearColor(new THREE.Color(bgPaletteColor.hex), 1.0);
        
        strokePaletteColors = paletteColors.filter((_, idx) => idx !== bgIndex);
        
        for (let animator of animators) {
            const idxA = Math.floor(Math.random() * strokePaletteColors.length);
            let idxB = Math.floor(Math.random() * strokePaletteColors.length);
            while (idxB === idxA) {
                idxB = Math.floor(Math.random() * strokePaletteColors.length);
            }
            
            const colorA = new THREE.Color().fromArray(strokePaletteColors[idxA].rgb);
            const colorB = new THREE.Color().fromArray(strokePaletteColors[idxB].rgb);
            
            animator.colorA.copy(colorA);
            animator.colorB.copy(colorB);
            if (animator.renderer && animator.renderer.mesh) {
                animator.renderer.mesh.material.uniforms.uColorA.value.copy(colorA);
                animator.renderer.mesh.material.uniforms.uColorB.value.copy(colorB);
            }
        }
    });
}

// Settings panel toggle
const btnToggleSettings = document.getElementById('btn-toggle-settings');
const settingsPanel = document.getElementById('settings-panel');

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

// Objects Checkboxes
Object.entries(checkboxIds).forEach(([shapeKey, id]) => {
    const chk = document.getElementById(id);
    if (chk) {
        chk.addEventListener('change', (e) => {
            selectedShapes[shapeKey] = e.target.checked;
            
            const activeCount = Object.values(selectedShapes).filter(Boolean).length;
            if (activeCount === 0) {
                e.target.checked = true;
                selectedShapes[shapeKey] = true;
                alert('At least one shape must be selected.');
                return;
            }
            
            rebuildGrid();
            saveSettings();
        });
    }
});

// Textures Radio Buttons
const radTextureList = document.getElementsByName('rad-texture');
if (radTextureList) {
    radTextureList.forEach(rad => {
        rad.addEventListener('change', (e) => {
            if (e.target.checked) {
                updateActiveTexture(e.target.value);
                saveSettings();
            }
        });
    });
}

// Noise Mode Radio listener
const radNoiseModeList = document.getElementsByName('rad-noise-mode');
if (radNoiseModeList) {
    radNoiseModeList.forEach(rad => {
        rad.addEventListener('change', (e) => {
            if (e.target.checked) {
                const val = e.target.value;
                let modeVal = null;
                if (val !== 'auto') {
                    modeVal = parseInt(val, 10);
                }
                
                // Update static default for new instances
                StrokeRenderer.defaultNoiseMode = modeVal;
                
                // Update active renderers
                for (let animator of animators) {
                    if (animator.renderer) {
                        let finalMode = modeVal;
                        if (finalMode === null) {
                            // Auto-resolve: Brush U for 'u', Brush V for 'v'
                            finalMode = (animator.renderer.gradientDirection === 'u') ? 2 : 3;
                        }
                        animator.renderer.updateNoiseMode(finalMode);
                    }
                }
                saveSettings();
            }
        });
    });
}

// Randomize Objects Event Handler
const btnRandomizeObjects = document.getElementById('btn-randomize-objects');
if (btnRandomizeObjects) {
    btnRandomizeObjects.addEventListener('click', () => {
        rebuildGrid();
    });
}

// Cap Style Radio listener
const radCapStyleList = document.getElementsByName('rad-cap-style');
if (radCapStyleList) {
    radCapStyleList.forEach(rad => {
        rad.addEventListener('change', (e) => {
            if (e.target.checked) {
                const styleVal = e.target.value;
                
                // Update static default for new instances
                StrokeRenderer.defaultCapStyle = styleVal;
                
                // Update active renderers
                for (let animator of animators) {
                    if (animator.renderer) {
                        animator.renderer.updateCapStyle(styleVal);
                    }
                }
                saveSettings();
            }
        });
    });
}

// Grid Layout Radio listener
const radGridLayoutList = document.getElementsByName('rad-grid-layout');
if (radGridLayoutList) {
    radGridLayoutList.forEach(rad => {
        rad.addEventListener('change', (e) => {
            if (e.target.checked) {
                currentGridLayout = e.target.value;
                rebuildGrid();
                saveSettings();
            }
        });
    });
}
