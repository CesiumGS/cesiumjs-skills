#!/usr/bin/env bash
#
# Smoke test for Run-Skill-Evaluations-Locally.md documentation.
#
# Executes key commands from the wiki page using a minimal test scenario set
# to verify that all documented commands are copy-paste runnable.
#
# Exit codes:
#   0 - All documented commands work
#   1 - One or more documented commands failed

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "[smoke-test-docs] Starting documentation smoke tests..."
echo "[smoke-test-docs] Repository root: $REPO_ROOT"
echo ""

# Track failures
FAILED=0

# Helper to run a command and report results
run_test() {
    local description="$1"
    shift
    echo ">>> Testing: $description"
    if "$@"; then
        echo "    ✓ PASS"
    else
        echo "    ✗ FAIL"
        FAILED=1
    fi
    echo ""
}

# Section: Validate Public Artifacts
echo "=== Section: Validate Public Artifacts ==="
run_test "Validate eval manifests" python3 optimization/scripts/validate-evals.py
run_test "Validate deterministic evaluation cases" python3 evaluation/scripts/validate-evaluation.py
run_test "Check canonical eval surface" python3 optimization/scripts/check-canonical-eval-surface.py
run_test "Check public artifacts" python3 optimization/scripts/check-public-artifacts.py
run_test "Check secrets" bash optimization/scripts/check-secrets.sh

# Section: Run a Single Scenario (requires tokens)
echo "=== Section: Run a Single Scenario ==="

# Skip browser tests if tokens are not available
if [ -z "${CESIUM_ION_TOKEN:-}" ]; then
    echo ">>> Skipping browser tests (CESIUM_ION_TOKEN not set)"
    echo "    Note: Set CESIUM_ION_TOKEN to test browser runner commands"
    echo ""
else
    # Create a minimal test scenario if needed
    TEST_SKILL="cesiumjs-camera"
    TEST_ITERATION="smoke-test"
    TEST_EVAL_ID="eval-001"
    TEST_GEN_DIR="optimization/generated/$TEST_SKILL/$TEST_ITERATION"
    TEST_GEN_FILE="$TEST_GEN_DIR/$TEST_EVAL_ID.js"

    # Ensure generated code exists for smoke test
    if [ ! -f "$TEST_GEN_FILE" ]; then
        echo ">>> Creating minimal test generated code at $TEST_GEN_FILE"
        mkdir -p "$TEST_GEN_DIR"
        cat > "$TEST_GEN_FILE" <<'EOF'
// Minimal smoke test: create viewer
const viewer = (window.viewer = new Cesium.Viewer('cesiumContainer', {
    terrainProvider: undefined
}));
console.log('Smoke test viewer created');
EOF
        echo "    ✓ Test generated code created"
        echo ""
    fi

    run_test "Run single scenario (browser)" \
        python3 optimization/scripts/run-public-eval.py "$TEST_SKILL" \
            --iteration "$TEST_ITERATION" \
            --only "$TEST_EVAL_ID"

    # Verify output files exist
    RUN_DIR="optimization/runs/$TEST_SKILL/$TEST_ITERATION"
    if [ -d "$RUN_DIR" ]; then
        BUNDLE_DIR=$(find "$RUN_DIR" -maxdepth 1 -type d -name "${TEST_EVAL_ID}-*" | head -n 1)
        if [ -n "$BUNDLE_DIR" ]; then
            echo ">>> Verifying run bundle structure"
            for file in console.json programmatic-checks.json screenshot-quality.json metadata.json; do
                if [ -f "$BUNDLE_DIR/$file" ]; then
                    echo "    ✓ Found $file"
                else
                    echo "    ✗ Missing $file"
                    FAILED=1
                fi
            done
            # Screenshot may be screenshot.png or screenshot-0.png
            if ls "$BUNDLE_DIR"/screenshot*.png 1> /dev/null 2>&1; then
                echo "    ✓ Found screenshot(s)"
            else
                echo "    ✗ Missing screenshot"
                FAILED=1
            fi
            echo ""
        fi
    fi
fi

# Section: Coverage Analysis
echo "=== Section: Coverage Analysis ==="
run_test "Analyze coverage" python3 optimization/scripts/analyze-coverage.py

# Verify coverage.json exists
if [ -f "optimization/results/coverage.json" ]; then
    echo ">>> Coverage report generated"
    echo "    ✓ Found optimization/results/coverage.json"
    echo ""
else
    echo ">>> Coverage report missing"
    echo "    ✗ Missing optimization/results/coverage.json"
    FAILED=1
    echo ""
fi

# Section: Scenario Rebaseline
echo "=== Section: Scenario Rebaseline ==="
# Verify the rebaseline command without dirtying tracked baselines.
run_test "Rebaseline scenario dry run" \
    python3 optimization/scripts/rebaseline-scenario.py cesiumjs-camera eval-001 --dry-run

# Section: Decision Reproduction (conceptual test)
echo "=== Section: Decision Reproduction ==="
# We can't fully test this without real history artifacts, but verify the script exists
if [ -f "optimization/scripts/make-decision.py" ]; then
    echo ">>> Decision engine script available"
    echo "    ✓ Found optimization/scripts/make-decision.py"
    # Verify it at least shows help
    if python3 optimization/scripts/make-decision.py --help > /dev/null 2>&1; then
        echo "    ✓ Script --help works"
    else
        echo "    ✗ Script --help failed"
        FAILED=1
    fi
    echo ""
else
    echo ">>> Decision engine script missing"
    echo "    ✗ Missing optimization/scripts/make-decision.py"
    FAILED=1
    echo ""
fi

# Section: Full Loop (requires both tokens)
echo "=== Section: Full Autonomous Loop ==="

run_test "Plan all-skill loop commands" \
    python3 optimization/scripts/run-all-evals.py --dry-run --max-iterations 1

if [ -z "${CESIUM_ION_TOKEN:-}" ] || { ! command -v opencode > /dev/null 2>&1 && ! command -v codex > /dev/null 2>&1; }; then
    echo ">>> Skipping full loop test (requires CESIUM_ION_TOKEN and an agent CLI harness)"
    echo "    Note: Set CESIUM_ION_TOKEN and install/authenticate opencode or codex to test full loop commands"
    echo ""
else
    # For smoke test, we'll verify the script at least accepts the arguments
    # We won't actually run a full iteration (too expensive)
    echo ">>> Verifying run-loop.py accepts documented arguments"
    if python3 optimization/scripts/run-loop.py --help > /dev/null 2>&1; then
        echo "    ✓ Loop script --help works"
    else
        echo "    ✗ Loop script --help failed"
        FAILED=1
    fi
    echo ""
fi

# Section: Local Artifact Safety
echo "=== Section: Local Artifact Safety ==="
# Re-run safety checks to verify they still pass after smoke tests
run_test "Final deterministic evaluation validation" python3 evaluation/scripts/validate-evaluation.py
run_test "Final canonical eval surface check" python3 optimization/scripts/check-canonical-eval-surface.py
run_test "Final public artifacts check" python3 optimization/scripts/check-public-artifacts.py
run_test "Final secrets check" bash optimization/scripts/check-secrets.sh

# Summary
echo "=== Smoke Test Summary ==="
if [ $FAILED -eq 0 ]; then
    echo "✓ All smoke tests passed"
    echo "[smoke-test-docs] OK — documentation commands are valid"
    exit 0
else
    echo "✗ Some smoke tests failed"
    echo "[smoke-test-docs] FAIL — review failures above"
    exit 1
fi
