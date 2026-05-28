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

// A tube bent along two C1-continuous cubic Bezier segments.
// UV layout (TubeGeometry): vUv.x = around cross-section (0→1), vUv.y = along path (0→1).
// The twist uniform rotates the cross-section angle as you travel along the path.
export class TwistedTubeAnimator {
    constructor(group, strokePaletteColors, camera, paintStyle = 1) {
        this.group  = group;
        this.camera = camera;

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

        const tubeRadius = 0.08 + Math.random() * 0.10; // 0.08 – 0.18
        const twistTurns = 1.0 + Math.random() * 2.0;   // 1 – 3 full axial twists

        // Two C1-continuous cubic Bezier segments.
        // C1 at the junction: q1 = 2*p3 - p2 (mirror of p2 through p3).
        const rp = () => (Math.random() - 0.5) * 1.4;
        const rz = () => (Math.random() - 0.5) * 1.0;

        const p0 = new THREE.Vector3(rp(), rp(), rz());
        const p1 = new THREE.Vector3(rp(), rp(), rz());
        const p2 = new THREE.Vector3(rp(), rp(), rz());
        const p3 = new THREE.Vector3(rp(), rp(), rz());

        const q0 = p3.clone();
        const q1 = new THREE.Vector3().addVectors(p3, p3).sub(p2);
        const q2 = new THREE.Vector3(rp(), rp(), rz());
        const q3 = new THREE.Vector3(rp(), rp(), rz());

        const path = new THREE.CurvePath();
        path.add(new THREE.CubicBezierCurve3(p0, p1, p2, p3));
        path.add(new THREE.CubicBezierCurve3(q0, q1, q2, q3));

        // Scale segment count to path length so tight bends stay smooth.
        const segments = Math.max(200, Math.ceil(path.getLength() * 80));
        const geometry = new THREE.TubeGeometry(path, segments, tubeRadius, 32, false);

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uColorBase:  { value: this.colorBase },
                uColorX:     { value: this.colorX },
                uColorY:     { value: this.colorY },
                uColorZ:     { value: this.colorZ },
                uPaintStyle: { value: paintStyle },
                uTwistTurns: { value: twistTurns }
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
                uniform float uTwistTurns;

                ${NOISE_GLSL}

                // Fold 0→1 circular coord into 0→1→0 to eliminate the seam where ends meet.
                float fold(float t) { return 1.0 - abs(t * 2.0 - 1.0); }

                void main() {
                    float PI = 3.141592653589793;
                    float phi    = vUv.x * 2.0 * PI;          // around cross-section
                    float v_axis = vUv.y;                      // along path 0→1
                    float tphi   = phi + v_axis * uTwistTurns * 2.0 * PI;
                    float fu     = fold(vUv.x); // folded cross-section coord — seamless

                    vec3 col;

                    if (uPaintStyle == 0) {
                        // Spiral: extra helical twist on top of the path's own twist.
                        float spiral_phi = tphi + v_axis * PI * 4.0;
                        vec3 p = vec3(cos(spiral_phi)*3.0+5.0, sin(spiral_phi)*3.0+5.0, v_axis*2.0+5.0);
                        float n = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        col = mix(uColorBase, uColorX, smoothstep(0.42, 0.58, n));

                    } else if (uPaintStyle == 1) {
                        // Horizontal Paint: noise bands ringing the tube.
                        vec3 p = vec3(cos(tphi)*1.0+5.0, sin(tphi)*1.0+5.0, v_axis*6.0+5.0);
                        float n = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        col = mix(uColorBase, uColorX, smoothstep(0.42, 0.58, n));

                    } else if (uPaintStyle == 2) {
                        // Vertical Paint: 3 colour zones from start to end of the tube.
                        vec3 p = vec3(cos(tphi)*6.0+5.0, sin(tphi)*6.0+5.0, v_axis*1.0+5.0);
                        float noiseOff = clamp((turbulence(p, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        float crd = v_axis + (noiseOff - 0.5)*0.175;
                        col = uColorBase;
                        col = mix(col, uColorX, smoothstep(0.36, 0.40, crd));
                        col = mix(col, uColorY, smoothstep(0.60, 0.64, crd));

                    } else if (uPaintStyle == 3) {
                        // Mix: 3-zone longitudinal base, then ring-band noise overpaints 4th colour.
                        vec3 p_vert  = vec3(cos(tphi)*6.0+5.0, sin(tphi)*6.0+5.0, v_axis*1.0+5.0);
                        float nv_off = clamp((turbulence(p_vert, 5) - 0.35)*2.0+0.5, 0.0, 1.0);
                        float crd    = v_axis + (nv_off - 0.5)*0.175;
                        col = uColorBase;
                        col = mix(col, uColorX, smoothstep(0.36, 0.40, crd));
                        col = mix(col, uColorY, smoothstep(0.60, 0.64, crd));

                        vec3 p_horiz  = vec3(cos(tphi)*1.0+5.0, sin(tphi)*1.0+5.0, v_axis*6.0+5.0);
                        float h_blend = smoothstep(0.42, 0.58, clamp((turbulence(p_horiz, 5) - 0.35)*2.0+0.5, 0.0, 1.0));
                        col = mix(col, uColorZ, h_blend);

                    } else {
                        // Gradient: folds across the cross-section (0→colorX→0), seam-free.
                        col = mix(uColorBase, uColorX, fu);
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

        // Solid-colour end caps — orient each disc perpendicular to the path tangent.
        const capMat = new THREE.MeshBasicMaterial({ color: this.colorBase, side: THREE.DoubleSide });
        const capGeo = new THREE.CircleGeometry(tubeRadius, 32);
        const zAxis  = new THREE.Vector3(0, 0, 1);

        this.capStartMesh = new THREE.Mesh(capGeo, capMat);
        this.capStartMesh.position.copy(path.getPoint(0));
        this.capStartMesh.quaternion.setFromUnitVectors(zAxis, path.getTangentAt(0).normalize());
        this.pivot.add(this.capStartMesh);

        this.capEndMesh = new THREE.Mesh(capGeo.clone(), capMat.clone());
        this.capEndMesh.position.copy(path.getPoint(1));
        this.capEndMesh.quaternion.setFromUnitVectors(zAxis, path.getTangentAt(1).normalize());
        this.pivot.add(this.capEndMesh);

        this.rotationAxis  = new THREE.Vector3(
            Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
        ).normalize();
        this.rotationSpeed = 0.4 + Math.random() * 0.6;
    }

    update(time, dt) {
        if (this.pivot) this.pivot.rotateOnAxis(this.rotationAxis, this.rotationSpeed * dt);
    }

    destroy() {
        if (this.mesh) {
            this.pivot.remove(this.mesh);
            this.mesh.geometry.dispose();
        }
        if (this.capStartMesh) {
            this.pivot.remove(this.capStartMesh);
            this.capStartMesh.geometry.dispose();
            this.capStartMesh.material.dispose();
        }
        if (this.capEndMesh) {
            this.pivot.remove(this.capEndMesh);
            this.capEndMesh.geometry.dispose();
            this.capEndMesh.material.dispose();
        }
        if (this.material) this.material.dispose();
        if (this.pivot) this.group.remove(this.pivot);
    }
}
