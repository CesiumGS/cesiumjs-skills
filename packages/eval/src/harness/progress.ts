/**
 * Live play-by-play for agent calls.
 *
 * WHY THIS EXISTS
 *
 * Every driver buffered its subprocess and printed nothing until the call
 * returned, so a `render-baselines` or `optimize` step looked identical in the
 * log whether the harness was reasoning, running a tool, rate-limited, or
 * wedged: one silent block for anywhere from ten seconds to the timeout. In CI
 * that is the difference between "cancel this, it's stuck" and "it's on tool
 * call four, let it finish" — and locally under `act` there is not even a
 * spinner to suggest the process is alive.
 *
 * Both agent CLIs already emit a structured event stream on stdout (codex
 * `exec --json`, opencode `run --format json`, claude `-p --output-format
 * stream-json`); the drivers parsed it only at the end, for the final message.
 * This module turns those same events into a running commentary as they
 * arrive. Nothing new is spawned and no extra tokens are spent: it is the
 * stream that was already there, printed instead of discarded.
 *
 * The heartbeat covers the gap the event stream cannot: a model call in
 * progress emits nothing at all, so a long think would still read as a hang.
 *
 * OUTPUT CONTRACT
 *
 * One line per event, prefixed `[agent <role>/<harness> mm:ss.s]`, no ANSI, no
 * carriage-return redraws — the log is consumed by GitHub Actions and by `act`
 * through a pipe, where an in-place spinner becomes garbage. Payload text is
 * flattened to a single line so one event never becomes twelve.
 */
import * as process from "node:process";

/** Verbosity, from EVAL_HARNESS_STREAM. */
export type StreamLevel = "off" | "status" | "full";

export type HarnessEventKind =
  /** Command handed to the CLI. */
  | "dispatch"
  /** Harness accepted it and opened a thread/session. */
  | "session"
  /** Model reasoning / chain-of-thought summary text. */
  | "thinking"
  /** Assistant-visible message text. */
  | "message"
  /** A tool call started, progressed, or finished. */
  | "tool"
  /** Harness-level warning or informational notice. */
  | "notice"
  /** Token accounting for the turn. */
  | "usage"
  /** Terminal states. */
  | "done"
  | "failed";

export interface HarnessEvent {
  kind: HarnessEventKind;
  /** Short label: the verb or subject (e.g. "bash", "turn", "web_search"). */
  label?: string;
  /** Free text payload; flattened and truncated by the reporter. */
  text?: string;
  /** Structured trailer rendered as `key=value` pairs, never truncated. */
  detail?: Record<string, string | number | null | undefined>;
}

export interface ProgressContext {
  role: string;
  harness: string;
  model: string | null;
  variant?: string | null;
}

const KIND_MARKS: Record<HarnessEventKind, string> = {
  dispatch: ">>",
  session: "..",
  thinking: "~~",
  message: "<<",
  tool: "**",
  notice: "!!",
  usage: "##",
  done: "OK",
  failed: "XX",
};

/** Events below `status` verbosity are lifecycle-only; `full` adds every
 * reasoning/message chunk at a much larger truncation budget. */
const STATUS_LIMIT = 160;
const FULL_LIMIT = 2000;
/** Labels and detail values are meant to be short identifiers, so they are
 * capped independently of verbosity — `full` should lengthen the model's prose,
 * not let a harness's raw error string dominate the line. */
const LABEL_LIMIT = 80;
const DETAIL_LIMIT = 200;

export function streamLevel(): StreamLevel {
  const raw = (process.env.EVAL_HARNESS_STREAM ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  if (raw === "full" || raw === "verbose" || raw === "1" || raw === "true") return "full";
  if (raw === "status") return "status";
  // Default on. The whole point is that a silent run is indistinguishable from
  // a hung one; opting in would leave the default case broken.
  return "status";
}

function heartbeatSeconds(): number {
  const raw = Number(process.env.EVAL_HARNESS_HEARTBEAT_SECONDS ?? "");
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 20;
}

/** mm:ss.s since the call started — relative, because absolute wall-clock is
 * already stamped on every GitHub Actions log line. */
function elapsedLabel(ms: number): string {
  const total = ms / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function humanSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Collapse to one line and cap. Control characters are stripped so a tool's
 * raw output can never repaint or colorize the CI log. */
function flatten(text: string, limit: number): string {
  const single = text
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (single.length <= limit) return single;
  return `${single.slice(0, limit).trimEnd()}… (+${single.length - limit} chars)`;
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}

/**
 * Per-call reporter. One is created by `invokeAgent` and threaded into the
 * driver, which feeds it the harness's own event stream.
 */
export class HarnessProgress {
  private readonly level: StreamLevel;
  private readonly startedAt = Date.now();
  private lastEventAt = Date.now();
  private lastLabel = "dispatch";
  private timer: ReturnType<typeof setInterval> | null = null;
  private finished = false;

  /** Longest reasoning/message text already reported per stream id, so an
   * `item.updated` that merely re-sends the whole accumulated text prints only
   * the delta instead of repeating the paragraph on every tick. */
  private readonly reported = new Map<string, number>();

  private tools = 0;
  private messages = 0;
  private thoughts = 0;

  constructor(private readonly ctx: ProgressContext) {
    this.level = streamLevel();
  }

  get enabled(): boolean {
    return this.level !== "off";
  }

  private write(kind: HarnessEventKind, label: string, body: string): void {
    const head = `[agent ${this.ctx.role}/${this.ctx.harness} ${elapsedLabel(Date.now() - this.startedAt)}]`;
    // The label is flattened here rather than at the call sites: several of
    // them are harness-supplied (a tool name, an unrecognized event type), and
    // one multiline or ANSI-bearing label would break the one-line contract
    // for every caller at once.
    const line = `${head} ${KIND_MARKS[kind]} ${flatten(label, LABEL_LIMIT)}${body ? ` · ${body}` : ""}`;
    // stdout, not stderr: this is the narrative of a successful run, and CI
    // step logs interleave the two unpredictably.
    process.stdout.write(`${line}\n`);
  }

  emit(event: HarnessEvent): void {
    if (!this.enabled) return;
    this.lastEventAt = Date.now();
    this.lastLabel = event.label ?? event.kind;

    if (event.kind === "tool") this.tools += 1;
    if (event.kind === "message") this.messages += 1;
    if (event.kind === "thinking") this.thoughts += 1;

    // Reasoning and message bodies are the bulk of the stream. At `status`
    // they are a one-line gist; only `full` prints them at length.
    const limit = this.level === "full" ? FULL_LIMIT : STATUS_LIMIT;
    const parts: string[] = [];
    if (event.text) parts.push(flatten(event.text, limit));
    for (const [key, value] of Object.entries(event.detail ?? {})) {
      if (value === null || value === undefined || value === "") continue;
      // Detail values are not all ours: a harness reports raw tool errors
      // through here (opencode's state.error, for one), and those carry
      // newlines and terminal escapes. Interpolating them unflattened turned
      // one event into several log lines and reintroduced exactly the ANSI
      // the reporter promises to strip.
      parts.push(`${key}=${flatten(String(value), DETAIL_LIMIT)}`);
    }
    this.write(event.kind, event.label ?? event.kind, parts.join(" "));
  }

  /**
   * Emit only the part of `text` not already reported for `streamId`. Harness
   * CLIs re-send the whole accumulated block on each update; without this the
   * log grows quadratically in the length of the model's reasoning.
   */
  emitDelta(streamId: string, kind: "thinking" | "message", label: string, text: string): void {
    if (!this.enabled) return;
    const seen = this.reported.get(streamId) ?? 0;
    if (text.length <= seen) return;
    this.reported.set(streamId, text.length);
    const delta = text.slice(seen).trim();
    if (!delta) return;
    this.emit({ kind, label, text: delta });
  }

  /** Announce the call and start the heartbeat. */
  dispatch(detail: Record<string, string | number | null | undefined>): void {
    if (!this.enabled) return;
    this.emit({
      kind: "dispatch",
      label: this.ctx.model ?? "default-model",
      detail: { variant: this.ctx.variant ?? undefined, ...detail },
    });
    this.startHeartbeat();
  }

  /**
   * A model call in flight produces no events at all, so without this a
   * two-minute think is indistinguishable from a wedged process. Prints the
   * age of the last real event so the reader can tell "thinking" from "stuck".
   */
  private startHeartbeat(): void {
    if (this.timer) return;
    const interval = heartbeatSeconds() * 1000;
    this.timer = setInterval(() => {
      if (this.finished) return;
      const idle = Date.now() - this.lastEventAt;
      this.write(
        "session",
        "still running",
        `elapsed=${humanSeconds(Date.now() - this.startedAt)} last=${this.lastLabel} idle=${humanSeconds(idle)}`,
      );
    }, interval);
    // Never hold the process open on the heartbeat alone.
    this.timer.unref?.();
  }

  private stopHeartbeat(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  finish(detail: Record<string, string | number | null | undefined> = {}): void {
    if (!this.enabled || this.finished) return;
    this.finished = true;
    this.stopHeartbeat();
    this.write(
      "done",
      this.ctx.model ?? "default-model",
      [
        `in ${humanSeconds(Date.now() - this.startedAt)}`,
        `tools=${this.tools}`,
        `messages=${this.messages}`,
        `thinking=${this.thoughts}`,
        ...Object.entries(detail)
          .filter(([, value]) => value !== null && value !== undefined && value !== "")
          .map(([key, value]) => `${key}=${value}`),
      ].join(" "),
    );
  }

  fail(reason: string): void {
    if (!this.enabled || this.finished) return;
    this.finished = true;
    this.stopHeartbeat();
    this.write("failed", this.ctx.model ?? "default-model", `after ${humanSeconds(Date.now() - this.startedAt)} · ${flatten(reason, STATUS_LIMIT)}`);
  }

  /** Report a turn's token accounting in one line. */
  usage(counts: { input?: number; output?: number; reasoning?: number; cached?: number }): void {
    if (!this.enabled) return;
    const parts: string[] = [];
    if (counts.input !== undefined) parts.push(`in=${formatTokens(counts.input)}`);
    if (counts.cached) parts.push(`cached=${formatTokens(counts.cached)}`);
    if (counts.output !== undefined) parts.push(`out=${formatTokens(counts.output)}`);
    if (counts.reasoning) parts.push(`reasoning=${formatTokens(counts.reasoning)}`);
    if (!parts.length) return;
    this.emit({ kind: "usage", label: "tokens", text: parts.join(" ") });
  }
}

/**
 * Commentary for harnesses whose stdout is the assistant's prose rather than
 * an event stream (copilot `--silent`, hermes `-z`).
 *
 * There are no tool or reasoning events to report for these, because the CLI
 * never emits any — the honest play-by-play is the answer arriving line by
 * line, which still distinguishes "generating" from "hung" and is strictly
 * more than the nothing they showed before. Callers pair it with the
 * heartbeat, which covers the silence before the first line lands.
 */
export function reportPlainTextLine(progress: HarnessProgress, line: string): void {
  progress.emit({ kind: "message", label: "assistant", text: line });
}

/** A reporter that is wired up but silent — used where a call has no role
 * context (probes) and by tests, so drivers never branch on null. */
export function silentProgress(): HarnessProgress {
  const previous = process.env.EVAL_HARNESS_STREAM;
  process.env.EVAL_HARNESS_STREAM = "off";
  const reporter = new HarnessProgress({ role: "-", harness: "-", model: null });
  if (previous === undefined) delete process.env.EVAL_HARNESS_STREAM;
  else process.env.EVAL_HARNESS_STREAM = previous;
  return reporter;
}
