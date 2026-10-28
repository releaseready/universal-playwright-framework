import { createHash } from "node:crypto";
import { z } from "zod";

const identifier = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
const reference = z.object({ id: identifier, revision: identifier }).strict();
const row = z
  .object({
    scenarioId: identifier,
    dataset: reference,
    rowId: identifier,
    secret: reference.optional(),
  })
  .strict();
const selectionSchema = z
  .object({
    version: z.literal(1),
    rows: z.array(row).min(1).max(100),
  })
  .strict();
const catalogueSchema = z
  .object({
    datasets: z
      .array(
        reference
          .extend({ rows: z.array(identifier).min(1).max(100) })
          .strict(),
      )
      .max(100),
    secrets: z.array(reference).max(100),
  })
  .strict();

export type ApprovedDataCatalogue = z.infer<typeof catalogueSchema>;
export type DataReferenceSelection = z.infer<typeof selectionSchema>;
export interface ReviewedDataReferences extends DataReferenceSelection {
  readonly binding: string;
}

function invalidReferences(): never {
  throw new Error("Data references are missing, invalid or unapproved");
}

/** The catalogue must come from the caller's review authority, never the draft. */
export function reviewDataReferences(
  candidate: unknown,
  approvedCatalogue: unknown,
): ReviewedDataReferences {
  const selection = selectionSchema.safeParse(candidate);
  const catalogue = catalogueSchema.safeParse(approvedCatalogue);
  if (!selection.success || !catalogue.success) return invalidReferences();

  const uniqueReferences = (
    references: readonly { id: string; revision: string }[],
  ) =>
    new Set(references.map((item) => JSON.stringify([item.id, item.revision])))
      .size === references.length;
  if (
    !uniqueReferences(catalogue.data.datasets) ||
    !uniqueReferences(catalogue.data.secrets)
  ) {
    return invalidReferences();
  }
  const scenarioIds = new Set<string>();
  for (const selected of selection.data.rows) {
    const dataset = catalogue.data.datasets.find(
      (item) =>
        item.id === selected.dataset.id &&
        item.revision === selected.dataset.revision,
    );
    if (
      !dataset ||
      !dataset.rows.includes(selected.rowId) ||
      scenarioIds.has(selected.scenarioId)
    ) {
      return invalidReferences();
    }
    scenarioIds.add(selected.scenarioId);
    if (
      selected.secret &&
      !catalogue.data.secrets.some(
        (item) =>
          item.id === selected.secret?.id &&
          item.revision === selected.secret.revision,
      )
    ) {
      return invalidReferences();
    }
  }
  // Zod constructs a new, strictly shaped object; no caller payload is retained.
  const rows = selection.data.rows.sort((left, right) =>
    left.scenarioId < right.scenarioId
      ? -1
      : left.scenarioId > right.scenarioId
        ? 1
        : 0,
  );
  const normalized = { version: 1 as const, rows };
  const binding = createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
  return { ...normalized, binding };
}

/** A binding is an equality check, not a signature or permission grant. */
export function verifyDataReferenceBinding(
  candidate: unknown,
  approvedCatalogue: unknown,
  reviewedBinding: string,
): ReviewedDataReferences {
  const current = reviewDataReferences(candidate, approvedCatalogue);
  if (current.binding !== reviewedBinding) {
    throw new Error(
      "Data reference review is stale; review the selected data again",
    );
  }
  return current;
}
