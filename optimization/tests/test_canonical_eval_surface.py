"""Tests for the canonical eval surface guard."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def load_canonical_guard():
    script_path = Path(__file__).resolve().parents[2] / "optimization" / "scripts" / "check-canonical-eval-surface.py"
    spec = importlib.util.spec_from_file_location("check_canonical_eval_surface", script_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_canonical_eval_surface"] = module
    spec.loader.exec_module(module)
    return module


def test_top_level_tests_are_routed_to_evals_tests(monkeypatch, capsys):
    guard = load_canonical_guard()

    monkeypatch.setattr(guard, "git_ls_files", lambda: ["tests/test_eval_pipeline.py"])

    assert guard.main() == 1
    captured = capsys.readouterr()
    assert "tests/test_eval_pipeline.py: eval pipeline files must live under optimization/tests/" in captured.out


def test_top_level_framework_modules_are_routed_to_evals_framework(monkeypatch, capsys):
    guard = load_canonical_guard()

    monkeypatch.setattr(guard, "git_ls_files", lambda: ["checks/visual.py"])

    assert guard.main() == 1
    captured = capsys.readouterr()
    assert "checks/visual.py: eval pipeline files must live under optimization/framework/" in captured.out


def test_top_level_prd_is_routed_to_evals_docs(monkeypatch, capsys):
    guard = load_canonical_guard()

    monkeypatch.setattr(guard, "git_ls_files", lambda: ["prd.json"])

    assert guard.main() == 1
    captured = capsys.readouterr()
    assert "prd.json: eval planning artifacts must live under optimization/docs/prd.json" in captured.out


def test_evaluation_code_cannot_import_optimization(monkeypatch, tmp_path, capsys):
    guard = load_canonical_guard()
    sample = tmp_path / "sample.py"
    sample.write_text("from optimization.framework.checks import engine\n")

    monkeypatch.setattr(guard, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(guard, "git_ls_files", lambda: ["evaluation/framework/sample.py"])
    (tmp_path / "evaluation" / "framework").mkdir(parents=True)
    (tmp_path / "evaluation" / "framework" / "sample.py").write_text(sample.read_text())

    assert guard.main() == 1
    captured = capsys.readouterr()
    assert "evaluation code must not import optimization" in captured.out
