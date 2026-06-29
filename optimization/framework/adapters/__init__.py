"""
Adapters for different evaluation runtimes.

This package provides a runtime-agnostic interface for invoking agents and tools
during evaluation. Current implementations include:
- skills_adapter: Invokes the selected agent CLI with a candidate skill to generate CesiumJS code
- mcp_adapter: (Future) Invokes MCP tool-call workflows

All adapters implement the base Adapter interface defined in base.py.
"""

from .base import Adapter
from .skills_adapter import SkillsAdapter

__all__ = ["Adapter", "SkillsAdapter"]
