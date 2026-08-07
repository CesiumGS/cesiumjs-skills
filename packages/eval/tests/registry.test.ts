/**
 * Registry v2 contract: schema validity is enforced by loadContext (ajv);
 * these tests pin the cross-cutting invariants the schema alone cannot see —
 * driver coverage, provider referential integrity, and the attribution
 * honesty rules the probe verdicts depend on.
 */
import { describe, expect, it } from "vitest";
import { loadContext } from "../src/config/load.js";
import { driverFor, registeredDrivers } from "../src/harness/driver.js";
import "../src/harness/drivers.js"; // side-effect: registers built-in drivers

const context = loadContext({ loadDotEnv: false });

describe("harness registry v2", () => {
  it("declares a driver for every harness entry", () => {
    // The registry comment promises: an entry is only usable once a driver
    // with the same id exists. Enforce it so a data-only addition fails here
    // instead of at first launch.
    const drivers = registeredDrivers();
    for (const harness of context.registry.harnesses) {
      expect(drivers, `harness '${harness.id}' has no driver`).toContain(harness.id);
    }
  });

  it("binds every harness to a canonical provider with a credential route", () => {
    const providerIds = new Set((context.registry.providers ?? []).map((provider) => provider.id));
    for (const harness of context.registry.harnesses) {
      expect(harness.provider, `harness '${harness.id}' missing provider`).toBeTruthy();
      expect(providerIds, `harness '${harness.id}' provider unknown`).toContain(harness.provider);
      expect(harness.credential_route, `harness '${harness.id}' missing credential_route`).toBeTruthy();
    }
  });

  it("keeps default_model inside each harness catalog", () => {
    for (const harness of context.registry.harnesses) {
      expect(
        harness.models.some((model) => model.id === harness.default_model),
        `harness '${harness.id}' default_model '${harness.default_model}' not in catalog`,
      ).toBe(true);
    }
  });

  it("backs observed_by_driver claims with an invokeStructured implementation", () => {
    // attribution.observed_by_driver=true is a promise the probe relies on:
    // the driver must expose structured invocation to keep it.
    for (const harness of context.registry.harnesses) {
      if (harness.attribution?.observed_by_driver) {
        const driver = driverFor(harness);
        expect(
          typeof driver.invokeStructured,
          `harness '${harness.id}' declares observed_by_driver but its driver lacks invokeStructured`,
        ).toBe("function");
      }
    }
  });

  it("resolves provider aliases to canonical providers", () => {
    const providerIds = new Set((context.registry.providers ?? []).map((provider) => provider.id));
    for (const [alias, spec] of Object.entries(context.registry.provider_aliases ?? {})) {
      expect(providerIds, `alias '${alias}' points at unknown provider`).toContain(spec.provider_id);
    }
  });

  it("declares probe timeouts for every harness (latency spread is ~17x)", () => {
    for (const harness of context.registry.harnesses) {
      expect(harness.probe?.timeout_ms, `harness '${harness.id}' missing probe.timeout_ms`).toBeGreaterThan(0);
    }
  });
});
