import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reviewDataReferences,
  verifyDataReferenceBinding,
} from "../src/input-preparation/data-references";

const catalogue = {
  datasets: [{ id: "owned-demo", revision: "v1", rows: ["row-a", "row-b"] }],
  secrets: [{ id: "synthetic-account", revision: "v1" }],
};
const selection = {
  version: 1,
  rows: ["row-a", "row-b"].map((rowId) => ({
    scenarioId: `approved-outline/${rowId}`,
    dataset: { id: "owned-demo", revision: "v1" },
    rowId,
    secret: { id: "synthetic-account", revision: "v1" },
  })),
};

test("An operator can bind two distinct approved dataset rows without supplying secret values", () => {
  const review = reviewDataReferences(selection, catalogue);
  assert.deepEqual(
    verifyDataReferenceBinding(selection, catalogue, review.binding),
    review,
  );
  assert.deepEqual(
    review.rows.map((row) => row.rowId),
    ["row-a", "row-b"],
  );
  assert.equal(review.binding.length, 64);
});

test("Missing, unknown, unversioned and duplicate row references stop preparation safely", () => {
  for (const change of [
    { dataset: { id: "owned-demo" } },
    { dataset: { id: "unknown", revision: "v1" } },
    { rowId: "missing" },
    { secret: { id: "unknown", revision: "v1" } },
    { secret: { id: "synthetic-account" } },
  ]) {
    assert.throws(
      () =>
        reviewDataReferences(
          { ...selection, rows: [{ ...selection.rows[0], ...change }] },
          catalogue,
        ),
      /Data references are missing, invalid or unapproved/,
    );
  }
  assert.throws(() =>
    reviewDataReferences(
      { ...selection, rows: [selection.rows[0], selection.rows[0]] },
      catalogue,
    ),
  );
  assert.throws(() =>
    reviewDataReferences({ version: 1, rows: [] }, catalogue),
  );
});

test("An approved data or secret revision change requires a fresh review and binding", () => {
  const old = reviewDataReferences(selection, catalogue);
  for (const field of ["dataset", "secret"] as const) {
    const changed = structuredClone(selection);
    changed.rows[0][field].revision = "v2";
    const nextCatalogue = {
      datasets: [
        ...catalogue.datasets,
        { ...catalogue.datasets[0], revision: "v2" },
      ],
      secrets: [
        ...catalogue.secrets,
        { ...catalogue.secrets[0], revision: "v2" },
      ],
    };
    assert.throws(
      () => verifyDataReferenceBinding(changed, nextCatalogue, old.binding),
      /Data reference review is stale/,
    );
    assert.notEqual(
      reviewDataReferences(changed, nextCatalogue).binding,
      old.binding,
    );
  }
});

test("Rejected secret payloads never appear in safe errors or serialized reference results", () => {
  const sentinel = "SYNTHETIC_PRIVATE_VALUE_83";
  for (const candidate of [
    { ...selection, secretValue: sentinel },
    {
      ...selection,
      rows: [
        {
          ...selection.rows[0],
          secret: { ...selection.rows[0].secret, value: sentinel },
        },
      ],
    },
  ]) {
    assert.throws(
      () => reviewDataReferences(candidate, catalogue),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes(sentinel));
        assert.ok(!JSON.stringify(error).includes(sentinel));
        return true;
      },
    );
  }
  assert.ok(
    !JSON.stringify(reviewDataReferences(selection, catalogue)).includes(
      sentinel,
    ),
  );
});

test("Reordering rows preserves a review, but reassociation or withdrawn approval rejects it", () => {
  const reviewed = reviewDataReferences(selection, catalogue);
  const reversed = { ...selection, rows: [...selection.rows].reverse() };
  assert.equal(
    reviewDataReferences(reversed, catalogue).binding,
    reviewed.binding,
  );
  const changed = structuredClone(selection);
  changed.rows[0].rowId = "row-b";
  assert.throws(
    () => verifyDataReferenceBinding(changed, catalogue, reviewed.binding),
    /review is stale/,
  );
  assert.throws(
    () =>
      verifyDataReferenceBinding(
        selection,
        { ...catalogue, secrets: [] },
        reviewed.binding,
      ),
    /unapproved/,
  );
  const publicOnly = {
    ...selection,
    rows: selection.rows.map(({ secret: _secret, ...row }) => row),
  };
  assert.equal(
    reviewDataReferences(publicOnly, { ...catalogue, secrets: [] }).rows.length,
    2,
  );
});
