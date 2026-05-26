import * as THREE from 'three';

/**
 * Builds a flat disc geometry with UV coordinates that project the
 * cone/cylinder side texture onto the cap.
 *
 * uv.x = normalized angle (0→1, matches the side's phi direction)
 * uv.y = interpolated between uvYCenter (disc centre) and uvYEdge (disc rim)
 *
 * @param {number} radius      - disc radius
 * @param {number} yPos        - Y position of the flat disc
 * @param {number} segments    - angular resolution (recommend 64)
 * @param {number} rings       - radial rings (recommend 8 for smooth noise)
 * @param {number} uvYEdge     - uv.y at the outer rim  (should match the side's v_axis there)
 * @param {number} uvYCenter   - uv.y at the centre     (projects inward)
 */
export function buildCapGeometry(radius, yPos, segments, rings, uvYEdge, uvYCenter) {
    const positions = [];
    const uvs       = [];
    const indices   = [];

    for (let ri = 0; ri <= rings; ri++) {
        const rn  = ri / rings;                              // 0 = centre, 1 = rim
        const r   = rn * radius;
        const uvY = uvYCenter + (uvYEdge - uvYCenter) * rn; // lerp centre→rim

        for (let si = 0; si <= segments; si++) {
            const u   = si / segments;
            const phi = u * Math.PI * 2;
            positions.push(r * Math.cos(phi), yPos, r * Math.sin(phi));
            uvs.push(u, uvY);
        }
    }

    // Quad grid as two triangles per cell
    for (let ri = 0; ri < rings; ri++) {
        for (let si = 0; si < segments; si++) {
            const a = ri * (segments + 1) + si;
            const b = a + 1;
            const c = a + (segments + 1);
            const d = c + 1;
            indices.push(a, c, b);
            indices.push(b, c, d);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}
