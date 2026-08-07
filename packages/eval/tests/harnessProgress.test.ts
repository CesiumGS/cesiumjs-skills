/**
 * The live play-by-play is the only window into a running agent call, so its
 * failure modes are all silent ones: an event type that stops being reported
 * after a CLI upgrade, a reasoning block re-printed in full on every update
 * until the log is unreadable, a JSON object split across two stdout chunks
 * and dropped. These tests pin the behavior that would otherwise rot unnoticed
 * — nothing here asserts exact prose, only that the right facts reach the log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSubprocess } from "../src/harness/shared.js";
import { HarnessProgress, reportPlainTextLine } from "../src/harness/progress.js";
import { reportCodexEvent } from "../src/harness/codexDriver.js";
import { reportOpenCodeEvent } from "../src/harness/opencodeDriver.js";
import { reportClaudeEvent } from "../src/harness/claudeDriver.js";
import { reportPiEvent } from "../src/harness/piDriver.js";

let lines: string[] = [];
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  lines = [];
  process.env.EVAL_HARNESS_STREAM = "status";
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: any) => {
    lines.push(String(chunk).trimEnd());
    return true;
  });
});

afterEach(() => {
  writeSpy.mockRestore();
  delete process.env.EVAL_HARNESS_STREAM;
});

function reporter(): HarnessProgress {
  return new HarnessProgress({ role: "codegen", harness: "codex", model: "test-model", variant: "medium" });
}

const log = () => lines.join("\n");

describe("the reporter", () => {
  it("stamps every line with the role and harness, so interleaved calls stay attributable", () => {
    const progress = reporter();
    progress.emit({ kind: "tool", label: "shell", text: "ls" });
    expect(lines[0]).toContain("[agent codegen/codex");
  });

  it("reports only the new text when a harness re-sends a growing reasoning block", () => {
    const progress = reporter();
    progress.emitDelta("think:1", "thinking", "reasoning", "First I inspect the repo.");
    progress.emitDelta("think:1", "thinking", "reasoning", "First I inspect the repo. Then I count files.");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Then I count files.");
    expect(lines[1]).not.toContain("First I inspect");
  });

  it("says nothing when the same text is re-sent unchanged", () => {
    const progress = reporter();
    progress.emitDelta("msg:1", "message", "assistant", "done");
    progress.emitDelta("msg:1", "message", "assistant", "done");
    expect(lines).toHaveLength(1);
  });

  it("keeps a multi-line payload on one line, so one event is one log entry", () => {
    const progress = reporter();
    progress.emit({ kind: "tool", label: "shell", text: "a\nb\nc" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("a b c");
  });

  it("strips terminal escapes, so tool output cannot repaint the CI log", () => {
    const progress = reporter();
    progress.emit({ kind: "tool", label: "shell", text: "\u001b[31mred\u001b[0m" });
    expect(lines[0]).toContain("red");
    expect(lines[0]).not.toContain("\u001b");
  });


  it("flattens a detail value, so a raw tool error cannot become several log lines", () => {
    const progress = reporter();
    progress.emit({ kind: "tool", label: "read", detail: { error: "ENOENT: no such file\n  at open (fs.js:1)" } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]).toContain("at open");
  });

  it("strips ANSI from a detail value as well as from the payload", () => {
    const progress = reporter();
    progress.emit({ kind: "tool", label: "read", detail: { error: "\u001b[31mboom\u001b[0m" } });
    expect(lines[0]).toContain("boom");
    expect(lines[0]).not.toContain("\u001b");
  });

  it("flattens a harness-supplied label", () => {
    const progress = reporter();
    progress.emit({ kind: "notice", label: "weird\ntype" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]).toContain("weird type");
  });

  it("truncates at status verbosity and reports how much it withheld", () => {
    const progress = reporter();
    progress.emit({ kind: "thinking", label: "reasoning", text: "x".repeat(500) });
    expect(lines[0]).toMatch(/\(\+\d+ chars\)/);
  });

  it("keeps long reasoning at full verbosity", () => {
    process.env.EVAL_HARNESS_STREAM = "full";
    const progress = reporter();
    progress.emit({ kind: "thinking", label: "reasoning", text: "x".repeat(500) });
    expect(lines[0]).not.toContain("chars)");
  });

  it("writes nothing at all when switched off", () => {
    process.env.EVAL_HARNESS_STREAM = "off";
    const progress = reporter();
    progress.dispatch({ prompt: "1KB" });
    progress.emit({ kind: "tool", label: "shell", text: "ls" });
    progress.finish();
    expect(lines).toHaveLength(0);
  });

  it("closes the narrative on failure, so the last line is never a heartbeat", () => {
    const progress = reporter();
    progress.dispatch({});
    progress.fail("codex CLI exited with code 1");
    expect(log()).toContain("exited with code 1");
  });

  it("reports a turn's token spend in one line", () => {
    const progress = reporter();
    progress.usage({ input: 42_745, output: 240, reasoning: 97, cached: 31_232 });
    expect(lines[0]).toContain("in=42.7k");
    expect(lines[0]).toContain("out=240");
  });
});

describe("the codex event stream", () => {
  it("narrates a shell call from start to exit status", () => {
    const progress = reporter();
    reportCodexEvent(progress, JSON.stringify({ type: "item.started", item: { id: "i2", type: "command_execution", command: "ls" } }));
    reportCodexEvent(
      progress,
      JSON.stringify({ type: "item.completed", item: { id: "i2", type: "command_execution", command: "ls", aggregated_output: "a\nb\n", exit_code: 0 } }),
    );
    expect(lines[0]).toContain("state=running");
    expect(lines[1]).toContain("state=ok");
    expect(lines[1]).toContain("lines=2");
  });

  it("surfaces a non-zero exit rather than reporting the call as done", () => {
    const progress = reporter();
    reportCodexEvent(
      progress,
      JSON.stringify({ type: "item.completed", item: { id: "i", type: "command_execution", command: "false", exit_code: 3 } }),
    );
    expect(lines[0]).toContain("exit 3");
  });

  it("converts the turn's usage block into a token line", () => {
    const progress = reporter();
    reportCodexEvent(progress, JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 5 } }));
    expect(lines[0]).toContain("out=5");
  });

  it("names an unrecognized event type instead of dropping it", () => {
    const progress = reporter();
    reportCodexEvent(progress, JSON.stringify({ type: "turn.throttled" }));
    expect(lines[0]).toContain("turn.throttled");
  });

  it("ignores non-JSON chatter without throwing", () => {
    const progress = reporter();
    expect(() => reportCodexEvent(progress, "Reading prompt from stdin...")).not.toThrow();
    expect(lines).toHaveLength(0);
  });
});

describe("the opencode event stream", () => {
  it("reports a tool call with the argument that identifies it", () => {
    const progress = reporter();
    reportOpenCodeEvent(
      progress,
      JSON.stringify({ type: "tool_use", part: { id: "p", tool: "bash", state: { status: "completed", input: { command: "ls -la" } } } }),
    );
    expect(lines[0]).toContain("bash");
    expect(lines[0]).toContain("ls -la");
    expect(lines[0]).toContain("state=completed");
  });

  it("flags a failed tool call as an error rather than a completion", () => {
    const progress = reporter();
    reportOpenCodeEvent(
      progress,
      JSON.stringify({ type: "tool_use", part: { id: "p", tool: "read", state: { status: "error", error: "ENOENT", input: { filePath: "gone.ts" } } } }),
    );
    expect(lines[0]).toContain("state=error");
  });

  it("reports token spend at each step boundary", () => {
    const progress = reporter();
    reportOpenCodeEvent(
      progress,
      JSON.stringify({ type: "step_finish", part: { id: "p", reason: "stop", tokens: { input: 9675, output: 5, cache: { read: 900 } } } }),
    );
    expect(lines[0]).toContain("in=9.7k");
  });
});

describe("the claude-code event stream", () => {
  it("narrates thinking, the tool call, and its result", () => {
    const progress = reporter();
    reportClaudeEvent(
      progress,
      JSON.stringify({
        type: "assistant",
        message: { id: "m1", content: [{ type: "thinking", thinking: "Read the file." }, { type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] },
      }),
    );
    reportClaudeEvent(progress, JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "contents" }] } }));
    expect(log()).toContain("Read the file.");
    expect(log()).toContain("a.ts");
    expect(log()).toContain("state=ok");
  });

  it("stays quiet about hook bookkeeping, which is not agent activity", () => {
    const progress = reporter();
    reportClaudeEvent(progress, JSON.stringify({ type: "system", subtype: "hook_started", hook_name: "SessionStart" }));
    expect(lines).toHaveLength(0);
  });

  it("reports a throttle but not the routine allowed tick", () => {
    const progress = reporter();
    reportClaudeEvent(progress, JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }));
    expect(lines).toHaveLength(0);
    reportClaudeEvent(progress, JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "throttled", rateLimitType: "five_hour" } }));
    expect(lines[0]).toContain("rate limit");
  });
});

describe("streaming stdout to the reporter", () => {
  it("delivers whole lines even when they straddle chunk boundaries", async () => {
    const seen: string[] = [];
    // Two halves of one JSON object, flushed separately with a gap between
    // them: a per-chunk split would hand the parser `{"type":"a` and lose it.
    const script =
      'process.stdout.write(String.fromCharCode(123) + String.raw`"type":"a"` );' +
      'setTimeout(() => process.stdout.write(String.fromCharCode(125) + String.fromCharCode(10)), 50);';
    const result = await runSubprocess(process.execPath, ["-e", script], {
      timeoutMs: 20_000,
      onStdoutLine: (line) => seen.push(line),
    });
    expect(result.status).toBe(0);
    expect(seen).toEqual(['{"type":"a"}']);
  });

  it("delivers a final line the process never terminated with a newline", async () => {
    const seen: string[] = [];
    await runSubprocess(process.execPath, ["-e", 'process.stdout.write("tail")'], {
      timeoutMs: 20_000,
      onStdoutLine: (line) => seen.push(line),
    });
    expect(seen).toEqual(["tail"]);
  });

  it("survives a reporter that throws, because commentary must never fail a run", async () => {
    const result = await runSubprocess(process.execPath, ["-e", 'console.log("hello")'], {
      timeoutMs: 20_000,
      onStdoutLine: () => {
        throw new Error("formatting bug");
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("hello");
  });
});

describe("the pi event stream", () => {
  it("reports settled blocks, not the per-token deltas that would flood the log", () => {
    const progress = reporter();
    // Six token deltas plus the settled block: only the block is worth a line.
    for (const delta of ["There", " are", " 15", " entries", "."]) {
      reportPiEvent(progress, JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } }));
    }
    reportPiEvent(
      progress,
      JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_end", content: "There are 15 entries." } }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("There are 15 entries.");
  });

  it("stays quiet on an empty reasoning block, which encrypted-reasoning providers always send", () => {
    const progress = reporter();
    reportPiEvent(progress, JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking_end", content: "" } }));
    expect(lines).toHaveLength(0);
  });

  it("narrates tool execution from start to outcome", () => {
    const progress = reporter();
    reportPiEvent(progress, JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command: "ls" } }));
    reportPiEvent(
      progress,
      JSON.stringify({ type: "tool_execution_end", toolName: "bash", isError: false, result: { content: [{ type: "text", text: "15\n" }] } }),
    );
    expect(lines[0]).toContain("state=running");
    expect(lines[1]).toContain("state=ok");
  });

  it("converts a turn's usage block into a token line", () => {
    const progress = reporter();
    reportPiEvent(progress, JSON.stringify({ type: "turn_end", message: { usage: { input: 1458, output: 43, reasoning: 19, cacheRead: 0 } } }));
    expect(lines[0]).toContain("in=1.5k");
    expect(lines[0]).toContain("reasoning=19");
  });
});

describe("prose-only harnesses", () => {
  it("reports the answer as it arrives, since there are no events to report", () => {
    const progress = reporter();
    reportPlainTextLine(progress, "First line of the answer.");
    reportPlainTextLine(progress, "Second line.");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Second line.");
  });
});
