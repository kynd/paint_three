import * as THREE from 'three';
import { StrokeAnimator } from './StrokeAnimator.js';
import { StrokeGenerator } from '../core/StrokeGenerator.js';
import { StrokeRenderer } from '../renderers/StrokeRenderer.js';
import { tween } from '../helpers/easing.js';

export class SpiralAnimator extends StrokeAnimator {
    constructor(group, colorA, colorB, camera, turns, orthogonal) {
        super(group, colorA, colorB);
        this.camera = camera;
        this.turns = (typeof turns === 'number') ? turns : (2 + Math.random() * 2);
        this.orthogonal = (typeof orthogonal === 'boolean') ? orthogonal : Math.random() > 0.5;
        this.direction = Math.random() > 0.5 ? 1 : -1;
        
        // Easing parameters
        this.cycleDuration = (3.0 + Math.random() * 3.0) / 1.5; // Length of a cycle in seconds (1.5x faster)
        this.rotationsPerCycle = Math.floor(2 + Math.random() * 2); // N of rotations per cycle (> 1)
        this.easing = tween.createCubicBezier({ x: 0.4, y: 0.0 }, { x: 0.2, y: 1.0 });
        
        this.rotationAxis = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();
        
        this.init();
        this.group.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
    }

    init() {
        this.strokeDef = StrokeGenerator.spiral(this.turns, this.orthogonal);
        this.centerAndNormalize(1.15);
        this.renderer = new StrokeRenderer(this.strokeDef, this.group, null, this.colorA, this.colorB);
    }

    update(time, dt) {
        if (this.renderer && this.renderer.mesh) {
            this.renderer.mesh.material.uniforms.uTime.value = time;
            
            // A cycle represented by t: 0.0 - 1.0
            const t = (time % this.cycleDuration) / this.cycleDuration;
            const easedT = this.easing(t);
            // Angle = 2PI x N x easedT
            const angle = 2 * Math.PI * this.rotationsPerCycle * easedT;
            this.renderer.mesh.quaternion.setFromAxisAngle(this.rotationAxis, this.direction * angle);
        }
    }
}
