/** Helpers for reading evaluation evidence bundles. */

export function snapshotNames(spec: Record<string, any>): string[] {
  const snapshot = spec.snapshot ?? "after";
  if (snapshot === "both") return ["before", "after"];
  if (snapshot === "before" || snapshot === "after") return [snapshot];
  throw new Error("snapshot must be one of: before, after, both");
}

export function entitiesForSnapshot(evidence: Record<string, any>, snapshot: string): Record<string, any> {
  const section = (evidence ?? {})[snapshot];
  if (section === null || typeof section !== "object" || Array.isArray(section)) return {};
  const entities = section.entities;
  if (entities === null || typeof entities !== "object" || Array.isArray(entities)) return {};
  return entities;
}

export function entityForSnapshot(
  evidence: Record<string, any>,
  snapshot: string,
  entityId: string,
): Record<string, any> | null {
  const entity = entitiesForSnapshot(evidence, snapshot)[entityId];
  return entity !== null && typeof entity === "object" && !Array.isArray(entity) ? entity : null;
}

export function missingSnapshots(evidence: Record<string, any>, entityId: string, snapshots: string[]): string[] {
  return snapshots.filter((snapshot) => entityForSnapshot(evidence, snapshot, entityId) === null);
}
