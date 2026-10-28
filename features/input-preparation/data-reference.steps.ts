import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import {
  reviewDataReferences,
  verifyDataReferenceBinding,
  type ApprovedDataCatalogue,
  type DataReferenceSelection,
  type ReviewedDataReferences,
} from "../../src/input-preparation/data-references";

interface DataWorld {
  dataSelection: DataReferenceSelection;
  catalogue: ApprovedDataCatalogue;
  dataReview: ReviewedDataReferences;
  dataError?: Error;
}
Given(
  "two synthetic scenario rows use approved versioned data references",
  function (this: DataWorld) {
    this.catalogue = {
      datasets: [
        { id: "owned-demo", revision: "v1", rows: ["row-a", "row-b"] },
      ],
      secrets: [{ id: "synthetic-account", revision: "v1" }],
    };
    this.dataSelection = {
      version: 1,
      rows: ["row-a", "row-b"].map((rowId) => ({
        scenarioId: `outline/${rowId}`,
        rowId,
        dataset: { id: "owned-demo", revision: "v1" },
        secret: { id: "synthetic-account", revision: "v1" },
      })),
    };
  },
);
When("the operator reviews the data associations", function (this: DataWorld) {
  this.dataReview = reviewDataReferences(this.dataSelection, this.catalogue);
});
Then(
  "both rows retain their own identities and only safe references",
  function (this: DataWorld) {
    assert.deepEqual(
      this.dataReview.rows.map((row) => row.scenarioId),
      ["outline/row-a", "outline/row-b"],
    );
    assert.deepEqual(
      verifyDataReferenceBinding(
        this.dataSelection,
        this.catalogue,
        this.dataReview.binding,
      ),
      this.dataReview,
    );
    assert.ok(
      this.dataReview.rows.every(
        (row) =>
          Object.keys(row.secret ?? {})
            .sort()
            .join() === "id,revision",
      ),
    );
  },
);
When(
  "the selected dataset moves to another approved revision",
  function (this: DataWorld) {
    this.catalogue.datasets[0].revision = "v2";
    this.dataSelection.rows.forEach((row) => {
      row.dataset.revision = "v2";
    });
  },
);
Then(
  "the previous data binding is rejected before execution",
  function (this: DataWorld) {
    assert.throws(
      () =>
        verifyDataReferenceBinding(
          this.dataSelection,
          this.catalogue,
          this.dataReview.binding,
        ),
      /Data reference review is stale/,
    );
  },
);
When(
  "an unknown row and a secret value are submitted",
  function (this: DataWorld) {
    const candidate = {
      ...this.dataSelection,
      rows: [
        {
          ...this.dataSelection.rows[0],
          rowId: "missing",
          secretValue: "SYNTHETIC_PRIVATE_VALUE_83",
        },
      ],
    };
    try {
      reviewDataReferences(candidate, this.catalogue);
    } catch (error) {
      if (error instanceof Error) this.dataError = error;
      else throw error;
    }
  },
);
Then(
  "the data association fails with a safe error",
  function (this: DataWorld) {
    assert.equal(
      this.dataError?.message,
      "Data references are missing, invalid or unapproved",
    );
    assert.ok(
      !JSON.stringify(this.dataError).includes("SYNTHETIC_PRIVATE_VALUE_83"),
    );
  },
);
