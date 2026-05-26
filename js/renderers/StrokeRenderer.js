import * as THREE from 'three';

export class StrokeRenderer {
    // Static fields for default/fallback texture and noise settings
    static defaultTexture = null;
    static defaultTextureRepeat = 1.0;
    static defaultTextureThreshold = 0.0;
    
    static defaultNoiseScale = 4.0;
    static defaultNoiseOctaves = 4;
    static defaultNoiseSpeed = 0.6;
    static defaultNoiseMode = null;
    
    static defaultCapStyle = 'rounded';
    
    // Static dummy texture to avoid empty/null texture warnings in WebGL
    static dummyTexture = (function() {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1, 1);
        const tex = new THREE.CanvasTexture(canvas);
        return tex;
    })();

    /**
     * @param {StrokeDef} strokeDef - The stroke definition to render
     * @param {THREE.Scene|THREE.Group} scene - The parent container
     * @param {boolean} isRounded - Whether to render with rounded ends
     * @param {THREE.Color} colorA - Color at one side of the width (V=0)
     * @param {THREE.Color} colorB - Color at the other side of the width (V=1)
     * @param {string} gradientDirection - 'u' (longitudinal) or 'v' (orthogonal)
     * @param {THREE.Texture} texture - Dynamic brush texture
     * @param {number} textureRepeat - Texture repeat factor along U (length)
     * @param {number} textureThreshold - Alpha/value threshold for discard test
     * @param {number} noiseScale - Spatial scale for procedural turbulence noise
     * @param {number} noiseOctaves - Number of fractal octaves for turbulence noise
     * @param {number} noiseSpeed - Flow speed of turbulence noise animation
     * @param {number} noiseMode - Noise mode selector: 0=Off, 1=Raw Noise, 2=Brush U, 3=Brush V
     */
    constructor(strokeDef, scene, capStyleOrIsRounded = null, colorA = new THREE.Color('#ff0000'), colorB = new THREE.Color('#0000ff'), gradientDirection = 'v', texture = null, textureRepeat = null, textureThreshold = null, noiseScale = null, noiseOctaves = null, noiseSpeed = null, noiseMode = null, isRagged = false) {
        this.strokeDef = strokeDef;
        this.scene = scene;
        this.colorA = colorA;
        this.colorB = colorB;
        this.gradientDirection = gradientDirection;
        
        // Resolve active cap style: use string directly, map boolean, or fallback to defaultCapStyle
        let activeCapStyle = StrokeRenderer.defaultCapStyle;
        if (typeof capStyleOrIsRounded === 'string') {
            activeCapStyle = capStyleOrIsRounded;
        } else if (capStyleOrIsRounded === true) {
            activeCapStyle = 'rounded';
        } else if (capStyleOrIsRounded === false) {
            activeCapStyle = 'square';
        } else if (isRagged) {
            activeCapStyle = 'ragged';
        }
        
        this.isRounded = (activeCapStyle === 'rounded');
        this.isRagged = (activeCapStyle === 'ragged');
        
        // Use arguments if specified, else fall back to static defaults
        this.texture = texture !== null ? texture : StrokeRenderer.defaultTexture;
        this.textureRepeat = textureRepeat !== null ? textureRepeat : (StrokeRenderer.defaultTextureRepeat !== undefined ? StrokeRenderer.defaultTextureRepeat : 1.0);
        this.textureThreshold = textureThreshold !== null ? textureThreshold : (StrokeRenderer.defaultTextureThreshold !== undefined ? StrokeRenderer.defaultTextureThreshold : 0.0);
        
        this.noiseScale = noiseScale !== null ? noiseScale : (StrokeRenderer.defaultNoiseScale !== undefined ? StrokeRenderer.defaultNoiseScale : 4.0);
        this.noiseOctaves = noiseOctaves !== null ? noiseOctaves : (StrokeRenderer.defaultNoiseOctaves !== undefined ? StrokeRenderer.defaultNoiseOctaves : 3);
        this.noiseSpeed = noiseSpeed !== null ? noiseSpeed : (StrokeRenderer.defaultNoiseSpeed !== undefined ? StrokeRenderer.defaultNoiseSpeed : 0.6);
        
        const resolvedNoiseMode = noiseMode !== null ? noiseMode : StrokeRenderer.defaultNoiseMode;
        if (resolvedNoiseMode !== null) {
            this.noiseMode = resolvedNoiseMode;
        } else {
            // Default to matching U or V brush modes
            this.noiseMode = (this.gradientDirection === 'u') ? 2 : 3;
        }

        this.mesh = null;
        this.buildGeometry();
    }

    buildGeometry() {
        const vertices = this.strokeDef.vertices;
        const widths = this.strokeDef.widths;
        const normals = this.strokeDef.normals || [];

        if (vertices.length < 2) return;

        // 1. Calculate path length
        let totalLength = 0;
        for (let i = 0; i < vertices.length - 1; i++) {
            totalLength += vertices[i].distanceTo(vertices[i + 1]);
        }

        // 2. Grid density: Allocate more vertices to ensure curves are extremely smooth
        const segmentsLength = Math.max(160, Math.round(totalLength * 120));
        const segmentsWidth = 8; // Orthogonal density

        // Create standard unit plane geometry.
        const geometry = new THREE.PlaneGeometry(1, 1, segmentsLength, segmentsWidth);

        // 3. Prepare path buffers for shader uniforms
        const maxPoints = 200;
        const pathArray = [];
        const widthArray = new Float32Array(maxPoints);
        const normalArray = [];

        const pathLength = Math.min(vertices.length, maxPoints);
        for (let i = 0; i < maxPoints; i++) {
            if (i < pathLength) {
                pathArray.push(vertices[i].clone());
                widthArray[i] = widths[i];
                if (normals[i]) {
                    normalArray.push(normals[i].clone());
                } else {
                    normalArray.push(new THREE.Vector3(0, 1, 0));
                }
            } else {
                pathArray.push(new THREE.Vector3());
                widthArray[i] = 0;
                normalArray.push(new THREE.Vector3(0, 1, 0));
            }
        }

        // 4. Calculate capsule/ragged end-caps ratio in normalized U-space (0 to 1)
        const capFactor = this.isRagged ? 0.8 : (this.isRounded ? 0.5 : 0.0);
        const uCapStart = (this.isRounded || this.isRagged) ? (widths[0] * capFactor) / totalLength : 0.0;
        const uCapEnd = (this.isRounded || this.isRagged) ? (widths[widths.length - 1] * capFactor) / totalLength : 0.0;

        // Custom Shader Material for screen-facing billboarding and gradient shading
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uPath: { value: pathArray },
                uNormal: { value: normalArray },
                uWidth: { value: widthArray },
                uPathLength: { value: pathLength },
                uCapStart: { value: uCapStart },
                uCapEnd: { value: uCapEnd },
                uRounded: { value: this.isRounded },
                uRagged: { value: this.isRagged },
                uColorA: { value: this.colorA },
                uColorB: { value: this.colorB },
                uUseUGradient: { value: this.gradientDirection === 'u' },
                uTexture: { value: this.texture || StrokeRenderer.dummyTexture },
                uUseTexture: { value: !!this.texture },
                uTextureRepeat: { value: this.textureRepeat },
                uTextureThreshold: { value: this.textureThreshold },
                uTime: { value: 0.0 },
                uNoiseMode: { value: this.noiseMode },
                uNoiseOctaves: { value: this.noiseOctaves },
                uNoiseScale: { value: this.noiseScale },
                uNoiseSpeed: { value: this.noiseSpeed }
            },
            vertexShader: this.getVertexShader(),
            fragmentShader: this.getFragmentShader(),
            side: THREE.DoubleSide,
            transparent: false,
            depthWrite: true,
            depthTest: true
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.mesh);
    }

    /**
     * Dynamically updates the path vertices and normals on the GPU
     * @param {THREE.Vector3[]} vertices 
     * @param {THREE.Vector3[]} [normals]
     * @param {number[]} [widths]
     * @param {number} [time=null]
     */
    updatePath(vertices, normals, widths, time = null) {
        if (!this.mesh) return;
        
        if (time !== null) {
            this.mesh.material.uniforms.uTime.value = time;
        }
        const maxPoints = 200;
        const pathLength = Math.min(vertices.length, maxPoints);
        const pathArray = this.mesh.material.uniforms.uPath.value;
        const normalArray = this.mesh.material.uniforms.uNormal.value;
        const widthArray = this.mesh.material.uniforms.uWidth.value;
        
        let widthChanged = false;
        for (let i = 0; i < pathLength; i++) {
            pathArray[i].copy(vertices[i]);
            if (normals && normals[i]) {
                normalArray[i].copy(normals[i]);
            }
            if (widths && widths[i] !== undefined) {
                if (widthArray[i] !== widths[i]) {
                    widthArray[i] = widths[i];
                    widthChanged = true;
                }
            }
        }
        this.mesh.material.uniforms.uPathLength.value = pathLength;
        
        if (widthChanged) {
            // Re-assign a slice of the Float32Array to force Three.js to re-upload uniform values
            this.mesh.material.uniforms.uWidth.value = widthArray.slice();
        }

        if (this.isRounded || this.isRagged) {
            let currentLength = 0;
            for (let i = 0; i < pathLength - 1; i++) {
                currentLength += vertices[i].distanceTo(vertices[i + 1]);
            }
            if (currentLength > 0.0001) {
                const wStart = widths && widths[0] !== undefined ? widths[0] : widthArray[0];
                const wEnd = widths && widths[pathLength - 1] !== undefined ? widths[pathLength - 1] : widthArray[pathLength - 1];
                const capFactor = this.isRagged ? 0.8 : 0.5;
                this.mesh.material.uniforms.uCapStart.value = (wStart * capFactor) / currentLength;
                this.mesh.material.uniforms.uCapEnd.value = (wEnd * capFactor) / currentLength;
            } else {
                this.mesh.material.uniforms.uCapStart.value = 0.0;
                this.mesh.material.uniforms.uCapEnd.value = 0.0;
            }
        }
    }

    getVertexShader() {
        return `
            uniform vec3 uPath[200];
            uniform vec3 uNormal[200];
            uniform float uWidth[200];
            uniform int uPathLength;
            
            varying vec2 vUv;
 
            void main() {
                vUv = uv;
                
                // Map uv.x (0.0 to 1.0) along the curve path length
                float u = uv.x;
                // Map uv.y (0.0 to 1.0) to centered width offset (-0.5 to 0.5)
                float v = uv.y - 0.5;

                // Linearly interpolate position & width along path points
                float indexFloat = u * float(uPathLength - 1);
                int index = int(floor(indexFloat));
                int nextIndex = min(index + 1, uPathLength - 1);
                float weight = indexFloat - float(index);

                vec3 p0 = uPath[index];
                vec3 p1 = uPath[nextIndex];
                vec3 positionOnCurve = mix(p0, p1, weight);

                float w0 = uWidth[index];
                float w1 = uWidth[nextIndex];
                float strokeWidth = mix(w0, w1, weight);

                // Interpolate normals from JS side
                vec3 n0 = uNormal[index];
                vec3 n1 = uNormal[nextIndex];
                vec3 normal = normalize(mix(n0, n1, weight));

                // Extrude directly along the JS-supplied normal direction
                vec3 displacedPosition = positionOnCurve + normal * v * strokeWidth;

                gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
            }
        `;
    }

    getFragmentShader() {
        return `
            varying vec2 vUv;
            
            uniform float uCapStart;
            uniform float uCapEnd;
            uniform bool uRounded;
            uniform bool uRagged;
            uniform vec3 uColorA;
            uniform vec3 uColorB;
            uniform bool uUseUGradient;
            
            uniform sampler2D uTexture;
            uniform bool uUseTexture;
            uniform float uTextureRepeat;
            uniform float uTextureThreshold;
            
            uniform float uTime;
            uniform int uNoiseMode;
            uniform int uNoiseOctaves;
            uniform float uNoiseScale;
            uniform float uNoiseSpeed;

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
                
                return mix(
                    mix(
                        mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), u.x),
                        mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x),
                        u.y
                    ),
                    mix(
                        mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x),
                        mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x),
                        u.y
                    ),
                    u.z
                );
            }

            // Turbulence noise (sum of absolute values of octaves)
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

            // Vector noise: evaluates offset turbulence values to produce a colored 3D vector
            vec3 noise(vec3 crd, int octaves, float scale) {
                vec3 p = crd * scale;
                float r = turbulence(p, octaves);
                float g = turbulence(p + vec3(17.43, 34.19, 9.87), octaves);
                float b = turbulence(p + vec3(49.21, 9.13, 83.51), octaves);
                return vec3(r, g, b);
            }

            void main() {
                if (uRounded) {
                    // Check start cap boundary
                    if (vUv.x < uCapStart && uCapStart > 0.0001) {
                        float dx = (vUv.x - uCapStart) / uCapStart;
                        float dy = (vUv.y - 0.5) / 0.5;
                        if (dx * dx + dy * dy > 1.0) {
                            discard;
                        }
                    }
                    // Check end cap boundary
                    else if (vUv.x > 1.0 - uCapEnd && uCapEnd > 0.0001) {
                        float dx = (vUv.x - (1.0 - uCapEnd)) / uCapEnd;
                        float dy = (vUv.y - 0.5) / 0.5;
                        if (dx * dx + dy * dy > 1.0) {
                            discard;
                        }
                    }
                } else if (uRagged) {
                    // Check start cap ragged paint bristles boundary
                    if (vUv.x < uCapStart && uCapStart > 0.0001) {
                        float capProgress = vUv.x / uCapStart;
                        float noiseVal = hash3(vec3(vUv.y * 120.0, 0.0, 0.0));
                        float bristleLimit = 0.45 + 0.35 * sin(vUv.y * 75.0) + 0.1 * cos(vUv.y * 28.0) + 0.1 * noiseVal;
                        float edgeDamp = sin(vUv.y * 3.14159);
                        if (capProgress < bristleLimit * edgeDamp) {
                            discard;
                        }
                    }
                    // Check end cap ragged paint bristles boundary
                    else if (vUv.x > 1.0 - uCapEnd && uCapEnd > 0.0001) {
                        float capProgress = (1.0 - vUv.x) / uCapEnd;
                        float noiseVal = hash3(vec3(vUv.y * 120.0, 1.0, 0.0));
                        float bristleLimit = 0.45 + 0.35 * sin(vUv.y * 75.0) + 0.1 * cos(vUv.y * 28.0) + 0.1 * noiseVal;
                        float edgeDamp = sin(vUv.y * 3.14159);
                        if (capProgress < bristleLimit * edgeDamp) {
                            discard;
                        }
                    }
                }

                float blend = uUseUGradient ? vUv.x : vUv.y;
                
                vec3 finalColor;
                if (uNoiseMode > 0) {
                    vec3 crd = vec3(vUv.x * 2.0, vUv.y, uTime * uNoiseSpeed);
                    vec3 noiseVal = noise(crd, uNoiseOctaves, uNoiseScale);
                    
                    if (uNoiseMode == 1) {
                        // Raw Noise Color output directly
                        finalColor = noiseVal;
                    } else if (uNoiseMode == 2) {
                        // Brush U: blend colors along U, but perturbed by noise (normalized to -0.5 to 0.5)
                        float u_perturbed = clamp(vUv.x + (noiseVal.r - 0.5), 0.0, 1.0);
                        finalColor = mix(uColorA, uColorB, u_perturbed);
                    } else if (uNoiseMode == 3) {
                        // Brush V: blend colors along V, but perturbed by noise (normalized to -0.5 to 0.5)
                        float v_perturbed = clamp(vUv.y + (noiseVal.r - 0.5), 0.0, 1.0);
                        finalColor = mix(uColorA, uColorB, v_perturbed);
                    }
                } else {
                    finalColor = mix(uColorA, uColorB, blend);
                }
                
                if (uUseTexture) {
                    vec4 texColor = texture2D(uTexture, vec2(vUv.x * uTextureRepeat, vUv.y));
                    if (texColor.r < uTextureThreshold) {
                        discard;
                    }
                    finalColor *= texColor.rgb;
                }
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;
    }

    /**
     * Helper to compute a camera-facing billboard normal vector
     * perpendicular to the camera view direction, where the tangent
     * is first projected (flattened) to the camera plane.
     * @param {THREE.Vector3} tangent 
     * @param {THREE.Vector3} toCamera 
     * @returns {THREE.Vector3}
     */
    static calculateBillboardNormal(tangent, toCamera) {
        const projectedTangent = tangent.clone();
        const dot = projectedTangent.dot(toCamera);
        projectedTangent.addScaledVector(toCamera, -dot);
        if (projectedTangent.lengthSq() > 1e-6) {
            projectedTangent.normalize();
        } else {
            projectedTangent.copy(tangent);
        }
        return new THREE.Vector3().crossVectors(projectedTangent, toCamera).normalize();
    }

    updateTexture(texture, repeat, threshold) {
        this.texture = texture;
        this.textureRepeat = repeat;
        this.textureThreshold = threshold;
        
        if (this.mesh && this.mesh.material) {
            this.mesh.material.uniforms.uTexture.value = texture || StrokeRenderer.dummyTexture;
            this.mesh.material.uniforms.uUseTexture.value = !!texture;
            this.mesh.material.uniforms.uTextureRepeat.value = repeat;
            this.mesh.material.uniforms.uTextureThreshold.value = threshold;
        }
    }

    updateNoiseMode(mode) {
        this.noiseMode = mode;
        if (this.mesh && this.mesh.material) {
            this.mesh.material.uniforms.uNoiseMode.value = mode;
        }
    }

    updateCapStyle(style) {
        this.isRounded = (style === 'rounded');
        this.isRagged = (style === 'ragged');
        
        if (this.mesh && this.mesh.material) {
            this.mesh.material.uniforms.uRounded.value = this.isRounded;
            this.mesh.material.uniforms.uRagged.value = this.isRagged;
            
            const pathLength = this.mesh.material.uniforms.uPathLength.value;
            const pathArray = this.mesh.material.uniforms.uPath.value;
            const widthArray = this.mesh.material.uniforms.uWidth.value;
            
            let currentLength = 0;
            for (let i = 0; i < pathLength - 1; i++) {
                currentLength += pathArray[i].distanceTo(pathArray[i + 1]);
            }
            if (currentLength > 0.0001) {
                const capFactor = this.isRagged ? 0.8 : (this.isRounded ? 0.5 : 0.0);
                this.mesh.material.uniforms.uCapStart.value = (widthArray[0] * capFactor) / currentLength;
                this.mesh.material.uniforms.uCapEnd.value = (widthArray[pathLength - 1] * capFactor) / currentLength;
            } else {
                this.mesh.material.uniforms.uCapStart.value = 0.0;
                this.mesh.material.uniforms.uCapEnd.value = 0.0;
            }
        }
    }

    destroy() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
    }
}
