import { describe, expect, it } from "vitest";
import { classifyPromotionState, currentJournalAttempt, journalLifecycle } from "../src/console/optimizationData.js";

const ts = "2099-01-01T00:00:00.000Z";

describe("optimization journal lifecycle", () => {
  it("classifies a failed baseline as terminal and preserves its error", () => {
    const state = journalLifecycle(
      "baseline",
      [
        { event: "baseline_check_started", timestamp_utc: ts },
        { event: "baseline_generation_completed", timestamp_utc: ts },
        { event: "baseline_browser_eval_failed", timestamp_utc: ts, result: { error: "missing ion token" } },
        {
          event: "baseline_check_failed",
          timestamp_utc: ts,
          step: "baseline_browser_eval",
          result: { error: "missing ion token" },
        },
      ],
      60,
    );

    expect(state).toMatchObject({
      status: "failed",
      failed_step: "baseline_browser_eval",
      error: "missing ion token",
      finished_utc: ts,
    });
  });

  it("treats a completed generated baseline as ready", () => {
    const state = journalLifecycle(
      "baseline",
      [
        { event: "baseline_check_started", timestamp_utc: ts },
        { event: "baseline_generation_completed", timestamp_utc: ts },
        { event: "baseline_browser_eval_completed", timestamp_utc: ts },
        { event: "baseline_check_completed", timestamp_utc: ts },
      ],
      60,
    );

    expect(state.status).toBe("baseline");
    expect(state.failed_step).toBeNull();
    expect(state.error).toBeNull();
  });

  it("uses only the newest in-place baseline attempt", () => {
    const journal = [
      { event: "baseline_check_started", timestamp_utc: "2099-01-01T00:00:00.000Z" },
      { event: "baseline_check_failed", timestamp_utc: "2099-01-01T00:00:01.000Z" },
      { event: "baseline_check_started", timestamp_utc: "2099-01-01T00:01:00.000Z" },
      { event: "baseline_check_completed", timestamp_utc: "2099-01-01T00:01:01.000Z" },
    ];

    expect(currentJournalAttempt("baseline", journal)).toEqual(journal.slice(2));
    expect(journalLifecycle("baseline", journal, 60).status).toBe("baseline");
  });
});

describe("candidate review state", () => {
  it("requires Decide approval before a staged candidate is promotable", () => {
    expect(classifyPromotionState({ pending: true, promoted: false, reviewDecision: null })).toBe("staged");
    expect(classifyPromotionState({ pending: true, promoted: false, reviewDecision: "approve" })).toBe("approved");
    expect(classifyPromotionState({ pending: true, promoted: false, reviewDecision: "reject" })).toBe("rejected");
  });

  it("treats an applied candidate as promoted regardless of its earlier review record", () => {
    expect(classifyPromotionState({ pending: false, promoted: true, reviewDecision: "approve" })).toBe("promoted");
  });
});
