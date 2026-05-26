import * as THREE from 'three';
import { StrokeAnimator } from './StrokeAnimator.js';
import { StrokeDef } from '../core/StrokeDef.js';
import { StrokeRenderer } from '../renderers/StrokeRenderer.js';

export class BezierAnimator extends StrokeAnimator {
    constructor(group, colorA, colorB, camera) {
        super(group, colorA, colorB);
        this.camera = camera;
        
        // Number of points N randomized between 5 and 20.
        // The stroke covers the length of N - 1 points (which is N - 1 segments).
        const numPoints = Math.floor(5 + Math.random() * 16); // 5 to 20 points
        this.strokeLength = numPoints - 1; // 4 to 19 segments
        
        // 4x faster flow speed (4x faster than 12.0 = 48.0)
        this.flowSpeed = (0.5 + Math.random() * 0.5) * 48.0;
        this.maxDist = 1.15;
        
        // Setup initial anchors within the cell boundaries
        this.anchors = [];
        this.tangents = [];
        this.segments = [];
        
        // We need strokeLength + 3 anchors to support glitch-free shift updates
        const numInitialAnchors = this.strokeLength + 3;
        const anchorsList = this.generateInitialAnchors(numInitialAnchors, camera);
        this.anchors.push(...anchorsList);
        
        const num = this.anchors.length;
        
        // Compute initial tangents
        this.tangents.push(new THREE.Vector3().subVectors(this.anchors[1], this.anchors[0]).normalize());
        for (let i = 1; i < num - 1; i++) {
            this.tangents.push(this.computeSmoothTangent(this.anchors[i - 1], this.anchors[i], this.anchors[i + 1]));
        }
        this.tangents.push(new THREE.Vector3().subVectors(this.anchors[num - 1], this.anchors[num - 2]).normalize());
        
        // Compute initial segments
        for (let i = 0; i < num - 1; i++) {
            this.segments.push(
                this.createSegment(this.anchors[i], this.anchors[i + 1], this.tangents[i], this.tangents[i + 1])
            );
        }
        
        // Stroke starts covering from segment 0 to segment (strokeLength - 1)
        this.headS = this.strokeLength;
        this.tailS = 0.0;
        
        // Set constant width for the entire stroke (1/4 thinner)
        this.constantWidth = (0.1 + Math.random() * 0.075) / 4.0;
        
        // Setup random axis and speed for continuous rotation
        this.rotationAxis = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();
        this.rotationSpeed = 0.3 + Math.random() * 1.7; // rad/sec
        
        this.init();
    }

    computeSmoothTangent(pPrev, pCurr, pNext) {
        const v1 = new THREE.Vector3().subVectors(pCurr, pPrev).normalize();
        const v2 = new THREE.Vector3().subVectors(pNext, pCurr).normalize();
        return new THREE.Vector3().addVectors(v1, v2).normalize();
    }

    getCameraViewDir(camera) {
        const activeCam = camera || this.camera;
        if (!activeCam) {
            return new THREE.Vector3(0, 0, 1);
        }
        const camPos = new THREE.Vector3();
        activeCam.getWorldPosition(camPos);
        const groupPos = new THREE.Vector3();
        this.group.getWorldPosition(groupPos);
        const toCamera = new THREE.Vector3().subVectors(camPos, groupPos).normalize();
        return toCamera.applyQuaternion(this.group.quaternion.clone().invert()).normalize();
    }

    enforceBias(p, dir) {
        const len = p.length();
        if (len < 0.001) return dir.clone();
        
        const U_radial = p.clone().normalize();
        // Cubic scaling makes the boundary pull very soft inside the cell
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

    generateInitialAnchors(num, camera) {
        const list = [];
        
        // 1. Generate P0
        const p0 = new THREE.Vector3(
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5
        );
        if (p0.length() > this.maxDist) p0.normalize().multiplyScalar(this.maxDist);
        list.push(p0);
        
        // 2. Generate P1 with distance at least 0.6 (1/3 of area width)
        let p1 = new THREE.Vector3();
        let d0 = new THREE.Vector3();
        while (true) {
            const step = 0.6 + Math.random() * 0.3;
            const rand = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            d0.copy(this.enforceBias(p0, rand));
            p1.set(0, 0, 0).addVectors(p0, d0.clone().multiplyScalar(step));
            if (p1.length() <= this.maxDist) break;
        }
        list.push(p1);
        
        // 3. Generate P2 to P_{num-1} using candidate scoring
        for (let i = 2; i < num; i++) {
            const prev = list[i - 1];
            const prevPrev = list[i - 2];
            const D_in = new THREE.Vector3().subVectors(prev, prevPrev).normalize();
            
            let bestPoint = null;
            let bestScore = -Infinity;
            
            for (let j = 0; j < 100; j++) {
                // Step lengths are > 1/3 of the cell area (which is 0.6 to 0.9)
                const stepLength = 0.6 + Math.random() * 0.3;
                const randVec = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
                
                const proposedDir = new THREE.Vector3()
                    .addScaledVector(D_in, 0.5)
                    .addScaledVector(randVec, 0.5)
                    .normalize();
                    
                const biasedDir = this.enforceBias(prev, proposedDir);
                const p_proposed = new THREE.Vector3().addVectors(prev, biasedDir.clone().multiplyScalar(stepLength));
                
                if (p_proposed.length() > this.maxDist) {
                    p_proposed.normalize().multiplyScalar(this.maxDist);
                }
                
                let score = 0;
                
                // Spacing constraint (reverted to 0.55)
                const dist = p_proposed.distanceTo(prev);
                if (dist < 0.55) score -= 100;
                
                // Camera-projected turn angle constraint (only penalize dot < -0.85, do not reward going straight)
                const vCam = this.getCameraViewDir(camera);
                const dOut3d = new THREE.Vector3().subVectors(p_proposed, prev).normalize();
                const projIn = D_in.clone().addScaledVector(vCam, -D_in.dot(vCam));
                const projOut = dOut3d.clone().addScaledVector(vCam, -dOut3d.dot(vCam));
                
                const lenIn = projIn.length();
                const lenOut = projOut.length();
                
                if (lenIn > 0.1 && lenOut > 0.1) {
                    projIn.divideScalar(lenIn);
                    projOut.divideScalar(lenOut);
                    const dot = projIn.dot(projOut);
                    if (dot < -0.85) {
                        score -= 500 * (-0.85 - dot);
                    }
                }
                
                // 3D forward momentum (only penalize complete backing up, do not reward going straight)
                const dot3d = dOut3d.dot(D_in);
                if (dot3d < 0.0) {
                    score -= 200 * (-dot3d);
                }
                
                // Steering / Proportional Center-pull (loosened to pull only when far out)
                const distToCenter = p_proposed.length();
                if (distToCenter > 0.95) {
                    const toCenter = p_proposed.clone().negate().normalize();
                    score += 15 * dOut3d.dot(toCenter) * (distToCenter - 0.95);
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestPoint = p_proposed.clone();
                }
            }
            
            if (!bestPoint) {
                bestPoint = new THREE.Vector3().addVectors(prev, D_in.clone().multiplyScalar(0.65));
                if (bestPoint.length() > this.maxDist) {
                    bestPoint.normalize().multiplyScalar(this.maxDist);
                }
            }
            
            list.push(bestPoint);
        }
        return list;
    }

    createSegment(pA, pB, tA, tB) {
        const V = new THREE.Vector3().subVectors(pB, pA);
        const L = V.length();
        const V_dir = V.clone().normalize();
        
        // Restrict tangents to point more forward along the chord (at most 60° angle)
        const tA_adj = tA.clone();
        if (tA_adj.dot(V_dir) < 0.55) {
            tA_adj.addScaledVector(V_dir, 0.55 - tA_adj.dot(V_dir)).normalize();
        }
        
        const tB_adj = tB.clone();
        if (tB_adj.dot(V_dir) < 0.55) {
            tB_adj.addScaledVector(V_dir, 0.55 - tB_adj.dot(V_dir)).normalize();
        }
        
        // Mathematically optimal Bezier handle lengths for approximating circular arcs
        const dotA = tA_adj.dot(V_dir);
        const dotB = tB_adj.dot(V_dir);
        
        const dA = (L / 3.0) * (2.0 / (1.0 + dotA));
        const dB = (L / 3.0) * (2.0 / (1.0 + dotB));
        
        const c1 = new THREE.Vector3().addVectors(pA, tA_adj.clone().multiplyScalar(dA));
        const c2 = new THREE.Vector3().subVectors(pB, tB_adj.clone().multiplyScalar(dB));
        
        return { p0: pA.clone(), c1, c2, p1: pB.clone() };
    }

    evaluateBezier(seg, t) {
        const mt = 1.0 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;
        
        const pos = new THREE.Vector3()
            .addScaledVector(seg.p0, mt3)
            .addScaledVector(seg.c1, 3.0 * mt2 * t)
            .addScaledVector(seg.c2, 3.0 * mt * t2)
            .addScaledVector(seg.p1, t3);
            
        const tangent = new THREE.Vector3()
            .addScaledVector(seg.c1.clone().sub(seg.p0), 3.0 * mt2)
            .addScaledVector(seg.c2.clone().sub(seg.c1), 6.0 * mt * t)
            .addScaledVector(seg.p1.clone().sub(seg.c2), 3.0 * t2);
            
        return { pos, tangent: tangent.normalize() };
    }

    sampleSpline(s, camera) {
        const segIndex = Math.max(0, Math.min(this.segments.length - 1, Math.floor(s)));
        const t = Math.max(0.0, Math.min(1.0, s - segIndex));
        const seg = this.segments[segIndex];
        const result = this.evaluateBezier(seg, t);
        
        // Calculate normal orthogonal to both tangent and camera view direction
        const planeNormal = this.getCameraViewDir(camera);
        
        const normal = StrokeRenderer.calculateBillboardNormal(result.tangent, planeNormal);
        return { pos: result.pos, normal };
    }

    extendSpline(camera) {
        const num = this.anchors.length;
        const pLast = this.anchors[num - 1];
        const pPrev = this.anchors[num - 2];
        const D_in = new THREE.Vector3().subVectors(pLast, pPrev).normalize();
        
        let bestPoint = null;
        let bestDir = null;
        let bestScore = -Infinity;
        
        for (let i = 0; i < 100; i++) {
            // Step lengths are > 1/3 of the cell area (which is 0.6 to 0.9)
            const stepLength = 0.6 + Math.random() * 0.3;
            const randVec = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            
            const proposedDir = new THREE.Vector3()
                .addScaledVector(D_in, 0.5)
                .addScaledVector(randVec, 0.5)
                .normalize();
                
            const biasedDir = this.enforceBias(pLast, proposedDir);
            const p_proposed = new THREE.Vector3().addVectors(pLast, biasedDir.clone().multiplyScalar(stepLength));
            
            if (p_proposed.length() > this.maxDist) {
                p_proposed.normalize().multiplyScalar(this.maxDist);
            }
            
            let score = 0;
            
            // Spacing constraint (reverted to 0.55)
            const dist = p_proposed.distanceTo(pLast);
            if (dist < 0.55) score -= 100;
            
            // Camera-projected turn angle constraint (only penalize dot < -0.85, do not reward going straight)
            const vCam = this.getCameraViewDir(camera);
            const dOut3d = new THREE.Vector3().subVectors(p_proposed, pLast).normalize();
            const projIn = D_in.clone().addScaledVector(vCam, -D_in.dot(vCam));
            const projOut = dOut3d.clone().addScaledVector(vCam, -dOut3d.dot(vCam));
            
            const lenIn = projIn.length();
            const lenOut = projOut.length();
            
            if (lenIn > 0.1 && lenOut > 0.1) {
                projIn.divideScalar(lenIn);
                projOut.divideScalar(lenOut);
                const dot = projIn.dot(projOut);
                if (dot < -0.85) {
                    score -= 500 * (-0.85 - dot);
                }
            }
            
            // 3D forward momentum (only penalize complete backing up, do not reward going straight)
            const dot3d = dOut3d.dot(D_in);
            if (dot3d < 0.0) {
                score -= 200 * (-dot3d);
            }
            
            // Steering / Proportional Center-pull (loosened to pull only when far out)
            const distToCenter = p_proposed.length();
            if (distToCenter > 0.95) {
                const toCenter = p_proposed.clone().negate().normalize();
                score += 15 * dOut3d.dot(toCenter) * (distToCenter - 0.95);
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestPoint = p_proposed.clone();
                bestDir = dOut3d.clone();
            }
        }
        
        if (!bestPoint) {
            bestDir = D_in.clone();
            bestPoint = new THREE.Vector3().addVectors(pLast, bestDir.clone().multiplyScalar(0.65));
            if (bestPoint.length() > this.maxDist) {
                bestPoint.normalize().multiplyScalar(this.maxDist);
            }
        }
        
        this.anchors.push(bestPoint);
        this.tangents.push(bestDir);
        
        // Update smooth tangent at P_{num-1} (using new PNext)
        this.tangents[num - 1] = this.computeSmoothTangent(this.anchors[num - 2], this.anchors[num - 1], bestPoint);
        
        // Recompute segment num - 2 (from P_{num-2} to P_{num-1}) with updated tangent
        this.segments[num - 2] = this.createSegment(this.anchors[num - 2], this.anchors[num - 1], this.tangents[num - 2], this.tangents[num - 1]);
        
        // Compute new segment num - 1 (from P_{num-1} to PNext)
        const newSeg = this.createSegment(this.anchors[num - 1], this.anchors[num], this.tangents[num - 1], this.tangents[num]);
        this.segments.push(newSeg);
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
        
        // Calculate safe local width values to avoid self-intersection
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
        this.renderer = new StrokeRenderer(this.strokeDef, this.group, null, this.colorA, this.colorB, 'u');
    }

    update(time, dt, camera) {
        if (this.renderer) {
            // Keep reference to camera
            if (camera && !this.camera) {
                this.camera = camera;
            }
            
            // Continuous spin of the group around its random rotation axis
            this.group.rotateOnAxis(this.rotationAxis, this.rotationSpeed * dt);
            
            // Advance head and tail parameters
            this.headS += this.flowSpeed * dt;
            this.tailS = this.headS - this.strokeLength;
            
            // Once the head reaches strokeLength + 1, the tail is at 1.0 (completely off Segment 0).
            // We can now safely extend the spline and shift segments.
            if (this.headS >= this.strokeLength + 1.0) {
                this.extendSpline(camera);
                
                // Shift segment list and anchors to keep exactly strokeLength + 2 segments in memory
                this.segments.shift();
                this.anchors.shift();
                this.tangents.shift();
                
                this.headS -= 1.0;
                this.tailS -= 1.0;
            }
            
            // Sample the active stroke along the spline
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
            
            // Calculate safety limits for each segment to prevent inner-edge overlaps
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
