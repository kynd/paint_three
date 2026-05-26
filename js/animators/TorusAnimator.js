import * as THREE from 'three';

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

export class TorusAnimator {
    constructor(group, strokePaletteColors, camera, paintStyle = 1) {
        this.group  = group;
        this.camera = camera;

        // 4 distinct random palette colours
        const idxs = [];
        const numColors = Math.min(4, strokePaletteColors.length);
        while (idxs.length < numColors) {
            const r = Math.floor(Math.random() * strokePaletteColors.length);
            if (!idxs.includes(r)) idxs.push(r);
        }
        while (idxs.length < 4) idxs.push(0);

        this.colorBase = new THREE.Color().fromArray(strokePaletteColors[idxs[0]].rgb);
        this.colorX    = new THREE.Color().fromArray(strokePaletteColors[idxs[1]].rgb);
        this.colorY    = new THREE.Color().fromArray(strokePaletteColors[idxs[2]].rgb);
        this.colorZ    = new THREE.Color().fromArray(strokePaletteColors[idxs[3]].rgb);

        // Random size
        const majorR = 0.38 + Math.random() * 0.27;  // 0.38 – 0.65
        const tubeR  = 0.12 + Math.random() * 0.16;  // 0.12 – 0.28

        // TorusGeometry UV:
        //   uv.x (u) → poloidal  (around the tube cross-section, 0→1)
        //   uv.y (v) → toroidal  (around the big ring,           0→1)
        const geometry = new THREE.TorusGeometry(majorR, tubeR, 24, 96);

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uColorBase:  { value: this.colorBase },
                uColorX:     { value: this.colorX },
                uColorY:     { value: this.colorY },
                uColorZ:     { value: this.colorZ },
                uPaintStyle: { value: paintStyle }
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
                    float phi_pol = vUv.x * 2.0 * PI; // angle around tube cross-section
                    float phi_tor = vUv.y * 2.0 * PI; // angle around the big ring

                    vec3 col;

                    if (uPaintStyle == 0) {
                        // Spiral: toroidal phi is twisted by the poloidal position —
                        // creates a helix that winds around the ring, like a torus knot pattern.
                        float spiral_phi = phi_tor + phi_pol * 3.0;
                        vec3 p = vec3(cos(spiral_phi)*3.0+5.0, sin(spiral_phi)*3.0+5.0, vUv.x*2.0+5.0);
                        float n = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        col = mix(uColorBase, uColorX, smoothstep(0.42, 0.58, n));

                    } else if (uPaintStyle == 1) {
                        // Horizontal Paint: stripes that band around the hole (toroidal bands).
                        // Noise varies quickly in the toroidal direction (vUv.y*6) and slowly
                        // around the tube cross-section (cos/sin phi_pol * 1).
                        vec3 p = vec3(cos(phi_pol)*1.0+5.0, sin(phi_pol)*1.0+5.0, vUv.y*6.0+5.0);
                        float n = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        col = mix(uColorBase, uColorX, smoothstep(0.42, 0.58, n));

                    } else if (uPaintStyle == 2) {
                        // Vertical Paint: 3 colour zones going around the big ring (toroidal axis),
                        // with boundaries that shift around the tube cross-section (poloidal noise).
                        vec3 p = vec3(cos(phi_pol)*6.0+5.0, sin(phi_pol)*6.0+5.0, vUv.y*1.0+5.0);
                        float noiseOff = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        float crd = vUv.y + (noiseOff - 0.5)*0.175;
                        col = uColorBase;
                        col = mix(col, uColorX, smoothstep(0.36, 0.40, crd));
                        col = mix(col, uColorY, smoothstep(0.60, 0.64, crd));

                    } else {
                        // Mix: toroidal 3-zone base, then toroidal-band noise overpaints 4th colour.
                        vec3 p_vert  = vec3(cos(phi_pol)*6.0+5.0, sin(phi_pol)*6.0+5.0, vUv.y*1.0+5.0);
                        float nv_off = clamp((turbulence(p_vert, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        float crd    = vUv.y + (nv_off - 0.5)*0.175;
                        col = uColorBase;
                        col = mix(col, uColorX, smoothstep(0.36, 0.40, crd));
                        col = mix(col, uColorY, smoothstep(0.60, 0.64, crd));

                        vec3 p_horiz  = vec3(cos(phi_pol)*1.0+5.0, sin(phi_pol)*1.0+5.0, vUv.y*6.0+5.0);
                        float h_blend = smoothstep(0.42, 0.58, clamp((turbulence(p_horiz, 5) - 0.35)*2.0+0.5, 0.0, 1.0));
                        col = mix(col, uColorZ, h_blend);
                    }

                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.group.add(this.mesh);

        this.rotationAxis  = new THREE.Vector3(
            Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
        ).normalize();
        this.rotationSpeed = 0.4 + Math.random() * 0.6;
    }

    update(time, dt, camera) {
        if (this.mesh) this.mesh.rotateOnAxis(this.rotationAxis, this.rotationSpeed * dt);
    }

    destroy() {
        if (this.mesh) {
            this.group.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
    }
}
