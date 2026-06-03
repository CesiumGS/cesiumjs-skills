"""Static qualitative visual judge package.

Self-contained subprocess-based judge for CesiumJS rendered baselines. MUST NOT
import anything from ``optimization/`` (boundary enforced by
``evaluation/scripts/validate-evaluation.py``).
"""

from __future__ import annotations

from .static_judge import JudgeConfig, judge_render

__all__ = ["judge_render", "JudgeConfig"]
