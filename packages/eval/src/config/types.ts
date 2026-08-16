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

export interface BrowserConfig {
  cesiumVersion: string;
  viewport: { width: number; height: number };
  navigationTimeoutMs: number;
  screenshotTimeoutMs: number;
  ionPreflightAssetId: number;
  /** Max time to wait for tile streams to settle before a screenshot. */
  tileSettleTimeoutMs: number;
  /** Poll interval while waiting for the scene to settle. */
  tileSettlePollMs: number;
  /** Consecutive settled polls required (tilesLoaded flickers as LOD refines). */
  tileSettleQuietPolls: number;
  /** Give up waiting when no viewer appears within this budget (scenes that
   * await slow resources before constructing the Viewer need headroom). */
  tileSettleViewerGraceMs: number;
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
  browser: BrowserConfig;
  server: ServerConfig;
  liveness: { runningMaxAgeSeconds: number };
}

// ---------------------------------------------------------------------------
// harness registry (config/harness-registry.json) — data, not code
// v2 models three orthogonal axes: integration mechanism, wire protocol, and
// credential route. "Adapter required" is DERIVED (provider protocols ∩
// harness protocols = ∅), never stored per pair.
// ---------------------------------------------------------------------------
export type WireProtocol =
  | "openai-chat"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | "azure-openai"
  | "bedrock-sigv4"
  | "vertex-ai";

export type CredentialRoute =
  | "api_key"
  | "oauth_subscription"
  | "codex_subscription"
  | "broker_subscription"
  | "cloud_iam"
  | "local_none";

export type IntegrationMechanism = "native" | "native_3p" | "base_url_override" | "custom_provider_decl";

export type AttributionMethod =
  | "structured_json"
  | "structured_jsonl"
  | "stdout_banner"
  | "log_scrape_windowed"
  | "usage_file";

export interface CredentialOption {
  route: CredentialRoute;
  env_vars?: string[];
  setup_command?: string;
  /** true => needs a TTY/browser flow; a UI cannot silently compose env vars for it. */
  interactive: boolean;
}

export interface ProviderSpec {
  id: string;
  display_name: string;
  kind: "first_party" | "broker" | "aggregator" | "cloud_platform" | "local_runtime";
  protocols_served: WireProtocol[];
  /** Who trained the weights, when fixed. null for brokers/aggregators. */
  first_party_vendor?: string | null;
  credentials: CredentialOption[];
  /** Per-adapter routing hints keyed by adapter id (litellm model_prefix etc.). */
  adapter_hints?: Record<string, Record<string, unknown>>;
  notes?: string[];
}

/** A protocol adapter: a local gateway realizing the derived fourth tier. */
export interface AdapterSpec {
  id: string;
  display_name: string;
  kind: "local_proxy";
  serves_protocols: WireProtocol[];
  install: { recommended_route: string; routes: InstallRoute[] };
  run: {
    health_path: string;
    default_port: number;
    /** LOCAL-ONLY generated config path (gitignored artifacts). */
    config_artifact: string;
    targets_artifact?: string;
  };
  security: { min_safe_version: string; blocked_versions?: string[]; advisory: string };
  attribution_rule?: string;
  quirks?: string[];
}

export interface ProtocolSpoken {
  protocol: WireProtocol;
  via?: string;
  /** true only when observed on a live run; docs-only claims stay false. */
  verified: boolean;
}

export interface ProviderSupport {
  native: string[];
  native_note?: string;
  native_3p?: string[];
  byok?: {
    mechanism: IntegrationMechanism;
    config_surface: string;
    protocols: WireProtocol[];
    constraints?: Record<string, unknown>;
    example?: string;
  };
}

export interface AttributionSpec {
  method: AttributionMethod;
  /** Whether the driver/probe extracts observed attribution on this path. */
  observed_by_driver: boolean;
  provider_source: "wire" | "inferred_from_binding" | "declared";
  model_source: "wire" | "inferred_from_binding" | "declared";
  extraction?: Record<string, unknown>;
  raw_provider_examples?: string[];
  note?: string;
}

export interface ProbeSpec {
  timeout_ms: number;
  observed_latency_ms?: { min?: number; max?: number };
  retries?: number;
  warmup_after_install?: boolean;
}

export interface InstallRoute {
  id: string;
  command?: string;
  update_command?: string;
  /** true only if exercised live; docs-only routes stay false. */
  verified: boolean;
  notes?: string[];
}

export interface ModelSpec {
  id: string;
  family?: string;
  /** Model creator (OpenAI, Anthropic, Google, Microsoft…). */
  vendor?: string | null;
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
  /** Absolute paths (~ allowed) tried before PATH lookup — install scripts
   * often wire PATH for interactive shells only. */
  binary_candidates?: string[];
  /** Canonical provider id (must exist in registry providers[]). */
  provider?: string;
  credential_route?: CredentialRoute;
  credential?: {
    /** Env vars deliberately passed through the default strip-list (explicit
     * API-key billing, never silent). */
    env_passthrough?: string[];
    note?: string;
  };
  provider_label?: string;
  auth?: string;
  maintainer?: string;
  docs_url?: string;
  /** Whether image inputs work on this harness for this account. */
  multimodal: boolean;
  vision_note?: string;
  roles?: string[];
  default_model: string;
  default_effort: string;
  effort_mechanism?: string | null;
  discovery?: DiscoverySpec | null;
  catalog_source?: string;
  catalog_as_of?: string;
  models: ModelSpec[];
  protocols_spoken?: ProtocolSpoken[];
  provider_support?: ProviderSupport;
  attribution?: AttributionSpec;
  probe?: ProbeSpec;
  install?: { recommended_route: string; routes: InstallRoute[] };
  version?: { scheme: "semver" | "date_tag" | "commit_sha"; note?: string };
  quirks?: string[];
}

export interface ProviderAlias {
  provider_id: string;
  credential_route?: CredentialRoute | null;
  note?: string;
}

export interface HarnessRegistry {
  $schema?: string;
  schema_version: string;
  comment?: string;
  price_bands?: string[];
  protocol_aliases?: Record<string, WireProtocol>;
  provider_aliases?: Record<string, ProviderAlias>;
  providers?: ProviderSpec[];
  adapters?: AdapterSpec[];
  probe_policy?: { serialize: boolean; token_strategy: string; rules?: string[] };
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
