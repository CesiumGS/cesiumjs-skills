# Iteration 001 -- Proposer Reasoning

## Hypotheses Applied

### H1: Widget cleanup in Viewer constructor
**Location:** "Applying Materials to Primitives" code example (lines ~69-84 in baseline)
**Change:** Replaced the implicit `viewer.scene.primitives.add(...)` example with a full example that constructs a `Viewer` with `animation: false, timeline: false, navigationHelpButton: false, navigationInstructionsInitiallyVisible: false`. This is the only section that references `viewer` without showing its construction, making it the natural injection point.
**Rationale:** Validated 4-0 on imagery skill. Generated code that creates a Viewer for material demos will now include widget cleanup by default, preventing the animation/timeline widgets from obscuring the material result.

### H2: Camera positioning for material demos
**Location:** Same "Applying Materials to Primitives" section, appended after the primitive is added.
**Change:** Added `viewer.camera.setView(...)` call with concrete destination over the rectangle geometry center (-95, 35) at 800km altitude with -60 degree pitch. Uses `setView` (not `flyTo`) per validated camera pattern.
**Rationale:** Without camera positioning, the default globe view may not show the rectangle with the material applied. This was a validated win (camera skill 3W/0L). The specific coordinates (-95, 35) are the center of the rectangle (-100,30 to -90,40) used in the example.

### H3: GLSL version gotcha for PostProcessStage
**Location:** "Custom PostProcessStage" section, as a blockquote before the code example.
**Change:** Added `> **Warning:**` callout explaining that CesiumJS post-process shaders use WebGL2 / GLSL ES 3.00. Must use `in` (not `varying`), `texture()` (not `texture2D()`), and `out_FragColor` (not `gl_FragColor`). Notes that WebGL1 syntax may compile on some drivers but produce black screen on others.
**Rationale:** The baseline code examples already use the correct syntax, but an LLM generating new post-process shaders from general WebGL knowledge will default to WebGL1 syntax (varying, texture2D, gl_FragColor). This is one of the most common silent failures in CesiumJS post-processing.

### H4: CustomShader MODIFY vs REPLACE gotcha
**Location:** "Enums" subsection under CustomShader, as a blockquote after the enum list.
**Change:** Added `> **Warning:**` explaining that MODIFY_MATERIAL runs before lighting -- setting diffuse to a constant still gets PBR lighting applied, which may darken the result. For flat unlit color, use REPLACE_MATERIAL + LightingModel.UNLIT.
**Rationale:** This is a subtle semantic difference that causes "why is my color darker than expected?" bugs. The baseline lists the enum values but doesn't explain the practical consequence of choosing wrong.

### H5: PostProcessStage ordering
**Location:** "Post-Processing" section header, as a blockquote after the introductory text.
**Change:** Added `> **Warning:**` explaining that stages execute in array order and that this affects composition. Example: bloom after color grading operates on graded colors, not raw scene output.
**Rationale:** The baseline mentions "Stages execute in order" but doesn't call out the practical consequence. This is a gotcha that causes unexpected visual results when combining multiple effects.

### H6: Fabric `source` function signature gotcha
**Location:** "Custom Fabric with GLSL Source" section, as a blockquote before the code example.
**Change:** Added `> **Warning:**` explaining that the GLSL function MUST be named `czm_getMaterial` and MUST return `czm_material`. Any other name silently fails.
**Rationale:** This is a silent failure mode -- the shader compiles but produces no visible material. An LLM might name the function `getMaterial` or `main` based on general GLSL conventions.

## Line Budget

- Baseline: 380 lines
- Optimized: 400 lines (+20 lines)
- Remaining budget: 100 lines
- All additions are additive blockquotes and code augmentations; no sections reordered or removed.

## Expected Impact

| Hypothesis | Confidence | Expected signal |
|-----------|-----------|----------------|
| H1 Widget cleanup | High | Viewer code includes widget suppression |
| H2 Camera positioning | High | Camera positioned to see material geometry |
| H3 GLSL version | Medium-High | PostProcessStage shaders use correct WebGL2 syntax |
| H4 MODIFY vs REPLACE | Medium | Correct mode chosen for use case |
| H5 Stage ordering | Medium | Stages added in intentional order |
| H6 Fabric function name | Medium-High | Custom Fabric uses `czm_getMaterial` |

H1 and H2 have the strongest prior evidence from camera/imagery tuning. H3 and H6 target silent-failure modes that are high-impact when they occur. H4 and H5 are lower frequency but prevent subtle visual bugs.
