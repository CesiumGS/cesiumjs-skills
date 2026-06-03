from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


EVALUATION_ROOT = Path(__file__).resolve().parents[1]
VALIDATE_SCRIPT = EVALUATION_ROOT / "scripts" / "validate-evaluation.py"


def _load_validator():
    spec = importlib.util.spec_from_file_location("validate_evaluation", VALIDATE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["validate_evaluation"] = module
    spec.loader.exec_module(module)
    return module


def test_boundary_check_rejects_optimizer_imports(tmp_path: Path) -> None:
    validator = _load_validator()
    path = tmp_path / "bad_eval.py"
    path.write_text("from optimization.framework.scorecard_focus import build_focus\n", encoding="utf-8")

    violations = validator.forbidden_optimization_dependencies([path])

    assert len(violations) == 1
    assert "imports forbidden module 'optimization.framework.scorecard_focus'" in violations[0]


def test_boundary_check_rejects_direct_optimizer_script_calls(tmp_path: Path) -> None:
    validator = _load_validator()
    path = tmp_path / "bad_eval.py"
    path.write_text(
        "import subprocess\n"
        "subprocess.run(['python3', 'optimization/scripts/run-all-evals.py'], check=True)\n",
        encoding="utf-8",
    )

    violations = validator.forbidden_optimization_dependencies([path])

    assert len(violations) == 1
    assert "calls an optimization script from evaluation code" in violations[0]


def test_boundary_check_allows_optimizer_provenance_strings(tmp_path: Path) -> None:
    validator = _load_validator()
    path = tmp_path / "good_eval.py"
    path.write_text(
        "NOTE = 'observed from optimization/runs as historical provenance only'\n",
        encoding="utf-8",
    )

    assert validator.forbidden_optimization_dependencies([path]) == []
