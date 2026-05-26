export class StrokeDef {
    constructor(vertices, widths, normals) {
        this.vertices = vertices; // array of THREE.Vector3
        this.widths = widths;     // array of numbers (width at each vertex)
        this.normals = normals;   // array of THREE.Vector3 (normal direction at each vertex)
    }
}
