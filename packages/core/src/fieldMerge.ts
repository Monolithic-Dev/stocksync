import type { RecordState } from "./types";

/**
 * Returns the first field where `incomingFields` disagrees with a value
 * some other client has already *explicitly written* — a genuine
 * same-field conflict. Checking `fieldLastWriter` rather than `fields`
 * matters: `current.fields` can hold a field's original seed/creation
 * value even though no client has ever field_update'd it, and a
 * concurrent first write to that field by a single client is not a
 * conflict with itself, no matter what the seed value was. A field
 * current has never seen a write for isn't a conflict (nothing to
 * disagree with), and an identical concurrent value isn't a conflict
 * either (edge case B-3) — both fall through to `null`.
 */
export function hasFieldConflict(current: RecordState, incomingFields: Record<string, unknown>): string | null {
  for (const [field, incomingValue] of Object.entries(incomingFields)) {
    if (!(field in current.fieldLastWriter)) continue;
    if (current.fields[field] !== incomingValue) {
      return field;
    }
  }
  return null;
}

/** Applies non-conflicting field writes, stamping each touched field's last writer. */
export function mergeDisjointFields(
  current: RecordState,
  incoming: { clientId: string; fields: Record<string, unknown> },
): RecordState {
  const fields = { ...current.fields, ...incoming.fields };
  const fieldLastWriter = { ...current.fieldLastWriter };
  for (const field of Object.keys(incoming.fields)) {
    fieldLastWriter[field] = incoming.clientId;
  }
  return { ...current, fields, fieldLastWriter };
}
