import * as THREE from 'three';
import { StrokeDef } from './StrokeDef.js';

export class StrokeGenerator {
    /**
     * Curvature-biased path resampling algorithm.
     * Allocates more points where the curve is bending sharply, and fewer on straight sections.
     * @param {THREE.Vector3[]} highResPoints - Input high-resolution path
     * @param {number} targetCount - Output target number of vertices (must be <= 200)
     * @returns {THREE.Vector3[]} Resampled path vertices
     */
    static resampleByCurvature(highResPoints, targetCount) {
        const n = highResPoints.length;
        if (n <= targetCount) return highResPoints;

        // 1. Calculate tangents and local curvature angle (delta radians between successive tangents)
        const tangents = [];
        for (let i = 0; i < n - 1; i++) {
            tangents.push(new THREE.Vector3().subVectors(highResPoints[i + 1], highResPoints[i]).normalize());
        }

        const curvatures = new Float32Array(n);
        curvatures[0] = 0.0;
        curvatures[n - 1] = 0.0;
        for (let i = 1; i < n - 1; i++) {
            const dot = THREE.MathUtils.clamp(tangents[i - 1].dot(tangents[i]), -1.0, 1.0);
            curvatures[i] = Math.acos(dot); // Angle in radians representing local bending
        }

        // 2. Compute weights: local curvature + constant bias (to ensure straight sections still get vertices)
        const weights = new Float32Array(n);
        const epsilon = 0.08; // Sampling bias for straight sections
        for (let i = 0; i < n; i++) {
            weights[i] = curvatures[i] + epsilon;
        }

        // 3. Construct the cumulative distribution function (CDF) along the arc length
        const cdf = new Float32Array(n);
        cdf[0] = 0.0;
        for (let i = 1; i < n; i++) {
            const segDist = highResPoints[i].distanceTo(highResPoints[i - 1]);
            const avgWeight = (weights[i] + weights[i - 1]) / 2.0;
            cdf[i] = cdf[i - 1] + segDist * avgWeight;
        }

        const totalCdf = cdf[n - 1];
        if (totalCdf < 0.0001) {
            // Fallback to uniform indexing if the path length is negligible
            const resampled = [];
            for (let j = 0; j < targetCount; j++) {
                const idx = Math.floor((j / (targetCount - 1)) * (n - 1));
                resampled.push(highResPoints[idx].clone());
            }
            return resampled;
        }

        // 4. Sample targetCount vertices by interpolating across the curvature-biased CDF
        const resampled = [];
        resampled.push(highResPoints[0].clone()); // Start point

        for (let j = 1; j < targetCount - 1; j++) {
            const targetVal = (j / (targetCount - 1)) * totalCdf;

            // Binary search to find containing segment in the CDF
            let low = 0;
            let high = n - 1;
            while (low < high - 1) {
                const mid = (low + high) >> 1;
                if (cdf[mid] < targetVal) {
                    low = mid;
                } else {
                    high = mid;
                }
            }

            // Linearly interpolate coordinates between the two high-resolution bounds
            const t = (targetVal - cdf[low]) / (cdf[high] - cdf[low]);
            const p = new THREE.Vector3().lerpVectors(highResPoints[low], highResPoints[high], t);
            resampled.push(p);
        }

        resampled.push(highResPoints[n - 1].clone()); // End point
        return resampled;
    }

    /**
     * Generates a random continuous cubic Bezier curve with C1 continuity and curvature-based resampling.
     * @param {number} numSegments - Number of continuous Bezier segments
     * @param {number} pointsPerSegment - Initial sampling density per segment
     * @returns {StrokeDef}
     */
    static randomBezier(numSegments = 4, pointsPerSegment = 80) {
        const controlPoints = [];

        // Random starting position scattered more widely in space
        let pLast = new THREE.Vector3(
            (Math.random() - 0.5) * 7.0,
            (Math.random() - 0.5) * 7.0,
            (Math.random() - 0.5) * 4.0
        );

        // A local target center for this specific stroke so they are spread out rather than coming from the same center
        const localTarget = new THREE.Vector3(
            (Math.random() - 0.5) * 3.0,
            (Math.random() - 0.5) * 3.0,
            (Math.random() - 0.5) * 1.5
        );
        
        // Initial random direction vector with length defining segment scale
        let dirLast = new THREE.Vector3(
            (Math.random() - 0.5),
            (Math.random() - 0.5),
            (Math.random() - 0.5)
        ).normalize().multiplyScalar(1.0 + Math.random() * 0.8);

        for (let s = 0; s < numSegments; s++) {
            let p0, p1, p2, p3;

            if (s === 0) {
                p0 = pLast.clone();
                p1 = p0.clone().add(dirLast);
            } else {
                p0 = controlPoints[controlPoints.length - 1].clone();
                const prevP2 = controlPoints[controlPoints.length - 2];
                p1 = p0.clone().add(p0.clone().sub(prevP2));
                dirLast.subVectors(p1, p0);
            }

            const steerP2 = localTarget.clone().sub(p1).normalize().multiplyScalar(0.2);
            const blendedDirP2 = dirLast.clone().normalize().add(steerP2).normalize();
            
            const randVec1 = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            const perp1 = new THREE.Vector3().crossVectors(blendedDirP2, randVec1).normalize();
            const perturbedDirP2 = blendedDirP2.addScaledVector(perp1, 0.45).normalize().multiplyScalar(dirLast.length());

            p2 = p1.clone().add(perturbedDirP2);

            const steerP3 = localTarget.clone().sub(p2).normalize().multiplyScalar(0.2);
            const blendedDirP3 = perturbedDirP2.clone().normalize().add(steerP3).normalize();
            
            const randVec2 = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            const perp2 = new THREE.Vector3().crossVectors(blendedDirP3, randVec2).normalize();
            const perturbedDirP3 = blendedDirP3.addScaledVector(perp2, 0.45).normalize().multiplyScalar(dirLast.length());

            p3 = p2.clone().add(perturbedDirP3);

            controlPoints.push(p0, p1, p2, p3);
        }

        // 1. Generate high-resolution point array along the cubic Bezier path
        const highResVertices = [];
        for (let s = 0; s < numSegments; s++) {
            const p0 = controlPoints[s * 4];
            const p1 = controlPoints[s * 4 + 1];
            const p2 = controlPoints[s * 4 + 2];
            const p3 = controlPoints[s * 4 + 3];

            const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
            const startIdx = (s === 0) ? 0 : 1;
            for (let j = startIdx; j <= pointsPerSegment; j++) {
                const t = j / pointsPerSegment;
                highResVertices.push(curve.getPoint(t));
            }
        }

        // 2. Perform smart curvature-biased resampling down to 120 points
        const vertices = this.resampleByCurvature(highResVertices, 120);

        // 3. Generate dynamic width and normal profile based on resampled indexing
        const widths = [];
        const normals = [];
        const totalPoints = vertices.length;
        for (let i = 0; i < totalPoints; i++) {
            const u = i / (totalPoints - 1);
            const baseWidth = 0.2 + 0.15 * Math.sin(u * Math.PI) + 0.05 * Math.sin(u * Math.PI * 4);
            widths.push(baseWidth);

            const pNext = vertices[Math.min(i + 1, totalPoints - 1)];
            const pPrev = vertices[Math.max(0, i - 1)];
            const tangent = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
            let up = new THREE.Vector3(0, 1, 0);
            if (Math.abs(tangent.dot(up)) > 0.99) {
                up.set(1, 0, 0);
            }
            const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();
            normals.push(normal);
        }

        return new StrokeDef(vertices, widths, normals);
    }

    /**
     * Generates a 3D spiral (helix) with organic tapering, random dimensions, and curvature resampling.
     * @param {number} turns - Number of full helical loops
     * @param {boolean} orthogonal - Whether the ribbon extrusion direction is orthogonal (true) or parallel (false) to the center axis
     * @returns {StrokeDef}
     */
    static spiral(turns = 3, orthogonal = false) {
        const highResVertices = [];
        const highResPointsCount = 360; // High resolution sampling density
        
        const startRadius = 0.3 + Math.random() * 0.8;
        const endRadius = 1.2 + Math.random() * 1.5;
        const height = 3.0 + Math.random() * 3.5;
        const startAngle = Math.random() * Math.PI * 2;
        const direction = Math.random() > 0.5 ? 1 : -1;
        
        const center = new THREE.Vector3(
            (Math.random() - 0.5) * 6.0,
            (Math.random() - 0.5) * 6.0,
            (Math.random() - 0.5) * 3.0
        );

        for (let i = 0; i < highResPointsCount; i++) {
            const t = i / (highResPointsCount - 1);
            const angle = startAngle + t * turns * Math.PI * 2 * direction;
            const r = THREE.MathUtils.lerp(startRadius, endRadius, t);
            
            const x = center.x + r * Math.cos(angle);
            const y = center.y + (t - 0.5) * height;
            const z = center.z + r * Math.sin(angle);
            
            highResVertices.push(new THREE.Vector3(x, y, z));
        }

        // Curvature resampling to place more vertices where the spiral wraps
        const vertices = this.resampleByCurvature(highResVertices, 120);

        const widths = [];
        const normals = [];
        const totalPoints = vertices.length;
        for (let i = 0; i < totalPoints; i++) {
            const u = i / (totalPoints - 1);
            const baseWidth = 0.2 + 0.15 * Math.sin(u * Math.PI) + 0.05 * Math.sin(u * Math.PI * 4);
            widths.push(baseWidth);

            const v = vertices[i];
            const outward = new THREE.Vector3(v.x - center.x, 0, v.z - center.z).normalize();
            let normal;
            if (orthogonal) {
                normal = outward;
            } else {
                const pNext = vertices[Math.min(i + 1, totalPoints - 1)];
                const pPrev = vertices[Math.max(0, i - 1)];
                const tangent = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
                normal = new THREE.Vector3().crossVectors(tangent, outward).normalize();
            }
            normals.push(normal);
        }

        return new StrokeDef(vertices, widths, normals);
    }

    /**
     * Generates a smooth, geometric 3D zigzag (straight segments and circular turns) with curvature resampling.
     * @param {number} numPeriods - Number of wave periods
     * @param {number} [lStraight] - Length of the straight segment
     * @param {number} [r] - Radius of the circular turns
     * @param {number} [theta] - Sweep angle of the circular turns (in radians)
     * @returns {StrokeDef}
     */
    static zigzag(numPeriods = 2.5, lStraight, r, theta) {
        const highResVertices = [];
        const highResPointsCount = 360;
        
        if (numPeriods === undefined) numPeriods = 1.5 + Math.random() * 2.5;
        if (r === undefined) r = 1.0 + Math.random() * 1.5;
        
        if (lStraight === undefined && theta === undefined) {
            const ratio_l = 0.5 + Math.random() * 4.5;
            // Interpolate minimum angle from 45 degrees (at ratio_l = 1.0) to 120 degrees (at ratio_l = 4.0)
            const minTheta = Math.PI / 4 + Math.max(0, Math.min(1, (ratio_l - 1.0) / 3.0)) * (Math.PI * 2 / 3 - Math.PI / 4);
            theta = minTheta + Math.random() * (Math.PI * 0.9 - minTheta);
            lStraight = r * ratio_l;
        } else {
            if (lStraight === undefined) lStraight = r * (0.5 + Math.random() * 4.5);
            if (theta === undefined) theta = (Math.PI / 4) + Math.random() * (Math.PI * 0.65);
        }
        
        const alpha = theta / 2;
        
        const start = new THREE.Vector3(
            (Math.random() - 0.5) * 6.0,
            (Math.random() - 0.5) * 6.0,
            (Math.random() - 0.5) * 3.0
        );
        
        const direction = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        ).normalize();
        
        let upVec = new THREE.Vector3(0, 1, 0);
        if (Math.abs(direction.dot(upVec)) > 0.9) {
            upVec.set(1, 0, 0);
        }
        const oscAxis = new THREE.Vector3().crossVectors(direction, upVec).normalize();
        const planeNormal = new THREE.Vector3().crossVectors(direction, oscAxis).normalize();

        const segments = [];
        let currentPos = new THREE.Vector2(0, 0);
        
        for (let p = 0; p < numPeriods; p++) {
            const p0 = currentPos.clone();
            currentPos.x += lStraight * Math.cos(alpha);
            currentPos.y += lStraight * Math.sin(alpha);
            const p1 = currentPos.clone();
            
            const center1 = new THREE.Vector2(
                p1.x + r * Math.sin(alpha),
                p1.y - r * Math.cos(alpha)
            );
            const startAngle1 = alpha + Math.PI / 2;
            currentPos.x = center1.x + r * Math.cos(-alpha + Math.PI / 2);
            currentPos.y = center1.y + r * Math.sin(-alpha + Math.PI / 2);
            const p2 = currentPos.clone();
            
            currentPos.x += lStraight * Math.cos(-alpha);
            currentPos.y += lStraight * Math.sin(-alpha);
            const p3 = currentPos.clone();
            
            const center2 = new THREE.Vector2(
                p3.x + r * Math.sin(alpha),
                p3.y + r * Math.cos(alpha)
            );
            const startAngle2 = -alpha - Math.PI / 2;
            currentPos.x = center2.x + r * Math.cos(alpha - Math.PI / 2);
            currentPos.y = center2.y + r * Math.sin(alpha - Math.PI / 2);
            const p4 = currentPos.clone();
            
            segments.push({ type: 'straight', start: p0, end: p1, angle: alpha, length: lStraight });
            segments.push({ type: 'arc', center: center1, startAngle: startAngle1, dir: -1, length: theta * r, r: r });
            segments.push({ type: 'straight', start: p2, end: p3, angle: -alpha, length: lStraight });
            segments.push({ type: 'arc', center: center2, startAngle: startAngle2, dir: 1, length: theta * r, r: r });
        }

        const totalLength = segments.reduce((sum, seg) => sum + seg.length, 0);

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
            const s = (i / (highResPointsCount - 1)) * totalLength;
            const p2d = getPointOnSegments(s);
            const p3d = start.clone()
                .addScaledVector(direction, p2d.x)
                .addScaledVector(oscAxis, p2d.y);
            highResVertices.push(p3d);
        }

        // Curvature resampling to focus vertices on the peaks/bends of the wave
        const vertices = this.resampleByCurvature(highResVertices, 120);

        const widths = [];
        const normals = [];
        const totalPoints = vertices.length;
        for (let i = 0; i < totalPoints; i++) {
            const u = i / (totalPoints - 1);
            const baseWidth = 0.2 + 0.15 * Math.sin(u * Math.PI) + 0.05 * Math.sin(u * Math.PI * 4);
            widths.push(baseWidth);

            const pNext = vertices[Math.min(i + 1, totalPoints - 1)];
            const pPrev = vertices[Math.max(0, i - 1)];
            const tangent = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
            const normal = new THREE.Vector3().crossVectors(tangent, planeNormal).normalize();
            normals.push(normal);
        }

        return new StrokeDef(vertices, widths, normals);
    }
}
