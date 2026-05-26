import * as THREE from 'three';
import { StrokeAnimator } from './StrokeAnimator.js';
import { StrokeDef } from '../core/StrokeDef.js';
import { StrokeRenderer } from '../renderers/StrokeRenderer.js';

export class CubeAnimator extends StrokeAnimator {
    constructor(group, colorA, colorB, camera) {
        super(group, colorA, colorB);
        this.camera = camera;

        // Cube geometry setup
        const size = 0.80; // Slightly smaller half-size of the cube
        this.cubeSize = size;
        this.verticesList = [
            new THREE.Vector3(-size, -size, -size), // 0
            new THREE.Vector3( size, -size, -size), // 1
            new THREE.Vector3( size,  size, -size), // 2
            new THREE.Vector3(-size,  size, -size), // 3
            new THREE.Vector3(-size, -size,  size), // 4
            new THREE.Vector3( size, -size,  size), // 5
            new THREE.Vector3( size,  size,  size), // 6
            new THREE.Vector3(-size,  size,  size)  // 7
        ];

        // Vertices connected by edges differ by exactly one coordinate
        this.neighbors = [
            [1, 3, 4], // 0
            [0, 2, 5], // 1
            [1, 3, 6], // 2
            [0, 2, 7], // 3
            [0, 5, 7], // 4
            [1, 4, 6], // 5
            [2, 5, 7], // 6
            [3, 4, 6]  // 7
        ];

        this.cornerRadius = Math.min(size * 0.9, (0.2 + Math.random() * 0.2) * 2.0); // 2x larger corner radius (safe clamp)

        // Calculate the exact uniform length of each edge segment (straight part + corner arc)
        const edgeLengthVal = 2.0 * size;
        const r = this.cornerRadius;
        this.segmentLength = (edgeLengthVal - 2.0 * r) + (r * Math.PI / 2.0);

        // History of visited vertex indices to avoid backtracking
        this.history = [];
        this.anchors = [];

        // Choose random start vertex
        let current = Math.floor(Math.random() * 8);
        this.anchors.push(current);
        this.history.push(current);

        // Pre-populate anchors (keep 14 anchors in memory to maintain safe viewport)
        for (let i = 0; i < 13; i++) {
            current = this.getNextNeighbor(current);
            this.anchors.push(current);
            this.history.push(current);
            if (this.history.length > 5) {
                this.history.shift();
            }
        }

        // Setup infinite flow parameters using the uniform segmentLength
        this.strokeLength = 4.0 * this.segmentLength; // Stroke spans exactly 4 segments (edges)
        this.u_head = 6.0 * this.segmentLength; // Position head comfortably ahead of the tail
        this.speed = (1.2 + Math.random() * 4.4) * this.segmentLength; // Flow speed (segments/sec, 2x faster)

        // Random rotation axis and speed (similar to Lissajous)
        this.rotationAxis = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();
        this.rotationSpeed = (0.3 + Math.random() * 1.7) * 1.5; // Rotation speed in rad/sec (1.5x faster)

        // Random initial orientation
        this.group.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );

        this.maxWidth = 0.18 + Math.random() * 0.08; // stroke thickness
        this.scaleFactor = 1.0;

        this.init();
    }

    getNextNeighbor(currentIdx) {
        const candidates = this.neighbors[currentIdx];
        const unvisited = candidates.filter(c => !this.history.includes(c));
        
        if (unvisited.length > 0) {
            return unvisited[Math.floor(Math.random() * unvisited.length)];
        }
        
        // Fallback: Pick the least recently visited neighbor from history
        let best = candidates[0];
        let minHistoryIdx = Infinity;
        for (const c of candidates) {
            const idx = this.history.indexOf(c);
            if (idx < minHistoryIdx) {
                minHistoryIdx = idx;
                best = c;
            }
        }
        return best;
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

    generateSmoothPath() {
        const points = [];
        const r = this.cornerRadius;
        const numAnchors = this.anchors.length;

        // Process corners from 1 to numAnchors-2 to build uniform edges
        for (let i = 1; i < numAnchors - 1; i++) {
            const V_prev = this.verticesList[this.anchors[i - 1]];
            const V_curr = this.verticesList[this.anchors[i]];
            const V_next = this.verticesList[this.anchors[i + 1]];

            const D_in = new THREE.Vector3().subVectors(V_curr, V_prev).normalize();
            const D_out = new THREE.Vector3().subVectors(V_next, V_curr).normalize();

            // 1. Add straight segment from end of previous arc to start of current arc
            const P_prev_end = new THREE.Vector3().copy(V_prev).addScaledVector(D_in, r);
            const P_curr_start = new THREE.Vector3().copy(V_curr).addScaledVector(D_in, -r);

            // Sample straight line segment
            const stepsStraight = 15;
            for (let k = 0; k < stepsStraight; k++) {
                const alpha = k / stepsStraight;
                const pt = new THREE.Vector3().lerpVectors(P_prev_end, P_curr_start, alpha);
                points.push(pt);
            }

            // 2. Add corner arc (90-degree circular bend)
            const C = new THREE.Vector3().copy(V_curr).addScaledVector(D_in, -r).addScaledVector(D_out, r);
            const stepsCorner = 15;
            for (let k = 0; k < stepsCorner; k++) {
                const alpha = k / stepsCorner;
                const phi = alpha * Math.PI / 2;
                const cosVal = Math.cos(phi);
                const sinVal = Math.sin(phi);

                const pt = new THREE.Vector3().copy(C)
                    .addScaledVector(D_out, -r * cosVal)
                    .addScaledVector(D_in, r * sinVal);
                points.push(pt);
            }
        }

        // Add the very final point of the last segment to close the geometry cleanly
        const V_last_prev = this.verticesList[this.anchors[numAnchors - 3]];
        const V_last = this.verticesList[this.anchors[numAnchors - 2]];
        const D_last_in = new THREE.Vector3().subVectors(V_last, V_last_prev).normalize();
        const P_last_end = new THREE.Vector3().copy(V_last).addScaledVector(D_last_in, -r);
        points.push(P_last_end);

        return points;
    }

    update(time, dt, camera) {
        if (this.renderer) {
            if (camera && !this.camera) {
                this.camera = camera;
            }

            // Spin the cube around its random axis
            this.group.rotateOnAxis(this.rotationAxis, this.rotationSpeed * dt);

            // Advance phase progress
            this.u_head += this.speed * dt;

            // Shift segment boundaries when head advances past a full edge segment
            while (this.u_head >= 7.0 * this.segmentLength) {
                this.u_head -= this.segmentLength;
                
                // Shift anchors list
                this.anchors.shift();
                
                // Add a new anchor that avoids recent history
                const lastAnchor = this.anchors[this.anchors.length - 1];
                const nextAnchor = this.getNextNeighbor(lastAnchor);
                this.anchors.push(nextAnchor);
                
                this.history.push(nextAnchor);
                if (this.history.length > 5) {
                    this.history.shift();
                }
            }

            const u_tail = this.u_head - this.strokeLength;

            // Establish billboard camera vector in local coordinate system
            const toCameraWorld = new THREE.Vector3(0, 0, 1);
            if (this.camera) {
                this.camera.getWorldPosition(toCameraWorld);
                const groupPos = new THREE.Vector3();
                this.group.getWorldPosition(groupPos);
                toCameraWorld.sub(groupPos).normalize();
            }
            const toCamera = toCameraWorld.clone().applyQuaternion(this.group.quaternion.clone().invert()).normalize();

            // Generate high-resolution smoothed curve points
            const rawPoints = this.generateSmoothPath();
            if (rawPoints.length < 2) return;

            // Compute cumulative distance along raw path
            const dists = [0];
            for (let i = 1; i < rawPoints.length; i++) {
                dists.push(dists[i - 1] + rawPoints[i].distanceTo(rawPoints[i - 1]));
            }

            const totalVertices = 120;
            const vertices = [];
            const normals = [];
            const widths = [];

            for (let i = 0; i < totalVertices; i++) {
                const ratio = i / (totalVertices - 1);
                const targetDist = u_tail + ratio * this.strokeLength;

                // Find index in cumulative dists
                let k = 1;
                while (k < dists.length - 1 && dists[k] < targetDist) {
                    k++;
                }

                // Interpolate position
                const distPrev = dists[k - 1];
                const distNext = dists[k];
                const segmentLength = distNext - distPrev;
                const alpha = segmentLength > 0.0001 ? (targetDist - distPrev) / segmentLength : 0;
                
                const pos = new THREE.Vector3().lerpVectors(rawPoints[k - 1], rawPoints[k], alpha);
                const scaledPos = pos.clone().multiplyScalar(this.scaleFactor);

                // Add depth offset along toCamera vector to avoid Z-fighting on self-intersection
                const depthOffset = (ratio - 0.5) * 0.03;
                scaledPos.addScaledVector(toCamera, depthOffset);

                vertices.push(scaledPos);

                // Tangent vector
                const tangent = new THREE.Vector3().subVectors(rawPoints[k], rawPoints[k - 1]).normalize();
                
                // Billboard normal vector (perpendicular to projected tangent and camera vector)
                const normal = StrokeRenderer.calculateBillboardNormal(tangent, toCamera);
                normals.push(normal);

                // Uniform width profile (no tapering, ends rounded by GPU shader)
                widths.push(this.maxWidth);
            }

            this.renderer.updatePath(vertices, normals, widths, time);
        }
    }
}
