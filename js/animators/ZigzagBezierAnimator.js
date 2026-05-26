import * as THREE from 'three';
import { StrokeAnimator } from './StrokeAnimator.js';
import { StrokeDef } from '../core/StrokeDef.js';
import { StrokeRenderer } from '../renderers/StrokeRenderer.js';

export class ZigzagBezierAnimator extends StrokeAnimator {
    constructor(group, colorA, colorB, camera) {
        super(group, colorA, colorB);
        this.camera = camera;
        
        // N points/segments setup (2 to 5)
        const numPoints = Math.floor(2 + Math.random() * 4); // 2 to 5 points
        this.strokeLength = numPoints - 1; // active window segments count
        
        // Flow velocity
        this.flowSpeed = (0.5 + Math.random() * 0.5) * 12.0;
        this.maxDist = 1.15;
        
        this.directions = [];
        this.segments = [];
        
        // Setup initial segments (requires strokeLength + 2 segments)
        this.generateInitialPath(this.strokeLength + 2, camera);
        
        this.headS = this.strokeLength;
        this.tailS = 0.0;
        
        // Halved width profile for calligraphic ribbon (similar to BezierAnimator)
        this.constantWidth = 0.1 + Math.random() * 0.075;
        
        this.init();
    }

    getCameraViewDir(camera) {
        const activeCam = camera || this.camera;
        if (!activeCam) {
            return new THREE.Vector3(0, 0, -1);
        }
        const camPos = new THREE.Vector3();
        activeCam.getWorldPosition(camPos);
        const groupPos = new THREE.Vector3();
        this.group.getWorldPosition(groupPos);
        return new THREE.Vector3().subVectors(groupPos, camPos).normalize();
    }

    enforceBias(p, dir) {
        const len = p.length();
        if (len < 0.001) return dir.clone();
        
        const U_radial = p.clone().normalize();
        const beta = Math.pow(Math.min(1.0, len / this.maxDist), 3.0);
        const maxCos = 1.0 - beta;
        
        const c = dir.dot(U_radial);
        if (c > maxCos) {
            const c_new = maxCos;
            const V_perp = dir.clone().addScaledVector(U_radial, -c);
            const perpLen = V_perp.length();
            if (perpLen > 0.001) {
                const targetPerpLen = Math.sqrt(Math.max(0, 1.0 - c_new * c_new));
                V_perp.multiplyScalar(targetPerpLen / perpLen);
                return new THREE.Vector3().addVectors(U_radial.clone().multiplyScalar(c_new), V_perp);
            } else {
                const randVec = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
                randVec.addScaledVector(U_radial, -randVec.dot(U_radial)).normalize();
                const targetPerpLen = Math.sqrt(Math.max(0, 1.0 - c_new * c_new));
                return new THREE.Vector3().addVectors(U_radial.clone().multiplyScalar(c_new), randVec.multiplyScalar(targetPerpLen));
            }
        }
        return dir.clone();
    }

    createSegment(pA, dIn, dOut, r, lStraight) {
        const dot = Math.max(-1.0, Math.min(1.0, dIn.dot(dOut)));
        const theta = Math.acos(dot);
        
        let planeNormal = new THREE.Vector3();
        if (theta > 0.001) {
            planeNormal.crossVectors(dIn, dOut).normalize();
        } else {
            const temp = Math.abs(dIn.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
            planeNormal.crossVectors(dIn, temp).normalize();
        }
        
        const crossDir = new THREE.Vector3().crossVectors(planeNormal, dIn).normalize();
        
        const pArcEnd = new THREE.Vector3().copy(pA);
        if (theta > 0.001) {
            pArcEnd.addScaledVector(dIn, r * Math.sin(theta));
            pArcEnd.addScaledVector(crossDir, r * (1.0 - Math.cos(theta)));
        }
        
        const pB = new THREE.Vector3().copy(pArcEnd).addScaledVector(dOut, lStraight);
        
        const sArc = r * theta;
        const sStraight = lStraight;
        const sTotal = sArc + sStraight;
        
        return {
            p0: pA.clone(),
            p1: pB.clone(),
            dIn: dIn.clone(),
            dOut: dOut.clone(),
            r,
            lStraight,
            theta,
            planeNormal,
            crossDir,
            pArcEnd,
            sArc,
            sStraight,
            sTotal
        };
    }

    evaluateSegment(seg, t) {
        const s = t * seg.sTotal;
        const pos = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        
        if (s <= seg.sArc && seg.theta > 0.001) {
            const alpha = s / seg.r;
            pos.copy(seg.p0);
            pos.addScaledVector(seg.dIn, seg.r * Math.sin(alpha));
            pos.addScaledVector(seg.crossDir, seg.r * (1.0 - Math.cos(alpha)));
            
            tangent.copy(seg.dIn).multiplyScalar(Math.cos(alpha));
            tangent.addScaledVector(seg.crossDir, Math.sin(alpha));
            tangent.normalize();
        } else {
            const d = s - seg.sArc;
            pos.copy(seg.pArcEnd).addScaledVector(seg.dOut, d);
            tangent.copy(seg.dOut);
        }
        
        return { pos, tangent };
    }

    sampleSpline(s, camera) {
        const segIndex = Math.max(0, Math.min(this.segments.length - 1, Math.floor(s)));
        const t = Math.max(0.0, Math.min(1.0, s - segIndex));
        const seg = this.segments[segIndex];
        const result = this.evaluateSegment(seg, t);
        
        let planeNormal = new THREE.Vector3(0, 0, 1);
        if (camera) {
            const cameraWorldPos = new THREE.Vector3();
            camera.getWorldPosition(cameraWorldPos);
            const groupWorldPos = new THREE.Vector3();
            this.group.getWorldPosition(groupWorldPos);
            planeNormal.subVectors(cameraWorldPos, groupWorldPos).normalize();
        }
        
        const normal = StrokeRenderer.calculateBillboardNormal(result.tangent, planeNormal);
        return { pos: result.pos, normal };
    }

    generateInitialPath(numSegments, camera) {
        // 1. Initial point and direction
        const p0 = new THREE.Vector3(
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5
        );
        if (p0.length() > this.maxDist) p0.normalize().multiplyScalar(this.maxDist);
        
        let d0 = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        this.directions.push(d0);
        
        let pCurr = p0.clone();
        let dCurr = d0.clone();
        
        // 2. Sequential segment generation
        for (let i = 0; i < numSegments; i++) {
            let bestDir = null;
            let bestScore = -Infinity;
            let chosenR = 0.2;
            let chosenL = 0.5;
            
            for (let j = 0; j < 100; j++) {
                const rProposed = 0.15 + Math.random() * 0.2;
                const lProposed = 0.8 + Math.random() * 0.8;
                
                const randVec = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
                const proposedDir = new THREE.Vector3()
                    .addScaledVector(dCurr, 0.5)
                    .addScaledVector(randVec, 0.5)
                    .normalize();
                    
                const biasedDir = this.enforceBias(pCurr, proposedDir);
                
                // Estimate proposed point
                const dot = Math.max(-1.0, Math.min(1.0, dCurr.dot(biasedDir)));
                const theta = Math.acos(dot);
                let pArcEnd = pCurr.clone();
                if (theta > 0.001) {
                    const planeN = new THREE.Vector3().crossVectors(dCurr, biasedDir).normalize();
                    const crossD = new THREE.Vector3().crossVectors(planeN, dCurr).normalize();
                    pArcEnd.addScaledVector(dCurr, rProposed * Math.sin(theta));
                    pArcEnd.addScaledVector(crossD, rProposed * (1.0 - Math.cos(theta)));
                }
                const p_proposed = pArcEnd.clone().addScaledVector(biasedDir, lProposed);
                
                if (p_proposed.length() > this.maxDist) {
                    p_proposed.normalize().multiplyScalar(this.maxDist);
                }
                
                let score = 0;
                
                // Spacing constraint (avoid packing too closely)
                const dist = p_proposed.distanceTo(pCurr);
                if (dist < 0.55) score -= 100;
                
                // Camera turn projection constraints (>30 deg)
                const vCam = this.getCameraViewDir(camera);
                const projIn = dCurr.clone().addScaledVector(vCam, -dCurr.dot(vCam));
                const projOut = biasedDir.clone().addScaledVector(vCam, -biasedDir.dot(vCam));
                const lenIn = projIn.length();
                const lenOut = projOut.length();
                
                if (lenIn > 0.1 && lenOut > 0.1) {
                    projIn.divideScalar(lenIn);
                    projOut.divideScalar(lenOut);
                    const dotProj = projIn.dot(projOut);
                    if (dotProj < -0.85) {
                        score -= 500 * (-0.85 - dotProj);
                    }
                }
                
                // 3D forward momentum
                const dot3d = biasedDir.dot(dCurr);
                if (dot3d < 0.0) {
                    score -= 200 * (-dot3d);
                }
                
                // Center attraction
                const distToCenter = p_proposed.length();
                if (distToCenter > 0.95) {
                    const toCenter = p_proposed.clone().negate().normalize();
                    score += 15 * biasedDir.dot(toCenter) * (distToCenter - 0.95);
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestDir = biasedDir.clone();
                    chosenR = rProposed;
                    chosenL = lProposed;
                }
            }
            
            if (!bestDir) {
                bestDir = dCurr.clone();
            }
            
            const seg = this.createSegment(pCurr, dCurr, bestDir, chosenR, chosenL);
            this.segments.push(seg);
            
            pCurr = seg.p1.clone();
            dCurr = bestDir.clone();
            this.directions.push(dCurr);
        }
    }

    extendPath(camera) {
        const lastSeg = this.segments[this.segments.length - 1];
        const pLast = lastSeg.p1;
        const dLast = lastSeg.dOut;
        
        let bestDir = null;
        let bestScore = -Infinity;
        let chosenR = 0.2;
        let chosenL = 0.5;
        
        for (let i = 0; i < 100; i++) {
            const rProposed = 0.15 + Math.random() * 0.2;
            const lProposed = 0.8 + Math.random() * 0.8;
            
            const randVec = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            const proposedDir = new THREE.Vector3()
                .addScaledVector(dLast, 0.5)
                .addScaledVector(randVec, 0.5)
                .normalize();
                
            const biasedDir = this.enforceBias(pLast, proposedDir);
            
            // Estimate proposed point
            const dot = Math.max(-1.0, Math.min(1.0, dLast.dot(biasedDir)));
            const theta = Math.acos(dot);
            let pArcEnd = pLast.clone();
            if (theta > 0.001) {
                const planeN = new THREE.Vector3().crossVectors(dLast, biasedDir).normalize();
                const crossD = new THREE.Vector3().crossVectors(planeN, dLast).normalize();
                pArcEnd.addScaledVector(dLast, rProposed * Math.sin(theta));
                pArcEnd.addScaledVector(crossD, rProposed * (1.0 - Math.cos(theta)));
            }
            const p_proposed = pArcEnd.clone().addScaledVector(biasedDir, lProposed);
            
            if (p_proposed.length() > this.maxDist) {
                p_proposed.normalize().multiplyScalar(this.maxDist);
            }
            
            let score = 0;
            
            // Spacing
            const dist = p_proposed.distanceTo(pLast);
            if (dist < 0.55) score -= 100;
            
            // Camera projection (>30 deg)
            const vCam = this.getCameraViewDir(camera);
            const projIn = dLast.clone().addScaledVector(vCam, -dLast.dot(vCam));
            const projOut = biasedDir.clone().addScaledVector(vCam, -biasedDir.dot(vCam));
            const lenIn = projIn.length();
            const lenOut = projOut.length();
            
            if (lenIn > 0.1 && lenOut > 0.1) {
                projIn.divideScalar(lenIn);
                projOut.divideScalar(lenOut);
                const dotProj = projIn.dot(projOut);
                if (dotProj < -0.85) {
                    score -= 500 * (-0.85 - dotProj);
                }
            }
            
            // 3D momentum
            const dot3d = biasedDir.dot(dLast);
            if (dot3d < 0.0) {
                score -= 200 * (-dot3d);
            }
            
            // Center attraction
            const distToCenter = p_proposed.length();
            if (distToCenter > 0.95) {
                const toCenter = p_proposed.clone().negate().normalize();
                score += 15 * biasedDir.dot(toCenter) * (distToCenter - 0.95);
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestDir = biasedDir.clone();
                chosenR = rProposed;
                chosenL = lProposed;
            }
        }
        
        if (!bestDir) {
            bestDir = dLast.clone();
        }
        
        const newSeg = this.createSegment(pLast, dLast, bestDir, chosenR, chosenL);
        this.segments.push(newSeg);
        this.directions.push(bestDir);
    }

    init() {
        const totalVertices = 120;
        const vertices = [];
        const normals = [];
        
        for (let i = 0; i < totalVertices; i++) {
            const sVal = this.tailS + i / (totalVertices - 1) * (this.headS - this.tailS);
            const sample = this.sampleSpline(sVal, null);
            vertices.push(sample.pos);
            normals.push(sample.normal);
        }
        
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
        
        const widths = [];
        for (let i = 0; i < totalVertices; i++) {
            widths.push(Math.min(this.constantWidth, wSafe[i] * 2.0));
        }
        
        this.strokeDef = new StrokeDef(vertices, widths, normals);
        // Use longitudinal gradient 'u' for sleek trails, same as BezierAnimator
        this.renderer = new StrokeRenderer(this.strokeDef, this.group, null, this.colorA, this.colorB, 'u');
    }

    update(time, dt, camera) {
        if (this.renderer) {
            if (camera && !this.camera) {
                this.camera = camera;
            }
            
            this.headS += this.flowSpeed * dt;
            this.tailS = this.headS - this.strokeLength;
            
            if (this.headS >= this.strokeLength + 1.0) {
                this.extendPath(camera);
                
                this.segments.shift();
                this.directions.shift();
                
                this.headS -= 1.0;
                this.tailS -= 1.0;
            }
            
            const vertices = [];
            const normals = [];
            const totalVertices = 120;
            
            for (let i = 0; i < totalVertices; i++) {
                const u = i / (totalVertices - 1);
                const sVal = this.tailS + u * (this.headS - this.tailS);
                const sample = this.sampleSpline(sVal, camera);
                vertices.push(sample.pos);
                normals.push(sample.normal);
            }
            
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
