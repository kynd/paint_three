import * as THREE from 'three';
import { StrokeAnimator } from './StrokeAnimator.js';
import { StrokeDef } from '../core/StrokeDef.js';
import { StrokeRenderer } from '../renderers/StrokeRenderer.js';

export class PhysicsAnimator extends StrokeAnimator {
    constructor(group, colorA, colorB, camera) {
        super(group, colorA, colorB);
        this.camera = camera;
        
        // Physics state
        this.pos = new THREE.Vector3(
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5
        );
        this.vel = new THREE.Vector3(
            (Math.random() - 0.5) * 3.0,
            (Math.random() - 0.5) * 3.0,
            (Math.random() - 0.5) * 3.0
        );
        
        this.gravityCenter = new THREE.Vector3(0, 0, 0);
        this.targetCenter = new THREE.Vector3();
        this.updateTargetCenter();
        
        this.timeSinceTargetChange = 0.0;
        this.targetChangeInterval = 2.0; // change target every 2 seconds
        
        this.maxDist = 1.15;
        this.constantWidth = 0.1 + Math.random() * 0.08;
        
        // Initialize path history (360 points)
        this.path = [];
        this.prewarmPhysics();
        
        this.init();
    }

    updateTargetCenter() {
        this.targetCenter.set(
            (Math.random() - 0.5) * 1.6,
            (Math.random() - 0.5) * 1.6,
            (Math.random() - 0.5) * 1.6
        );
    }

    prewarmPhysics() {
        // Pre-run the physics simulation 120 steps so we have a fully formed trail on spawn
        const subDt = 0.004;
        const G = 15.0;
        const eps = 0.15; // Softening factor to prevent blowup
        
        for (let i = 0; i < 360; i++) {
            const distToGrav = this.pos.distanceTo(this.gravityCenter);
            const jumpThreshold = 3.0 * this.constantWidth;
            if (distToGrav < jumpThreshold) {
                this.updateTargetCenter();
            }
            this.gravityCenter.lerp(this.targetCenter, 0.05);
            
            // Attractor pull
            const diff = new THREE.Vector3().subVectors(this.gravityCenter, this.pos);
            const distSq = diff.lengthSq() + eps;
            const accel = diff.clone().normalize().multiplyScalar(G / distSq);
            
            // Boundary restoration pull
            const distToCenter = this.pos.length();
            if (distToCenter > this.maxDist) {
                accel.addScaledVector(this.pos, -30.0 * (distToCenter - this.maxDist));
            }
            
            this.vel.addScaledVector(accel, subDt);
            this.vel.multiplyScalar(0.998); // Damping (reduced de-acceleration)
            this.pos.addScaledVector(this.vel, subDt);
            
            this.path.push(this.pos.clone());
        }
    }

    init() {
        const totalVertices = 360;
        const vertices = [];
        const normals = [];
        const widths = [];
        
        for (let i = 0; i < totalVertices; i++) {
            vertices.push(this.path[i].clone());
            normals.push(new THREE.Vector3(0, 0, 1));
            widths.push(this.constantWidth);
        }
        
        this.strokeDef = new StrokeDef(vertices, widths, normals);
        this.renderer = new StrokeRenderer(this.strokeDef, this.group, null, this.colorA, this.colorB, 'u');
    }

    update(time, dt, camera) {
        if (this.renderer) {
            if (camera && !this.camera) {
                this.camera = camera;
            }
            
            // 1. Move gravity center regularly
            this.timeSinceTargetChange += dt;
            if (this.timeSinceTargetChange >= this.targetChangeInterval) {
                this.updateTargetCenter();
                this.timeSinceTargetChange = 0.0;
            }
            this.gravityCenter.lerp(this.targetCenter, 0.05);
            
            // 2. Determine sub-steps for physics integration
            const subDt = 0.004;
            const G = 15.0;
            const eps = 0.15;
            const steps = Math.min(10, Math.max(1, Math.round(dt / subDt)));
            
            for (let s = 0; s < steps; s++) {
                // If particle gets too close to the current gravity center, jump early to avoid collapse
                const distToGrav = this.pos.distanceTo(this.gravityCenter);
                const jumpThreshold = 3.0 * this.constantWidth;
                if (distToGrav < jumpThreshold) {
                    this.updateTargetCenter();
                    this.timeSinceTargetChange = 0.0;
                }
                
                const diff = new THREE.Vector3().subVectors(this.gravityCenter, this.pos);
                const distSq = diff.lengthSq() + eps;
                const accel = diff.clone().normalize().multiplyScalar(G / distSq);
                
                const distToCenter = this.pos.length();
                if (distToCenter > this.maxDist) {
                    accel.addScaledVector(this.pos, -30.0 * (distToCenter - this.maxDist));
                }
                
                this.vel.addScaledVector(accel, subDt);
                this.vel.multiplyScalar(0.998); // Damping (reduced de-acceleration)
                this.pos.addScaledVector(this.vel, subDt);
                
                this.path.push(this.pos.clone());
                this.path.shift();
            }
            
            // 3. Setup camera billboard axes
            const toCamera = new THREE.Vector3(0, 0, 1);
            if (this.camera) {
                this.camera.getWorldPosition(toCamera);
                const groupPos = new THREE.Vector3();
                this.group.getWorldPosition(groupPos);
                toCamera.sub(groupPos).normalize();
            }
            
            // 4. Calculate tangents and normals along path
            const totalVertices = 360;
            const vertices = [];
            const normals = [];
            
            for (let i = 0; i < totalVertices; i++) {
                const p = this.path[i];
                vertices.push(p);
                
                // tangent estimation
                const prevIdx = Math.max(0, i - 1);
                const nextIdx = Math.min(totalVertices - 1, i + 1);
                const tangent = new THREE.Vector3().subVectors(this.path[nextIdx], this.path[prevIdx]);
                if (tangent.lengthSq() < 0.0001) {
                    tangent.set(0, 1, 0);
                } else {
                    tangent.normalize();
                }
                
                const normal = StrokeRenderer.calculateBillboardNormal(tangent, toCamera);
                normals.push(normal);
            }
            
            // 5. Taper widths around sharp loops
            const wSafe = new Float32Array(totalVertices);
            wSafe.fill(this.constantWidth / 2.0);
            
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
            
            const dynamicWidths = [];
            for (let i = 0; i < totalVertices; i++) {
                dynamicWidths.push(Math.min(this.constantWidth, wSafe[i] * 2.0));
            }
            
            this.renderer.updatePath(vertices, normals, dynamicWidths, time);
        }
    }
}
