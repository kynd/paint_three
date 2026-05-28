import * as THREE from 'three';
import { buildCapGeometry } from '../helpers/capGeometry.js';

const NOISE_GLSL = `
    float hash3(vec3 p) {
        p = fract(p * vec3(443.8975, 397.2973, 491.1871));
        p += dot(p.xyz, p.yzx + 19.19);
        return fract(p.x * p.y * p.z);
    }

    float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        vec3 i_pos = i + vec3(100.0);
        return mix(
            mix(
                mix(hash3(i_pos + vec3(0.0,0.0,0.0)), hash3(i_pos + vec3(1.0,0.0,0.0)), u.x),
                mix(hash3(i_pos + vec3(0.0,1.0,0.0)), hash3(i_pos + vec3(1.0,1.0,0.0)), u.x),
                u.y
            ),
            mix(
                mix(hash3(i_pos + vec3(0.0,0.0,1.0)), hash3(i_pos + vec3(1.0,0.0,1.0)), u.x),
                mix(hash3(i_pos + vec3(0.0,1.0,1.0)), hash3(i_pos + vec3(1.0,1.0,1.0)), u.x),
                u.y
            ),
            u.z
        );
    }

    float turbulence(vec3 p, int octaves) {
        float sum = 0.0;
        float freq = 1.0;
        float amp = 1.0;
        float maxVal = 0.0;
        for (int i = 0; i < 6; i++) {
            if (i >= octaves) break;
            sum += amp * abs(noise3(p * freq) * 2.0 - 1.0);
            maxVal += amp;
            freq *= 2.0;
            amp *= 0.5;
        }
        return sum / maxVal;
    }
`;

export class ConeAnimator {
    constructor(group, strokePaletteColors, camera, paintStyle = 1) {
        this.group = group;
        this.camera = camera;

        // 4 distinct random palette colors
        const idxs = [];
        const numColors = Math.min(4, strokePaletteColors.length);
        while (idxs.length < numColors) {
            const rIdx = Math.floor(Math.random() * strokePaletteColors.length);
            if (!idxs.includes(rIdx)) idxs.push(rIdx);
        }
        while (idxs.length < 4) idxs.push(0);

        this.colorBase = new THREE.Color().fromArray(strokePaletteColors[idxs[0]].rgb);
        this.colorX    = new THREE.Color().fromArray(strokePaletteColors[idxs[1]].rgb);
        this.colorY    = new THREE.Color().fromArray(strokePaletteColors[idxs[2]].rgb);
        this.colorZ    = new THREE.Color().fromArray(strokePaletteColors[idxs[3]].rgb);

        // Random size
        const radius = 0.42 + Math.random() * 0.30;  // 0.42 – 0.72
        const height = 0.9  + Math.random() * 0.85;  // 0.9 – 1.75

        // Open-ended so side UVs are clean; DoubleSide to show inside
        const geometry = new THREE.ConeGeometry(radius, height, 64, 32, true);

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uColorBase:   { value: this.colorBase },
                uColorX:      { value: this.colorX },
                uColorY:      { value: this.colorY },
                uColorZ:      { value: this.colorZ },
                uPaintStyle:  { value: paintStyle }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;

                uniform vec3 uColorBase;
                uniform vec3 uColorX;
                uniform vec3 uColorY;
                uniform vec3 uColorZ;
                uniform int  uPaintStyle;

                ${NOISE_GLSL}

                void main() {
                    float PI = 3.141592653589793;
                    // Seamless angle around the cone circumference
                    float phi    = vUv.x * 2.0 * PI;
                    // Height: 0 = base (wide), 1 = tip (point)
                    float v_axis = vUv.y;

                    vec3 col;

                    if (uPaintStyle == 0) {
                        // Spiral: helix in noise space — phi rotates 6 extra turns base-to-tip,
                        // turning vertical stripe noise into spirals tightening toward the tip.
                        float spiral_phi = phi + v_axis * PI * 6.0;
                        vec3 p = vec3(cos(spiral_phi)*3.0+5.0, sin(spiral_phi)*3.0+5.0, v_axis*2.0+5.0);
                        float n = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        col = mix(uColorBase, uColorX, smoothstep(0.42, 0.58, n));

                    } else if (uPaintStyle == 1) {
                        // Horizontal Paint: noise bands running around the circumference
                        // (rings around the cone), two colors.
                        vec3 p = vec3(cos(phi)*1.0+5.0, sin(phi)*1.0+5.0, v_axis*6.0+5.0);
                        float n = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        col = mix(uColorBase, uColorX, smoothstep(0.42, 0.58, n));

                    } else if (uPaintStyle == 2) {
                        // Vertical Paint: 3 color zones base→middle→tip.
                        // Boundaries are area-compensated for the cone's taper:
                        // equal surface-area thirds fall at v ≈ 0.184 and v ≈ 0.423
                        // (more height near tip because tip has less circumference).
                        vec3 p = vec3(cos(phi)*6.0+5.0, sin(phi)*6.0+5.0, v_axis*1.0+5.0);
                        float noiseOff = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        float crd = v_axis + (noiseOff - 0.5)*0.175;
                        col = uColorBase;
                        col = mix(col, uColorX, smoothstep(0.16, 0.20, crd));
                        col = mix(col, uColorY, smoothstep(0.40, 0.44, crd));

                    } else if (uPaintStyle == 3) {
                        // Mix: same area-compensated vertical base as Vertical Paint,
                        // then horizontal ring noise overpaints the 4th color on top.
                        vec3 p_vert  = vec3(cos(phi)*6.0+5.0, sin(phi)*6.0+5.0, v_axis*1.0+5.0);
                        float nv_off = clamp((turbulence(p_vert, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        float crd    = v_axis + (nv_off - 0.5)*0.175;
                        col = uColorBase;
                        col = mix(col, uColorX, smoothstep(0.16, 0.20, crd));
                        col = mix(col, uColorY, smoothstep(0.40, 0.44, crd));

                        vec3 p_horiz  = vec3(cos(phi)*1.0+5.0, sin(phi)*1.0+5.0, v_axis*6.0+5.0);
                        float h_blend = smoothstep(0.42, 0.58, clamp((turbulence(p_horiz, 5) - 0.35)*2.0+0.5, 0.0, 1.0));
                        col = mix(col, uColorZ, h_blend);

                    } else {
                        // Gradient: smooth base-to-tip blend between two colors.
                        col = mix(uColorBase, uColorX, v_axis);
                    }

                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            side: THREE.DoubleSide
        });

        this.pivot = new THREE.Group();
        this.group.add(this.pivot);

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.pivot.add(this.mesh);

        // Bottom cap: rim matches the side at v_axis=0 (base colour),
        // centre projects to v_axis=1 (tip colour) — same as looking down the cone.
        const capGeo = buildCapGeometry(radius, -height / 2, 64, 8, 0.0, 1.0);
        this.capMesh = new THREE.Mesh(capGeo, this.material); // share material
        this.pivot.add(this.capMesh);

        this.rotationAxis  = new THREE.Vector3(
            Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
        ).normalize();
        this.rotationSpeed = 0.4 + Math.random() * 0.6;
    }

    update(time, dt, camera) {
        if (this.pivot) {
            this.pivot.rotateOnAxis(this.rotationAxis, this.rotationSpeed * dt);
        }
    }

    destroy() {
        if (this.mesh) {
            this.group.remove(this.mesh);
            this.mesh.geometry.dispose();
        }
        if (this.capMesh) {
            this.group.remove(this.capMesh);
            this.capMesh.geometry.dispose();
        }
        if (this.material) {
            this.material.dispose();
        }
    }
}
