import * as THREE from 'three';

export class SphereAnimator {
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

        // Randomize radius
        this.radius = 0.50 + Math.random() * 0.45; // 0.50 – 0.95

        const geometry = new THREE.IcosahedronGeometry(this.radius, 6);

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uColorBase:  { value: this.colorBase },
                uColorX:     { value: this.colorX },
                uColorY:     { value: this.colorY },
                uColorZ:     { value: this.colorZ },
                uPaintStyle: { value: paintStyle }
            },
            vertexShader: `
                varying vec3 vLocalPosition;
                void main() {
                    vLocalPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vLocalPosition;

                uniform vec3 uColorBase;
                uniform vec3 uColorX;
                uniform vec3 uColorY;
                uniform vec3 uColorZ;
                uniform int  uPaintStyle;

                // Hash function for 3D noise
                float hash3(vec3 p) {
                    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
                    p += dot(p.xyz, p.yzx + 19.19);
                    return fract(p.x * p.y * p.z);
                }

                // 3D Value Noise with Hermite interpolation
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

                // Turbulence noise (sum of absolute value octaves)
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

                void main() {
                    float PI = 3.141592653589793;

                    // Custom spherical UV — seamless, no discontinuity from atan
                    vec3 pos = normalize(vLocalPosition);
                    float phi      = atan(pos.z, pos.x);
                    float u_sphere = (phi + PI) / (2.0 * PI);
                    float theta    = acos(pos.y);
                    float v_sphere = theta / PI;

                    float phi_wrapped   = u_sphere * 2.0 * PI;
                    float theta_wrapped = v_sphere * PI;

                    vec3 col;

                    if (uPaintStyle == 0) {
                        // Spiral: helix in noise space — phi rotates 6 extra turns N to S,
                        // turning vertical stripe noise into spirals around the sphere.
                        float spiral_phi = phi_wrapped + v_sphere * PI * 6.0;
                        vec3 p = vec3(cos(spiral_phi)*3.0+5.0, sin(spiral_phi)*3.0+5.0, v_sphere*2.0+5.0);
                        float n = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        col = mix(uColorBase, uColorX, smoothstep(0.42, 0.58, n));

                    } else if (uPaintStyle == 1) {
                        // Horizontal Paint: 5-octave turbulence stretched along latitude bands,
                        // mixed between two palette colors.
                        vec3 p = vec3(cos(phi_wrapped)*1.0+5.0, sin(phi_wrapped)*1.0+5.0, theta_wrapped*6.0+5.0);
                        float n = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        col = mix(uColorBase, uColorX, smoothstep(0.42, 0.58, n));

                    } else if (uPaintStyle == 2) {
                        // Vertical Paint: 3-color zones N→equator→S, boundaries perturbed by
                        // noise that varies along longitude, giving ragged vertical strokes.
                        vec3 p = vec3(cos(phi_wrapped)*6.0+5.0, sin(phi_wrapped)*6.0+5.0, theta_wrapped*1.0+5.0);
                        float noiseOff = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        float crd = v_sphere + (noiseOff - 0.5)*0.175;
                        col = uColorBase;
                        col = mix(col, uColorX, smoothstep(0.36, 0.40, crd));
                        col = mix(col, uColorY, smoothstep(0.60, 0.64, crd));

                    } else if (uPaintStyle == 3) {
                        // Mix: vertical zones (N/equator/S) as base, then horizontal noise
                        // overpaints the 4th color on top of everything.
                        vec3 p_vert  = vec3(cos(phi_wrapped)*6.0+5.0, sin(phi_wrapped)*6.0+5.0, theta_wrapped*1.0+5.0);
                        float nv_off = clamp((turbulence(p_vert, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        float crd    = v_sphere + (nv_off - 0.5)*0.175;
                        col = uColorBase;
                        col = mix(col, uColorX, smoothstep(0.36, 0.40, crd));
                        col = mix(col, uColorY, smoothstep(0.60, 0.64, crd));

                        vec3 p_horiz  = vec3(cos(phi_wrapped)*1.0+5.0, sin(phi_wrapped)*1.0+5.0, theta_wrapped*6.0+5.0);
                        float h_blend = smoothstep(0.42, 0.58, clamp((turbulence(p_horiz, 5) - 0.35)*2.0+0.5, 0.0, 1.0));
                        col = mix(col, uColorZ, h_blend);

                    } else {
                        // Gradient: smooth pole-to-pole blend between two colors.
                        col = mix(uColorBase, uColorX, v_sphere);
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
        if (this.mesh) {
            this.mesh.rotateOnAxis(this.rotationAxis, this.rotationSpeed * dt);
        }
    }

    destroy() {
        if (this.mesh) {
            this.group.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
    }
}
