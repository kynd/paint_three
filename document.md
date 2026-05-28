# Strokes 3D Engine - API Interface Documentation

This document describes the public interface and responsibilities for the core components of the Strokes 3D Engine: **Stroke Definitions**, **Renderers**, and **Animators**.

---

## 1. Core Definition (`js/core/`)

### `StrokeDef`
Represents the geometric metadata of a single procedural stroke.
- **Properties**:
  - `vertices` (`THREE.Vector3[]`): Array of positions along the stroke path.
  - `widths` (`number[]`): Width values corresponding to each vertex.
  - `normals` (`THREE.Vector3[]`): Custom normal direction vectors at each vertex. The direction of these normal vectors directly determines the extrusion direction of the ribbon in the shader.

### `StrokeGenerator`
Helper class containing static procedural path generation and sampling utilities.
- **Static Methods**:
  - `resampleByCurvature(highResPoints, targetCount)`: Returns a curvature-biased resampled array of points, allocating more density to sharp bends.
  - `randomBezier(numSegments, pointsPerSegment)`: Generates a new `StrokeDef` representing a continuous C1 Bezier spline. Normals are calculated as perpendicular to the curve tangent.
  - `spiral(turns, orthogonal)`: Generates a new `StrokeDef` representing a 3D helix.
    - If `orthogonal` is true, normals point radially outwards.
    - If `orthogonal` is false, normals are computed as `cross(tangent, outward_direction)` to align the ribbon's surface parallel to the center axis.
  - `zigzag(numPeriods, lStraight, r, theta)`: Generates a new `StrokeDef` representing a geometric zigzag curve composed of alternating straight segments of length `lStraight` and circular turning arcs of radius `r` sweeping angle `theta` in alternating directions. **Normals** are computed as `cross(tangent, planeNormal)` to lie in the oscillation plane, causing the ribbon stroke to lie completely flat on the plane of the zigzag.
  - **Geometric Parametric Ranges & Constraints**: `numPeriods` is randomized in `[1.5, 4.0)` (ensuring at least 3 turns). `r` is randomized in `[1.0, 2.5)`. `lStraight` and `theta` are dynamically related: when the straight part ratio `lStraight/r` is longer, the minimum sweep angle is constrained to be larger (up to `120°`), ensuring the folds stay tightly spaced and visible in the grid cell. When the straight part is shorter, the angle can range freely down to `45°`.

---

## 2. Helpers (`js/helpers/`)

### `easing.js`
Provides easing and interpolation utilities. Exported via the `tween` singleton.
- **Methods**:
  - `linear(t)`, `powerIn(t, a)`, `powerOut(t, a)`, `powerInOut(t, a)`, `sineIn(t)`, `sineOut(t)`, `sineInOut(t)`, `circularIn(t)`, `circularOut(t)`, `circularInOut(t)`.
  - `createCubicBezier(a, b, resolution)`: Returns a customized Cubic Bezier easing function.

### `navigation.js`
Custom header navigation DOM generator.
- **Items**:
  - `Stroke Gallery` (points to `index.html`)
  - `Primitives` (points to `primitives.html`)
  - `Documentation` (opens an in-page documentation overlay)

---

## 3. Renderers (`js/renderers/`)

### `StrokeRenderer`
Builds and manages the WebGL mesh representation of a `StrokeDef` using custom shader materials.
- **Static Properties**:
  - `defaultTexture` (`THREE.Texture | null`): Fallback texture applied to new instances.
  - `defaultTextureRepeat` (`number`): Fallback U-axis repeat factor.
  - `defaultTextureThreshold` (`number`): Fallback alpha discard threshold.
  - `defaultNoiseMode` (`number | null`): Fallback noise mode (`null` = Auto, `0` = Off, `1` = Raw, `2` = Brush U, `3` = Brush V).
  - `defaultNoiseScale`, `defaultNoiseOctaves`, `defaultNoiseSpeed`: Fallback noise parameters.
  - `defaultCapStyle` (`string`): Fallback cap style (`'rounded'`, `'square'`, or `'ragged'`).
  - `dummyTexture` (`THREE.CanvasTexture`): A 1×1 white canvas texture used as a placeholder to avoid WebGL warnings when no texture is active.
- **Instance Properties**:
  - `strokeDef` (`StrokeDef`): The source geometry definition.
  - `scene` (`THREE.Scene | THREE.Group`): Parent container.
  - `isRounded` (`boolean`): True when cap style is `'rounded'`.
  - `isRagged` (`boolean`): True when cap style is `'ragged'`.
  - `colorA` / `colorB` (`THREE.Color`): End-to-end gradient colors.
  - `gradientDirection` (`string`): `'u'` (longitudinal gradient along the stroke path length) or `'v'` (transverse gradient across the stroke width).
  - `mesh` (`THREE.Mesh`): Instantiated Three.js Mesh.
- **Cap Styles**:
  - `'rounded'`: Circular capsule end-caps; pixels outside the hemisphere radius are discarded in the fragment shader.
  - `'square'`: Flat ends with no special clipping.
  - `'ragged'`: Bristle-like ends produced by a layered sine/noise discard pattern, simulating a paint-brush tip.
- **Methods**:
  - `buildGeometry()`: Prepares the shaders, allocates uniforms, and instantiates the mesh. The vertex shader performs ribbon extrusion directly along the interpolated `uNormal` uniform array. The material is configured as fully opaque with `depthWrite: true` and `depthTest: true` to prevent depth-sorting and clipping artifacts, while end-caps are processed using `discard` commands in the fragment shader.
  - `updatePath(vertices, normals, widths, time)`: Dynamically pushes updated vertex positions, normal vectors, width values, and elapsed time to the GPU. When widths change, the `Float32Array` slice is re-assigned to force Three.js to re-upload the uniform.
  - `updateTexture(texture, repeat, threshold)`: Swaps the active brush texture and its repeat/threshold parameters on the live material.
  - `updateNoiseMode(mode)`: Changes the procedural noise mode (`0`–`3`) on the live material.
  - `updateCapStyle(style)`: Switches cap style on the live material and recalculates `uCapStart`/`uCapEnd` uniforms from the current path length.
  - `static calculateBillboardNormal(tangent, toCamera)`: Computes a camera-facing normal by projecting the tangent onto the camera plane and taking the cross product with the view direction.
  - `destroy()`: Disposes of the geometry, material, and removes the mesh from the scene.
- **Shader Noise System**: The fragment shader contains a 3D value noise implementation with Hermite interpolation. It supports four modes selectable via the `uNoiseMode` uniform:
  - `0` – Off: plain gradient between `colorA` and `colorB`.
  - `1` – Raw Noise: outputs the turbulence RGB directly as the final color.
  - `2` – Brush U: perturbs the longitudinal UV blend coordinate with noise before mixing the two gradient colors.
  - `3` – Brush V: perturbs the transverse UV blend coordinate with noise before mixing the two gradient colors.

---

## 4. Animators (`js/animators/`)

### `StrokeAnimator` (Superclass)
Base class handling lifecycle, scaling, and update loops for dynamic procedural strokes.
- **Properties**:
  - `group` (`THREE.Group`): Parent Three.js group container.
  - `colorA` / `colorB` (`THREE.Color`): Color gradients for the stroke renderer.
  - `strokeDef` (`StrokeDef`): The underlying path geometry definition.
  - `renderer` (`StrokeRenderer`): The assigned renderer.
  - `scaleFactor` (`number`): The computed scaling factor used to normalize coordinates to fit the grid cell.
- **Methods**:
  - `init()`: (Abstract) Reserves setup and configures renderer.
  - `centerAndNormalize(boxLimit)`: Centers the stroke path and scales the vertices by `scaleFactor` to fit within a bounded, centered bounding box. The stroke widths are kept at their original values by default to maintain consistent thickness.
  - `update(time, dt, camera)`: (Abstract) Executed every frame to progress the animation. Optionally accepts the `camera` to dynamically align the stroke coordinates.
  - `destroy()`: Clean up the renderer mesh.

#### Subclass Variations:
- **`SpiralAnimator`**:
  - *Behavior*: Rotates a helical spiral around a randomized axis.
  - *Size Normalization*: Normalized to a larger boxLimit (`1.15`) to better fill out the cell space.
  - *3D Axis Orientation*: Randomizes the initial rotation on all 3D axes (X, Y, Z) so the spiral's helical axis points in a random direction.
  - *Easing and Cycle Controls*: Animates using cubic Bezier easing (`tween.createCubicBezier({x: 0.4, y: 0.0}, {x: 0.2, y: 1.0})`).
  - *Interface parameters*:
    1. `cycleDuration`: The duration of a cycle in seconds (randomized in `[2.0, 4.0)`).
    2. `rotationsPerCycle`: The number of full $360^\circ$ rotations completed per cycle, always larger than 1 (randomized in `[2, 3]`).
- **`BezierAnimator`**:
  - *Behavior*: Animates the stroke along a dynamic, infinitely growing cubic Bezier spline with C1 continuity. The group continuously spins around a randomized axis at a randomized speed (`[0.3, 2.0]` rad/sec).
  - *Flow Velocity*: Speed randomized in `[24.0, 48.0]`.
  - *Dynamic Flow & Extension (Glitch-Free)*: The active stroke spans a length of $N - 1$ segments, where $N$ is the number of points (anchors) randomized between 5 and 20 (constant for each instance's lifetime). It maintains $N+2$ segments and $N+3$ anchors in memory. The active stroke spans from $s_{\text{tail}}$ to $s_{\text{head}}$ (length $N-1$). When $s_{\text{head}} \ge N$, a new anchor is generated and Segment $N$ is finalized. Segment 0 (which the stroke tail has completely cleared) is then removed from memory.
  - **Dynamic Candidate Scoring Solver**: Anchor placement is calculated by generating 100 candidate directions per step and selecting the point with the highest score.
  - **Anchor Generation Scoring Weights**:
    1. *Spacing Constraint*: Candidates with distance to previous anchor $< 0.55$ are penalized.
    2. *Camera Projection Turn Angle*: Project onto the camera-plane. Projected internal angles too sharp (dot product $< -0.85$) receive a penalty. No straight-bias rewards are applied.
    3. *3D Forward Momentum*: Penalizes backward movement in 3D (dot product $< 0.0$). No straight-bias rewards are applied.
    4. *Steering / Proportional Center-pull*: Pulls back towards the origin only when distance to the center exceeds `0.95` with a weight of `15`.
    5. *Travel Distance (Step Length)*: Sized between `0.6` and `0.9` (which is $> 1/3$ of the cell area width of $1.8$), allowing larger, more prominent curves.
  - **Cubic Boundary Bias (`enforceBias`)**: A cubic scaling function $(\text{len}/\text{maxDist})^3$ is applied to the radial boundary clamp. The `maxDist` limit has been increased to `1.15` (from `0.9`), allowing the spline to expand further and occupy the outer boundaries of the grid cell.
  - **Outer Control Points placement**: The tangent at each anchor point $P_i$ is computed as the normalized sum of the unit incoming and outgoing chords:
    $$T_i = \frac{V_{\text{in}} + V_{\text{out}}}{\|V_{\text{in}} + V_{\text{out}}\|}$$
    This tangent direction is perpendicular to the inward angle bisector, placing the control points $C_{i-1, 2}$ and $C_{i, 1}$ symmetrically on the outer side of the angle to make the curves bulge smoothly outwards around bends.
  - **Optimal Control Point Distance**: To maximize smoothness (minimizing curvature variance) and approximate circular arcs, the handle length $d$ for each end of the segment is calculated using the mathematically optimal formula:
    $$d = \frac{L}{3} \cdot \frac{2}{1 + \cos(\alpha)}$$
    where $L$ is the segment chord length and $\cos(\alpha)$ is the dot product of the tangent vector and the chord direction vector. This provides maximum shape smoothness at zero performance cost.
  - **Dynamic Self-Intersection Avoidance (Local Tapering)**: At each frame, the local maximum safe width is calculated at every vertex $i$ along the sampled spline using the formula:
    $$w_{\text{safe}, i} = \frac{\Delta s_i}{\|(N_{i+1} - N_i) \cdot T_i\|}$$
    If the normal rotates too quickly relative to the curve direction, the local stroke width is dynamically tapered down to prevent the inner edge from overlapping itself, yielding a beautiful calligraphic effect.
  - **Stroke Width**: Randomized in `[0.025, 0.044]`.
  - **Longitudinal Gradient Direction**: Set to `'u'` to color the stroke along its path rather than across its width.
  - *Width Shading*: Extruded dynamically to prevent self-intersections. Normal vectors are dynamically calculated to stay orthogonal to the camera view vector.
- **`ZigzagAnimator`**:
  - *Behavior*: Reconstructs and propagates waves down an oscillating geometric zigzag path.
  - *Interface configuration*: The shape is parameterized by straight segment length `lStraight`, circular turning radius `r`, and sweep angle `theta`. On every frame tick, it shifts the sampling starting point by a phase-offset to propagate the wave, regenerating the vertices and scaling them by the cached `scaleFactor`.
  - **Adaptive Width Safeguard**: If the normalized turning radius in world space (`r * scaleFactor`) falls below the max half-width (`0.2`), it dynamically scales down the width array of that specific specimen to ensure zero self-intersection while keeping it as thick as mathematically possible.
  - *Orientation & Normal Alignment*: Dynamically projects the entire zigzag's plane of oscillation to remain orthogonal to the camera's viewing direction. The stroke normals lie flat in this camera-orthogonal plane, keeping the entire zigzag perfectly flat facing the viewport.
- **`ZigzagBezierAnimator`**:
  - *Behavior*: Hybrid flow animator that constructs curves using alternating circular turn arcs and straight lines with dynamically changing directions and lengths.
  - *Dynamic Segment Shifting*: Similar to the Bezier animator, it maintains $N+2$ segments in memory, flowing the active stroke across $N-1$ segments.
  - *Minimalist Point Count*: The point count $N$ is reduced to `[2, 5]` for a bold, structural look.
  - *Flow Velocity*: Speed randomized in `[6.0, 12.0]`.
  - *Elongated Straight Lengths*: The length of the straight sections is randomized in `[0.8, 1.6]`, creating long straight lines connected by compact turns.
  - *Turning Radius*: Each segment's arc radius is randomized in `[0.15, 0.35]`.
  - *Stroke Width*: Randomized in `[0.1, 0.175]`.
  - *Candidate-Scoring Solver*: Proposes next directions using a scoring solver with spacing constraints ($< 0.55$), camera turn angle constraints (dot $< -0.85$), 3D forward momentum, and relaxed center attraction ($> 0.95$) with `maxDist = 1.15`.
  - *Normals*: Generated dynamically to face the camera.
  - *Width Tapering*: Includes dynamic self-intersection tapering.
- **`LissajousAnimator`**:
  - *Behavior*: Formulates a 3D Lissajous curve in local coordinate coordinates.
  - *3D Parametric Equations*: Computes positions using distinct, non-integer frequencies along $x, y, z$ axes:
    $$x(t) = A_x \cos(\omega_x t)$$
    $$y(t) = A_y \sin(\omega_y t)$$
    $$z(t) = A_z \sin(\omega_z t)$$
  - *Continuous Drift*: Phase updates continuously (`u_head += speed * dt` where speed is randomized in `[1.5, 3.5]`) without looping or wrapping, causing the stroke to trace infinitely new non-repeating shapes at a faster, highly dynamic rate.
  - *Continuous 3D Spin*: Rotates continuously around a randomized local axis vector (`this.rotationAxis` at speed `this.rotationSpeed * dt`), and starts with a random 3D orientation.
  - *Z-Fighting Depth Recession*: Offsets vertices along the camera's local viewing vector based on age (newer segments are pushed forward, older segments pushed backward) to completely eliminate overlaps and rendering artifacts when the curve self-intersects.
  - *Local Billboard Normals*: Transforms the camera view vector into the group's local coordinate system to calculate accurate billboard normal orientations.
  - *Stroke Coverage*: Covers exactly one half of the Lissajous period ($\pi$).
  - *Dynamic Calligraphic Width Modulation*: Modulates stroke thickness along the curve using a periodic sine wave squared function with integer coefficient (`2.0`), scaling up to `0.5` (wider than spirals and zigzags) to produce perfectly continuous, non-popping thickness patterns across loop boundaries.
  - *Width Tapering*: Dynamic self-intersection tapering applied to prevent overlapping of loops.
- **`PhysicsAnimator`**:
  - *Behavior*: Simulates the motion of a single particle orbiting a moving gravity attractor.
  - *High Inertia*: Velocity damping set to `0.998` per physics sub-step (only 0.2% de-acceleration) to allow the particle to carry its inertia through wide orbits.
  - *Moving Attractor*: The gravity center smoothly lerps toward a randomly chosen target position, which changes on a 2-second interval and also immediately when the particle approaches within $3\times$ the stroke width, preventing collapses and creating dynamic orbiting orbits.
  - *Timestep Resolution & Sub-stepping*: Runs the Euler integration loop multiple times per frame (based on real-time `dt` relative to a fixed integration step of `0.004` seconds) to yield a highly resolved, smooth render path.
  - *Soft Gravity & Softening*: Gravity force is regularized by a softening factor $\epsilon = 0.15$ in the denominator to prevent infinite energy accumulation at close distances.
  - *Trace Length*: Traces a history of `360` vertices to produce long, intricate orbital loops.
  - *Normals & Tapering*: Includes camera billboard alignment and dynamic self-intersection tapering.
- **`CubeAnimator`**:
  - *Behavior*: Traces a stroke that flows continuously along the edges of a cube, with smooth rounded corners at each vertex. The cube spins around a randomized axis.
  - *Path Generation*: Builds a smooth path by walking randomly across cube vertices (each connected by its 3 neighbors), avoiding recently visited vertices. At each corner, a 90° circular arc of radius `cornerRadius` (randomized to `[0.2, 0.4] × 2`) replaces the sharp turn, blended seamlessly with straight edge segments.
  - *Infinite Flow*: Maintains 14 anchors in memory. The active stroke spans exactly 4 edge segments. When the head advances past 7 edge segment lengths, a new anchor is appended and the oldest is dropped, keeping the memory window constant.
  - *Flow Velocity*: Speed randomized in `[1.2, 5.6]` segments/second.
  - *3D Spin*: Continuously rotates around a randomized axis at speed `[0.45, 3.0]` rad/sec.
  - *Z-Fighting Depth Offset*: Offsets vertices slightly along the camera view vector proportional to their position along the stroke to prevent depth conflicts on self-crossing edges.
  - *Stroke Width*: Randomized in `[0.18, 0.26]`. No width tapering — ends are shaped purely by the GPU cap-style shader.
  - *Normals*: Camera billboard normals computed per vertex.

---

## 5. Primitive Animators (`js/animators/` — used by `primitives.html`)

All primitive animators share the same constructor signature: `(group, strokePaletteColors, camera, paintStyle)`. They pick 4 distinct random palette colours (`colorBase`, `colorX`, `colorY`, `colorZ`) and drive a `ShaderMaterial` with `uPaintStyle` (0–4).

### Paint Styles (all primitives)
| Value | Name | Description |
|-------|------|-------------|
| 0 | Spiral | Helical noise pattern tightening toward the apex/along the path |
| 1 | Horizontal Paint | Turbulence bands circling the object horizontally |
| 2 | Vertical Paint | 3-colour zones from base to top/tip (area-compensated where applicable) |
| 3 | Mix | Vertical zones as base, horizontal noise overpaints a 4th colour |
| 4 | Gradient | Seamless two-colour blend using the **fold** technique (see below) |

**Seam-free fold technique**: Circular coordinates (UV wrapping around a closed axis) use `fold(t) = 1 − |2t − 1|` instead of a linear 0→1 ramp. This maps to 0→1→0, so the seam where UV wraps is always value-matched and invisible.

### `SphereAnimator`
- Geometry: `THREE.SphereGeometry(radius, 64, 32)`. Radius `[0.55, 0.85]`.
- UV: `vUv.x` = longitude (φ), `vUv.y` = latitude (θ), `v_sphere = (1 − cos(θ·π)) / 2` (area-compensated height).
- Gradient: blends `colorBase → colorX` by `v_sphere`.

### `ConeAnimator`
- Geometry: `THREE.ConeGeometry(radius, height, 64, 32, true)` (open-ended). Radius `[0.42, 0.72]`, height `[0.9, 1.75]`.
- Cap: flat base disc via `buildCapGeometry`.
- UV: `vUv.x` = φ, `vUv.y = v_axis` (0 = base, 1 = tip). Vertical-paint zones area-compensated for taper.
- Gradient: blends `colorBase → colorX` by `v_axis`.

### `CylinderAnimator`
- Geometry: `THREE.CylinderGeometry(r, r, h, 64, 32, true)`. Radius `[0.32, 0.60]`, height `[0.8, 1.70]`.
- Caps: top and bottom discs via `buildCapGeometry`.
- UV: `vUv.x` = φ, `vUv.y = v_axis` (0 = bottom, 1 = top).
- Gradient: blends `colorBase → colorX` by `v_axis`.

### `TorusAnimator`
- Geometry: `THREE.TorusGeometry(majorR, tubeR, 24, 96)`. majorR `[0.38, 0.65]`, tubeR `[0.12, 0.28]`.
- UV: `vUv.x` = poloidal φ (around tube cross-section), `vUv.y` = toroidal φ (around big ring).
- **Seam fix**: All styles use `fv = fold(vUv.y)` for the toroidal z-coordinate in noise space; style 0 also uses `fu = fold(vUv.x)` for the poloidal z-coordinate. This eliminates the visible stripe seam.
- Gradient: blends `colorBase → colorX` by `fold(vUv.y)` (symmetric gradient around the big ring).

### `PyramidAnimator`
- Geometry: `THREE.ConeGeometry(radius, height, 4, 24, true)` (4 radial segments = square pyramid). Radius `[0.50, 0.80]`, height `[0.70, 1.35]`.
- Cap: square base via `buildCapGeometry(radius, −height/2, 4, 4, 0.0, 1.0)`.
- Shader: identical to `ConeAnimator`; φ wraps 4× per full rotation so each triangular face gets its own texture copy.
- Gradient: blends `colorBase → colorX` by `v_axis`.

### `TwistedTubeAnimator`
- Path: two C1-continuous cubic Bézier segments. C1 junction: `q1 = 2·p3 − p2` (reflection of p2 through p3). Control points randomized in `[−0.7, 0.7]` (XY) and `[−0.5, 0.5]` (Z).
- Geometry: `THREE.TubeGeometry(path, 120, tubeRadius, 32, false)`. tubeRadius `[0.08, 0.18]`.
- Twist uniform `uTwistTurns ∈ [1, 3]`: shifts the cross-section angle as `tphi = phi + v_axis · uTwistTurns · 2π`, making the noise pattern spiral along the path.
- Caps: solid-colour `THREE.CircleGeometry` discs at each path endpoint, oriented via `quaternion.setFromUnitVectors(+Z, tangent)`. Cap colour = `colorBase`.
- UV: `vUv.x` = around cross-section, `vUv.y = v_axis` (along path, 0→1, no wrap).
- Gradient: blends `colorBase → colorX` by `fold(vUv.x)` (symmetric across cross-section, seam-free).

---

## 6. Export Actions
- **`save png`**: Captures a snapshot of the current 3D viewport. Performs a manual render immediately before capture to preserve the WebGL buffer. The background color in the output matches the current scene clear color, which is kept in sync with the CSS background theme color via `renderer.setClearColor`.
- **`record video (16sec)`**: Records 16 seconds of real-time canvas animation. Uses `MediaRecorder` targeting high-quality WebM container formats (VP9/VP8) with automated browser fallback support. Updates the button text dynamically with a countdown timer during recording.

---

## 7. Mix Page (`mix.html` / `js/mix.js`)

Combines stroke and primitive animators in a single free-placement scene.

### Object placement
Objects are distributed randomly in the scene (`x ∈ [−6, 6]`, `y ∈ [−5, 5]`, `z ∈ [−1, 1]`). Each object's scale is drawn uniformly from `[sizeMin, sizeMax]`. No grid.

### Settings panel (two-column)
| Column | Contents |
|--------|----------|
| Left — Strokes | Checkboxes for Bezier, Spiral, Zigzag, Zigzag Bezier, Lissajous, Physics, Cube; then Textures, Noise Mode, Cap Style radio groups (same options as Stroke Gallery) |
| Right — Primitives | Checkboxes for Sphere, Cone, Cylinder, Torus, Pyramid, Twisted Tube, each with 5 paint-style sub-checkboxes |

Texture / Noise Mode / Cap Style changes are applied **in-place** to existing stroke renderers without rebuilding the scene.

### Layout controls (number steppers only)
- **Count** — `input[type=number]`, range `[2, 10]`, default 8. Rebuilds scene on change.
- **Min Size** — `input[type=number]`, range `[0.3, 3.0]`, step 0.1. Clamped to ≤ Max Size.
- **Max Size** — `input[type=number]`, range `[0.3, 3.0]`, step 0.1. Clamped to ≥ Min Size.

### Additional controls
- **Pause / Resume** — freezes animator updates while still rendering and accepting orbit input. Button text and `.active` style toggles with state.
- **Randomize Objects** — rebuilds the scene with a new random layout.
- **Randomize Color** — picks a new background color and reassigns palette colors to all existing animators **in-place** (no repositioning). Stroke animators: `colorA.fromArray()` / `colorB.fromArray()`. Primitive animators: all four `colorBase/X/Y/Z.fromArray()`; TwistedTubeAnimator caps additionally synced via `capStartMesh.material.color.copy()` / `capEndMesh.material.color.copy()`.
- **Save PNG** / **Record Video (16sec)** — same as other pages.

### Animator construction
- Stroke animators receive two random palette colors (`colorA`, `colorB`).
- Primitive animators receive the full palette array and a randomly selected enabled paint style.
- `StrokeRenderer` static defaults are set to solid texture, ragged caps, auto noise before any animators are constructed.
