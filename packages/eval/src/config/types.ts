/** Configuration and registry types shared across the CLI. */

export type RoleName = "proposer" | "codegen" | "judge";

export interface RoleConfig {
  harness: string;
  model: string;
  variant: string;
  timeoutSeconds: number;
}

export interface JudgePanelConfig {
  size: number;
  seeds: number[];
  pairwiseProtocol: string;
  staticProtocol: string;
}

export interface VisionFallbackConfig {
  enabled: boolean;
  /** Override model for fallback calls; null derives from the failing model id. */
  model: string | null;
}

export interface BrowserConfig {
  cesiumVersion: string;
  viewport: { width: number; height: number };
  navigationTimeoutMs: number;
  screenshotTimeoutMs: number;
  ionPreflightAssetId: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  pollMs: number;
}

export interface EvalConfig {
  registry: string;
  threshold: number;
  roles: Record<RoleName, RoleConfig>;
  judgePanel: JudgePanelConfig;
  visionFallback: VisionFallbackConfig;
  browser: BrowserConfig;
  server: ServerConfig;
  liveness: { runningMaxAgeSeconds: number };
}

// ---------------------------------------------------------------------------
// harness registry (config/harness-registry.json) — data, not code
// ---------------------------------------------------------------------------
export interface ModelSpec {
  id: string;
  family?: string;
  name?: string;
  tier?: string;
  price_band?: string | null;
  price_usd_per_mtok?: { input: number; output: number } | null;
  native_vision?: boolean | null;
  effort_levels?: string[];
  context_k?: number | null;
  release?: string | null;
  notes?: string | null;
}

export interface DiscoverySpec {
  /** argv appended to the harness binary to list available model ids. */
  args: string[];
  prefer_family?: string;
  prefer_suffix?: string;
}

export interface HarnessSpec {
  id: string;
  name: string;
  binary: string;
  provider?: string;
  provider_label?: string;
  auth?: string;
  /** Whether image inputs work on this harness for this account. */
  multimodal: boolean;
  vision_note?: string;
  /** Harness id image-bearing calls re-route to when this one lacks vision. */
  vision_fallback_to?: string;
  vision_fallback_for?: string[];
  roles?: string[];
  default_model: string;
  default_effort: string;
  effort_mechanism?: string;
  discovery?: DiscoverySpec | null;
  catalog_source?: string;
  catalog_as_of?: string;
  models: ModelSpec[];
}

export interface HarnessRegistry {
  schema_version: string;
  price_bands?: string[];
  harnesses: HarnessSpec[];
}

/** Everything a command needs, resolved once at CLI startup. */
export interface EvalContext {
  repoRoot: string;
  config: EvalConfig;
  registry: HarnessRegistry;
  /** Find a harness spec or throw with the list of known ids. */
  harness(id: string): HarnessSpec;
  /** Fully-resolved (harness, model, variant) for a role, after all overlays. */
  resolveRole(role: RoleName, overrides?: Partial<Pick<RoleConfig, "harness" | "model" | "variant">>): ResolvedAgent;
}

export interface ResolvedAgent {
  role: RoleName;
  harness: HarnessSpec;
  /** Concrete model id, or null to let the harness use its own configured default. */
  model: string | null;
  variant: string | null;
  timeoutSeconds: number;
}
