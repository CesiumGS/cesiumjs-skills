# Candidate Skill Hypothesis

## Motivation

Last decision: SCORECARD_FOCUS
Rule fired: scorecard_critical_failure_focus
Counts: {'losses': 1, 'ties': 0, 'wins': 0}

### Last Decision Rationale

Deterministic scorecard focus should guide the next local optimization. Source result=fail score=76.5% threshold=95.0%. Failing categories: camera_behavior 0.0%. Failed checks:
- cesiumjs-camera/eval-001 target-view-volume: camera_views_target_not_overhead: distance=1000m view_angle=0deg up_alignment=1

## Recent Evaluation Losses

### Iteration 001
- **eval-003**: Candidate A's screenshot is entirely blank/white with no rendered scene content, consistent with its failed screenshot_quality check noting 'too few distinct sampled colors' and 'very low luminance va...
- **eval-006**: Candidate B's screenshot shows two prominent translucent orange horizontal bands representing canyon rim walls and a blue river polyline running through the canyon floor — exactly the 'rim walls' and ...
- **eval-013**: Candidate A's screenshot shows a prominent tall dark tower spike centered in the frame with the Paris urban grid and Seine River visible at a clear eastward-looking downward angle — consistent with he...

## Coverage Gaps

- 5 uncovered sections
- 16 uncovered APIs

Note: Coverage gaps are informational. The proposer should only add content if it addresses specific evaluation failures.

## Proposed Changes

The candidate skill has been revised to address the above evidence.
Specific changes are embedded in the skill markdown itself.
