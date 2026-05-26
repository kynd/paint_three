import * as THREE from 'three';
import { StrokeAnimator } from './StrokeAnimator.js';
import { StrokeDef } from '../core/StrokeDef.js';
import { StrokeRenderer } from '../renderers/StrokeRenderer.js';
import { tween } from '../helpers/easing.js';

export class LissajousAnimator extends StrokeAnimator {
    constructor(group, colorA, colorB, camera) {
        super(group, colorA, colorB);
        this.camera = camera;
        
        // Non-integer frequencies to generate continuously drifting, open 3D curves
        this.w_x = 1.0 + Math.random() * 2.0;
        this.w_y = 1.0 + Math.random() * 2.0;
        this.w_z = 1.0 + Math.random() * 2.0;
        
        // Ensure they are distinct to prevent flattening
        while (Math.abs(this.w_x - this.w_y) < 0.3) {
            this.w_y = 1.0 + Math.random() * 2.0;
        }
        while (Math.abs(this.w_z - this.w_x) < 0.3 || Math.abs(this.w_z - this.w_y) < 0.3) {
            this.w_z = 1.0 + Math.random() * 2.0;
        }
        
        // Amplitudes
        this.A_x = 0.8 + Math.random() * 0.2;
        this.A_y = 0.8 + Math.random() * 0.2;
        this.A_z = 0.8 + Math.random() * 0.2;
        
        // Infinite phase state and speed (faster movement)
        this.u_head = 0;
        this.speed = 1.5 + Math.random() * 2.0; // Speed of movement along the curve
        
        // Revert stroke length to Math.PI
        this.strokeLength = Math.PI;
        
        // Random local rotation axis and speed
        this.rotationAxis = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();
        this.rotationSpeed = (0.2 + Math.random() * 0.4) * 1.5; // Speed of rotation (rad/s) (1.5x faster)
        
        // Set random initial orientation
        this.group.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        
        this.maxWidth = 0.25 + Math.random() * 0.25; // Max width up to 0.5, wider than zigzag and spiral
        this.depthScale = 0.2 + Math.random() * 0.2; // depth range of receding trail to prevent Z-fighting
        
        this.init();
    }

    init() {
        const totalVertices = 120;
        const vertices = [];
        const normals = [];
        const widths = [];
        
        for (let i = 0; i < totalVertices; i++) {
            vertices.push(new THREE.Vector3());
            normals.push(new THREE.Vector3(0, 0, 1));
            widths.push(this.maxWidth);
        }
        
        this.strokeDef = new StrokeDef(vertices, widths, normals);
        this.renderer = new StrokeRenderer(this.strokeDef, this.group, null, this.colorA, this.colorB, 'u');
    }

    update(time, dt, camera) {
        if (this.renderer) {
            if (camera && !this.camera) {
                this.camera = camera;
            }
            
            // Rotate the group around the designated local axis over time
            this.group.rotateOnAxis(this.rotationAxis, this.rotationSpeed * dt);
            
            // 1. Advance continuous phase parameter
            this.u_head += this.speed * dt;
            const u_tail = this.u_head - this.strokeLength;
            
            // 2. Establish camera vector transformed to local coordinates
            const toCameraWorld = new THREE.Vector3(0, 0, 1);
            if (this.camera) {
                this.camera.getWorldPosition(toCameraWorld);
                const groupPos = new THREE.Vector3();
                this.group.getWorldPosition(groupPos);
                toCameraWorld.sub(groupPos).normalize();
            }
            const toCamera = toCameraWorld.clone().applyQuaternion(this.group.quaternion.clone().invert()).normalize();
            
            // 3. Evaluate vertices, tangents, and billboard normals in local space
            const totalVertices = 120;
            const vertices = [];
            const normals = [];
            const dynamicWidths = [];
            
            for (let i = 0; i < totalVertices; i++) {
                const fraction = i / (totalVertices - 1);
                const uVal = u_tail + fraction * this.strokeLength;
                
                // 3D Lissajous equations
                const x = this.A_x * Math.cos(this.w_x * uVal);
                const y = this.A_y * Math.sin(this.w_y * uVal);
                const z = this.A_z * Math.sin(this.w_z * uVal);
                
                const pos = new THREE.Vector3(x, y, z);
                
                // Receding depth offset along camera view axis to prevent Z-fighting
                const z_offset = -(1.0 - fraction) * this.depthScale;
                pos.addScaledVector(toCamera, z_offset);
                
                // Tangent vector derivative calculations
                const dx_du = -this.A_x * this.w_x * Math.sin(this.w_x * uVal);
                const dy_du = this.A_y * this.w_y * Math.cos(this.w_y * uVal);
                const dz_du = this.A_z * this.w_z * Math.cos(this.w_z * uVal);
                
                const tangent = new THREE.Vector3(dx_du, dy_du, dz_du);
                tangent.addScaledVector(toCamera, this.depthScale / this.strokeLength);
                
                if (tangent.lengthSq() < 0.0001) {
                    tangent.set(0, 1, 0);
                } else {
                    tangent.normalize();
                }
                
                const normal = StrokeRenderer.calculateBillboardNormal(tangent, toCamera);
                
                vertices.push(pos);
                normals.push(normal);
            }
            
            // 4. Calculate dynamic brush widths (waves organically between thin and very thick)
            const baseWidths = new Float32Array(totalVertices);
            for (let i = 0; i < totalVertices; i++) {
                const fraction = i / (totalVertices - 1);
                const uVal = u_tail + fraction * this.strokeLength;
                
                const wave = Math.pow(Math.sin(uVal * 2.0), 2.0);
                baseWidths[i] = this.maxWidth * (0.15 + 0.85 * wave);
            }
            
            // 5. Apply width safety check to prevent self-intersections
            const wSafe = new Float32Array(totalVertices);
            for (let i = 0; i < totalVertices; i++) {
                wSafe[i] = baseWidths[i] / 2.0;
            }
            
            for (let i = 0; i < totalVertices - 1; i++) {
                const p0 = vertices[i];
                const p1 = vertices[i + 1];
                const deltaPos = new THREE.Vector3().subVectors(p1, p0);
                const ds = deltaPos.length();
                if (ds > 0.0001) {
                    const T = deltaPos.clone().normalize();
                    const n0 = normals[i];
                    const n1 = normals[i + 1];
                    const diffN = new THREE.Vector3().subVectors(n1, n0);
                    const dot = Math.abs(diffN.dot(T));
                    if (dot > 0.0001) {
                        const localLimit = (ds / dot) * 0.9;
                        if (localLimit < wSafe[i]) wSafe[i] = localLimit;
                        if (localLimit < wSafe[i + 1]) wSafe[i + 1] = localLimit;
                    }
                }
            }
            
            for (let i = 0; i < totalVertices; i++) {
                dynamicWidths.push(Math.min(baseWidths[i], wSafe[i] * 2.0));
            }
            
            this.renderer.updatePath(vertices, normals, dynamicWidths, time);
        }
    }
}
