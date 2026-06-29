#!/usr/bin/env python3
"""
Unit tests for adapter interface and implementations.

Tests cover:
- Base Adapter interface is importable and abstract
- MCPAdapter stub raises NotImplementedError for all methods
- Adapter interface contract is testable without concrete runtime
"""

import unittest
from abc import ABC
from optimization.framework.adapters.base import Adapter
from optimization.framework.adapters.mcp_adapter import MCPAdapter


class TestAdapterInterface(unittest.TestCase):
    """Test the base Adapter interface."""

    def test_adapter_is_abstract(self):
        """Adapter base class should be abstract and not directly instantiable."""
        self.assertTrue(issubclass(Adapter, ABC))
        with self.assertRaises(TypeError):
            # Cannot instantiate abstract class
            Adapter()

    def test_adapter_has_required_methods(self):
        """Adapter interface should define all required abstract methods."""
        required_methods = ['prepare', 'invoke', 'collect_output', 'runtime_metadata']
        for method_name in required_methods:
            self.assertTrue(
                hasattr(Adapter, method_name),
                f"Adapter should have {method_name} method"
            )


class TestMCPAdapter(unittest.TestCase):
    """Test the MCP adapter stub."""

    def test_mcp_adapter_init_raises_not_implemented(self):
        """MCPAdapter __init__ should raise NotImplementedError."""
        with self.assertRaises(NotImplementedError) as context:
            MCPAdapter()

        error_message = str(context.exception)
        self.assertIn("not yet implemented", error_message.lower())
        self.assertIn("future", error_message.lower())

    def test_mcp_adapter_is_adapter_subclass(self):
        """MCPAdapter should be a subclass of Adapter."""
        self.assertTrue(issubclass(MCPAdapter, Adapter))


class MockAdapter(Adapter):
    """Mock concrete adapter for testing the interface contract."""

    def __init__(self):
        self.prepared = False
        self.invoked = False

    def prepare(self, scenario, candidate):
        self.prepared = True
        self.scenario = scenario
        self.candidate = candidate

    def invoke(self):
        if not self.prepared:
            raise RuntimeError("Must call prepare() before invoke()")
        self.invoked = True
        return "/path/to/output.js"

    def collect_output(self):
        if not self.invoked:
            raise RuntimeError("Must call invoke() before collect_output()")
        return ("/path/to/output.js", {
            "model_id": "test-model",
            "temperature": 0.7,
            "timestamp_utc": "2026-05-19T12:00:00Z"
        })

    def runtime_metadata(self):
        return {
            "adapter_type": "mock",
            "adapter_version": "1.0.0",
            "runtime_name": "mock_runtime"
        }


class TestAdapterContract(unittest.TestCase):
    """Test the adapter contract with a mock implementation."""

    def setUp(self):
        """Set up a mock adapter for testing."""
        self.adapter = MockAdapter()
        self.scenario = {
            "id": "eval-001",
            "prompt": "Test prompt",
            "expected_behaviors": ["behavior1"]
        }
        self.candidate = {
            "skill_path": "/path/to/skill.md",
            "model_id": "openai/gpt-5.5",
            "temperature": 0.7
        }

    def test_full_adapter_workflow(self):
        """Test complete adapter workflow: prepare -> invoke -> collect -> metadata."""
        # Prepare
        self.adapter.prepare(self.scenario, self.candidate)
        self.assertTrue(self.adapter.prepared)

        # Invoke
        output_path = self.adapter.invoke()
        self.assertTrue(self.adapter.invoked)
        self.assertIsInstance(output_path, str)

        # Collect output
        collected_path, metadata = self.adapter.collect_output()
        self.assertEqual(collected_path, output_path)
        self.assertIsInstance(metadata, dict)
        self.assertIn("model_id", metadata)
        self.assertIn("temperature", metadata)
        self.assertIn("timestamp_utc", metadata)

        # Runtime metadata
        runtime_meta = self.adapter.runtime_metadata()
        self.assertIsInstance(runtime_meta, dict)
        self.assertIn("adapter_type", runtime_meta)

    def test_invoke_without_prepare_fails(self):
        """Calling invoke() before prepare() should raise RuntimeError."""
        with self.assertRaises(RuntimeError):
            self.adapter.invoke()

    def test_collect_without_invoke_fails(self):
        """Calling collect_output() before invoke() should raise RuntimeError."""
        self.adapter.prepare(self.scenario, self.candidate)
        with self.assertRaises(RuntimeError):
            self.adapter.collect_output()


if __name__ == '__main__':
    unittest.main()
