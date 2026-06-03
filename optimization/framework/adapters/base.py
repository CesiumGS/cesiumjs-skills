#!/usr/bin/env python3
"""
Base adapter interface for runtime-agnostic evaluation.

This module defines the Adapter base class that all concrete runtime adapters
(skills, MCP, etc.) must implement. The adapter abstraction allows the evaluation
framework to invoke different AI agent modes without coupling to a specific runtime.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class Adapter(ABC):
    """
    Abstract base class for evaluation runtime adapters.

    An adapter is responsible for:
    1. Preparing the evaluation environment with a scenario and candidate skill/tool
    2. Invoking the underlying runtime (Claude API, MCP tool call, etc.)
    3. Collecting the generated output and associated metadata
    4. Providing runtime-specific metadata for reproducibility

    Each adapter implementation must provide concrete implementations of all
    abstract methods.
    """

    @abstractmethod
    def prepare(self, scenario: Dict[str, Any], candidate: Dict[str, Any]) -> None:
        """
        Prepare the adapter with a scenario and candidate configuration.

        This method sets up the adapter's internal state before invocation.
        It should validate inputs and prepare any necessary context.

        Args:
            scenario: Scenario manifest dict with fields like id, prompt,
                     expected_behaviors, visual_expectations, etc.
            candidate: Candidate configuration dict with fields specific to
                      the runtime (e.g., skill_path, model_id, temperature for
                      skills adapter; tool_config, mcp_server for MCP adapter)

        Raises:
            ValueError: If scenario or candidate configuration is invalid
        """
        pass

    @abstractmethod
    def invoke(self) -> str:
        """
        Invoke the underlying runtime to generate output.

        This method executes the core evaluation task. For skills adapter,
        this calls the Claude API with the skill and scenario prompt to generate
        JavaScript. For MCP adapter, this would orchestrate tool calls and
        capture the resulting actions.

        Returns:
            str: Path to the primary output artifact (e.g., generated JS file path)

        Raises:
            RuntimeError: If invocation fails or runtime is unavailable
            EnvironmentError: If required credentials (API keys, etc.) are missing
        """
        pass

    @abstractmethod
    def collect_output(self) -> tuple[str, Dict[str, Any]]:
        """
        Collect the generated output and associated metadata.

        This method should be called after invoke() completes successfully.
        It returns both the path to the output artifact and a metadata dict
        for reproducibility tracking.

        Returns:
            tuple: (output_path, metadata_dict)
                - output_path: Absolute path to the generated output file
                - metadata_dict: Dict with runtime-specific metadata including:
                    - model_id (str): Model identifier used for generation
                    - temperature (float): Sampling temperature if applicable
                    - timestamp_utc (str): ISO 8601 timestamp of generation
                    - skill_content_hash (str): SHA-256 hash of skill content (skills adapter)
                    - tool_versions (dict): Tool versions/hashes (MCP adapter)
                    - any other runtime-specific reproducibility metadata

        Raises:
            RuntimeError: If invoke() has not been called or failed
        """
        pass

    @abstractmethod
    def runtime_metadata(self) -> Dict[str, Any]:
        """
        Return metadata about the runtime environment.

        This provides information about the adapter implementation and runtime
        environment for debugging and reproducibility.

        Returns:
            dict: Metadata dict with fields like:
                - adapter_type (str): Type identifier (e.g., "skills", "mcp")
                - adapter_version (str): Adapter implementation version
                - runtime_name (str): Name of underlying runtime
                - runtime_version (str): Version of underlying runtime
                - any other environment-specific metadata
        """
        pass
