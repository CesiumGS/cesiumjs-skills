/**
 * `cesium-eval adapter` — lifecycle for the protocol adapter (LiteLLM).
 *
 * init    write a starter targets.json (local-only; endpoints are machine-specific)
 * start   generate config from targets and launch the pinned proxy
 * stop    terminate the proxy
 * status  configured targets, health, version pin, advisory
 */
import type { EvalContext } from "../config/types.js";
import { AdapterTarget, adapterSpec, readTargets, start, status, stop, writeTargets } from "../harness/adapter.js";

function printStatus(state: Awaited<ReturnType<typeof status>>): void {
  console.log(`${state.display_name} (pin ==${state.version_pin})`);
  console.log(`  state:    ${state.running ? (state.healthy ? `running · healthy · :${state.port} · pid ${state.pid}` : `running · UNHEALTHY · :${state.port}`) : "stopped"}`);
  console.log(`  targets:  ${state.targets.length ? state.targets.map((target) => `${target.name} -> ${target.provider_id}`).join(", ") : "(none — run `cesium-eval adapter init`)"}`);
  console.log(`  advisory: ${state.advisory}`);
}

export async function adapterCommand(ctx: EvalContext, action: string): Promise<number> {
  const spec = adapterSpec(ctx);
  switch (action) {
    case "status": {
      printStatus(await status(ctx));
      return 0;
    }
    case "start": {
      const state = await start(ctx);
      printStatus(state);
      return state.healthy ? 0 : 1;
    }
    case "stop": {
      printStatus(await stop(ctx));
      return 0;
    }
    case "init": {
      if (readTargets(ctx, spec).length) {
        console.error(`targets already exist at ${spec.run.targets_artifact} — edit that file directly`);
        return 1;
      }
      // Starter targets: one env-key openai lane (works wherever OPENAI_API_KEY
      // exists) and one keyless Azure/Foundry lane to fill in. Local-only file.
      const starter: AdapterTarget[] = [
        { name: "gpt-5.5", provider_id: "openai", model: "gpt-5.5", credential_env: "OPENAI_API_KEY" },
        {
          name: "foundry-example",
          provider_id: "foundry",
          model: "<deployment-name>",
          params: { api_base: "https://<resource>.openai.azure.com/", api_version: "2024-10-21" },
          credential_env: "AZURE_AD_TOKEN",
        },
      ];
      writeTargets(ctx, spec, starter);
      console.log(`wrote starter targets to ${spec.run.targets_artifact} — edit, then \`cesium-eval adapter start\``);
      return 0;
    }
    default:
      console.error(`unknown adapter action '${action}' (init|start|stop|status)`);
      return 2;
  }
}
