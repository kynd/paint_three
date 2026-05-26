import * as THREE from 'three';

export class StrokeAnimator {
    /**
     * @param {THREE.Group} group - The specimen group to attach the stroke to
     * @param {THREE.Color} colorA
     * @param {THREE.Color} colorB
     */
    constructor(group, colorA, colorB) {
        this.group = group;
        this.colorA = colorA;
        this.colorB = colorB;
        this.renderer = null;
        this.strokeDef = null;
    }

    init() {
        // Overridden by subclasses
    }

    update(time, dt) {
        // Overridden by subclasses
    }

    centerAndNormalize(boxLimit = 0.9) {
        if (!this.strokeDef || this.strokeDef.vertices.length === 0) return;
        const bbox = new THREE.Box3().setFromPoints(this.strokeDef.vertices);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        
        for (let v of this.strokeDef.vertices) {
            v.sub(center);
        }
        
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        this.scaleFactor = 1.0;
        if (maxDim > 0.0001) {
            this.scaleFactor = boxLimit / (maxDim / 2);
            for (let v of this.strokeDef.vertices) {
                v.multiplyScalar(this.scaleFactor);
            }
        }
    }

    destroy() {
        if (this.renderer) {
            this.renderer.destroy();
        }
    }
}
