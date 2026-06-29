import type { AdaptedCase, Decision, RawEvidenceSummary, VisualStatus } from "../types";

export function decisionWord(d: Decision): string {
  return d === "accept" ? "ACCEPT" : d === "flag" ? "FLAG" : "DEFER";
}

export function decisionLabel(d: Decision): string {
  return d === "accept" ? "Accept" : d === "flag" ? "Flag" : "Defer";
}

export function statusWord(s: VisualStatus): string {
  return titleCase(s.replace(/_/g, " "));
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function skillLabel(skill: string): string {
  const raw = skill.replace(/^cesiumjs-/, "");
  const overrides: Record<string, string> = {
    "3d-tiles": "3D Tiles",
    camera: "Camera",
    "core-utilities": "Core Utilities",
    "custom-shader": "Custom Shader",
    entities: "Entities",
    imagery: "Imagery",
    interaction: "Interaction",
    "materials-shaders": "Materials & Shaders",
    "models-particles": "Models & Particles",
    primitives: "Primitives",
    "spatial-math": "Spatial Math",
    "terrain-environment": "Terrain & Environment",
    "time-properties": "Time & Properties",
    "viewer-setup": "Viewer Setup"
  };
  return overrides[raw] ?? titleCase(raw);
}

// Maps a visual status / decision into the four color channels used in CSS.
export function decisionTone(d: Decision): "accept" | "flag" | "defer" {
  return d;
}

export function dimTone(status: VisualStatus): "pass" | "fail" | "needs_review" | "neutral" {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  if (status === "needs_review") return "needs_review";
  return "neutral";
}

export function formatScore10(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}/10`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 1000) / 10}%`;
}

export function relativeTime(iso: string): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

export function shortCommit(commit: string): string {
  return (commit || "").slice(0, 8) || "unknown";
}

export function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 0) return "[]";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function evidenceLinks(ev: RawEvidenceSummary, evidencePath: string): Array<{ label: string; path: string }> {
  const run = ev.run_artifact_path;
  const links: Array<{ label: string; path: string | null | undefined }> = [
    { label: "Source JS", path: ev.actual_source_path },
    { label: "Evidence", path: evidencePath || ev.evidence_path },
    { label: "Console", path: run ? `${run}/console.json` : null },
    { label: "Scene State", path: run ? `${run}/scene-state.json` : null },
    { label: "Checks", path: run ? `${run}/programmatic-checks.json` : null },
    { label: "Shot Quality", path: run ? `${run}/screenshot-quality.json` : null },
    { label: "Metadata", path: run ? `${run}/metadata.json` : null }
  ];
  return links.filter((l): l is { label: string; path: string } => Boolean(l.path));
}

// Tiny fuzzy matcher for the command palette: subsequence match, returns score (lower = better) or null.
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let lastHit = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    if (lastHit >= 0) score += found - lastHit - 1; // gap penalty
    lastHit = found;
    ti = found + 1;
  }
  return score + found0Bonus(t, q);
}

function found0Bonus(t: string, q: string): number {
  return t.startsWith(q) ? -5 : 0;
}

export function searchableCase(c: AdaptedCase): string {
  return [c.case_name, c.case_id, c.skill, c.landmark, c.perspective].filter(Boolean).join(" ");
}
