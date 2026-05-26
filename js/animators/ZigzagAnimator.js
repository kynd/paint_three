import * as THREE from 'three';
import { StrokeAnimator } from './StrokeAnimator.js';
import { StrokeGenerator } from '../core/StrokeGenerator.js';
import { StrokeRenderer } from '../renderers/StrokeRenderer.js';
import { StrokeDef } from '../core/StrokeDef.js';

export class ZigzagAnimator extends StrokeAnimator {
    constructor(group, colorA, colorB, camera, numPeriods) {
        super(group, colorA, colorB);
        this.camera = camera;
        this.numPeriods = (typeof numPeriods === 'number') ? numPeriods : (1.5 + Math.random() * 2.5);
        this.r = 1.0 + Math.random() * 1.5;
        
        const ratio_l = 0.5 + Math.random() * 4.5;
        // Interpolate minimum angle from 45 degrees (at ratio_l = 1.0) to 120 degrees (at ratio_l = 4.0)
        const minTheta = Math.PI / 4 + Math.max(0, Math.min(1, (ratio_l - 1.0) / 3.0)) * (Math.PI * 2 / 3 - Math.PI / 4);
        this.theta = minTheta + Math.random() * (Math.PI * 0.9 - minTheta);
        this.lStraight = this.r * ratio_l;
        this.alpha = this.theta / 2;
        
        // Keep initial direction for projecting onto camera plane
        this.initialDirection = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();
        
        // Fallback static direction and axes
        this.direction = this.initialDirection.clone();
        let upVec = new THREE.Vector3(0, 1, 0);
        if (Math.abs(this.direction.dot(upVec)) > 0.9) {
            upVec.set(1, 0, 0);
        }
        this.oscAxis = new THREE.Vector3().crossVectors(this.direction, upVec).normalize();
        this.planeNormal = new THREE.Vector3().crossVectors(this.direction, this.oscAxis).normalize();
        
        this.waveSpeed = 2.0 + Math.random() * 3.0;
        this.directionSign = Math.random() > 0.5 ? 1 : -1;
        
        this.init();
    }

    init() {
        // Generate initial vertices at phase = 0
        const vertices = this.generateVertices(0);
        
        // Compute initial widths
        const baseWidths = [];
        const totalPoints = vertices.length;
        for (let i = 0; i < totalPoints; i++) {
            const u = i / (totalPoints - 1);
            const baseWidth = 0.2 + 0.15 * Math.sin(u * Math.PI) + 0.05 * Math.sin(u * Math.PI * 4);
            baseWidths.push(baseWidth);
        }
        
        // Generate initial normals
        const normals = this.generateNormals(vertices);
        
        this.strokeDef = new StrokeDef(vertices, baseWidths, normals);
        this.centerAndNormalize(1.2);
        
        // Adaptive width safety check:
        // If the scaled radius (rWorld = this.r * this.scaleFactor) is smaller than the maximum unscaled half-width (0.2),
        // we scale down the widths of this specific specimen to ensure zero self-intersection.
        // This keeps it as thick as mathematically possible while preventing overlap!
        const rWorld = this.r * this.scaleFactor;
        const maxHalfWidth = 0.2;
        const widthScale = Math.min(1.0, (rWorld * 0.9) / maxHalfWidth);
        if (widthScale < 1.0) {
            for (let i = 0; i < this.strokeDef.widths.length; i++) {
                this.strokeDef.widths[i] *= widthScale;
            }
        }
        this.widths = this.strokeDef.widths;
        
        this.renderer = new StrokeRenderer(this.strokeDef, this.group, null, this.colorA, this.colorB);
    }

    generateVertices(phase) {
        const highResVertices = [];
        const highResPointsCount = 180;
        
        const segments = [];
        let currentPos = new THREE.Vector2(0, 0);
        
        // Create numPeriods + 2 periods of segments
        for (let p = 0; p < this.numPeriods + 2; p++) {
            const p0 = currentPos.clone();
            currentPos.x += this.lStraight * Math.cos(this.alpha);
            currentPos.y += this.lStraight * Math.sin(this.alpha);
            const p1 = currentPos.clone();
            
            const center1 = new THREE.Vector2(
                p1.x + this.r * Math.sin(this.alpha),
                p1.y - this.r * Math.cos(this.alpha)
            );
            const startAngle1 = this.alpha + Math.PI / 2;
            currentPos.x = center1.x + this.r * Math.cos(-this.alpha + Math.PI / 2);
            currentPos.y = center1.y + this.r * Math.sin(-this.alpha + Math.PI / 2);
            const p2 = currentPos.clone();
            
            currentPos.x += this.lStraight * Math.cos(-this.alpha);
            currentPos.y += this.lStraight * Math.sin(-this.alpha);
            const p3 = currentPos.clone();
            
            const center2 = new THREE.Vector2(
                p3.x + this.r * Math.sin(this.alpha),
                p3.y + this.r * Math.cos(this.alpha)
            );
            const startAngle2 = -this.alpha - Math.PI / 2;
            currentPos.x = center2.x + this.r * Math.cos(this.alpha - Math.PI / 2);
            currentPos.y = center2.y + this.r * Math.sin(this.alpha - Math.PI / 2);
            const p4 = currentPos.clone();
            
            segments.push({ type: 'straight', start: p0, end: p1, angle: this.alpha, length: this.lStraight });
            segments.push({ type: 'arc', center: center1, startAngle: startAngle1, dir: -1, length: this.theta * this.r, r: this.r });
            segments.push({ type: 'straight', start: p2, end: p3, angle: -this.alpha, length: this.lStraight });
            segments.push({ type: 'arc', center: center2, startAngle: startAngle2, dir: 1, length: this.theta * this.r, r: this.r });
        }

        const periodLength = 2 * this.lStraight + 2 * this.theta * this.r;
        const totalLength = this.numPeriods * periodLength;
        const startS = ((phase * periodLength / (2 * Math.PI)) % periodLength + periodLength) % periodLength;

        const getPointOnSegments = (s) => {
            let currentS = s;
            for (let seg of segments) {
                if (currentS <= seg.length) {
                    if (seg.type === 'straight') {
                        const t = currentS / seg.length;
                        return new THREE.Vector2().lerpVectors(seg.start, seg.end, t);
                    } else {
                        const angle = seg.startAngle + seg.dir * (currentS / seg.r);
                        return new THREE.Vector2(
                            seg.center.x + seg.r * Math.cos(angle),
                            seg.center.y + seg.r * Math.sin(angle)
                        );
                    }
                }
                currentS -= seg.length;
            }
            const last = segments[segments.length - 1];
            if (last.type === 'straight') return last.end.clone();
            const angle = last.startAngle + last.dir * (last.length / last.r);
            return new THREE.Vector2(
                last.center.x + last.r * Math.cos(angle),
                last.center.y + last.r * Math.sin(angle)
            );
        };

        for (let i = 0; i < highResPointsCount; i++) {
            const s = startS + (i / (highResPointsCount - 1)) * totalLength;
            const p2d = getPointOnSegments(s);
            
            // Position using our active direction and oscAxis
            const p3d = new THREE.Vector3()
                .addScaledVector(this.direction, p2d.x)
                .addScaledVector(this.oscAxis, p2d.y);
            highResVertices.push(p3d);
        }
        
        return StrokeGenerator.resampleByCurvature(highResVertices, 120);
    }

    generateNormals(vertices) {
        const normals = [];
        const totalPoints = vertices.length;

        for (let i = 0; i < totalPoints; i++) {
            const pNext = vertices[Math.min(i + 1, totalPoints - 1)];
            const pPrev = vertices[Math.max(0, i - 1)];
            const tangent = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
            
            // Extrude flat in the oscillation plane (orthogonal to tangent and planeNormal)
            const normal = new THREE.Vector3().crossVectors(tangent, this.planeNormal).normalize();
            normals.push(normal);
        }
        return normals;
    }

    update(time, dt, camera) {
        if (this.renderer) {
            if (camera) {
                const cameraWorldPos = new THREE.Vector3();
                camera.getWorldPosition(cameraWorldPos);
                const groupWorldPos = new THREE.Vector3();
                this.group.getWorldPosition(groupWorldPos);
                
                // Set the plane normal to the view direction from group to camera
                this.planeNormal = new THREE.Vector3().subVectors(cameraWorldPos, groupWorldPos).normalize();
                
                // Project the initial random direction onto the camera-orthogonal plane
                this.direction = this.initialDirection.clone().projectOnPlane(this.planeNormal).normalize();
                
                // The oscillation axis is perpendicular to both the direction and plane normal
                this.oscAxis = new THREE.Vector3().crossVectors(this.direction, this.planeNormal).normalize();
            }

            const phase = time * this.waveSpeed * this.directionSign;
            const vertices = this.generateVertices(phase);
            
            // Center and scale the vertices manually using the cached scaleFactor
            const bbox = new THREE.Box3().setFromPoints(vertices);
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            for (let v of vertices) {
                v.sub(center);
                v.multiplyScalar(this.scaleFactor);
            }
            
            const normals = this.generateNormals(vertices);
            
            // Push updated path and normals to renderer uniforms
            this.renderer.updatePath(vertices, normals, undefined, time);
        }
    }
}
