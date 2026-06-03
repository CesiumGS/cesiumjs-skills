# Candidate Skill Hypothesis

## Motivation

Last decision: SCORECARD_FOCUS
Rule fired: scorecard_critical_failure_focus
Counts: {'losses': 2, 'ties': 0, 'wins': 0}

### Last Decision Rationale

Deterministic scorecard focus should guide the next local optimization. Source result=fail score=76.5% threshold=95.0%. Failing categories: semantic_scene_state 71.4%. Failed checks:
- cesiumjs-entities/eval-001 translate-marker-east-6m: east_6m: entity 'marker' frame=enu axis=east delta=5.9 m == expected 6 (tolerance +/-0.01 m)
- cesiumjs-entities/eval-002 translate-all-objects-x-10: box_a_no_y_drift: entity 'box-a' frame=ecef axis=y delta=1 m == expected 0

## Recent Evaluation Losses

### Iteration 001
- **eval-001**: In Candidate A, the red 'Statue of Liberty' dot is visually positioned over what appears to be the Central/South Asia landmass (India/Pakistan region), which is geographically inconsistent with New Yo...
- **eval-003**: Candidate B provides a better-framed view of the continental US, with vivid, distinct random colors filling more of the viewport and all states clearly visible — including well-differentiated northeas...
- **eval-004**: Both candidates show a clear top-down view of the continental US with a bright red polyline connecting LA→Denver→Chicago→New York, four labeled city markers, and identical programmatic check results (...
- **eval-005**: Candidate B's screenshot shows a North America-centered view where all three required airport markers (LAX in green, ORD in yellow, JFK in magenta) are clearly visible with their labels, making it str...

## Coverage Gaps

- 11 uncovered sections
- 17 uncovered APIs

Note: Coverage gaps are informational. The proposer should only add content if it addresses specific evaluation failures.

## Proposed Changes

The candidate skill has been revised to address the above evidence.
Specific changes are embedded in the skill markdown itself.
