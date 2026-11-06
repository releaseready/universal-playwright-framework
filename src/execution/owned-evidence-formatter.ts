import { Formatter, type IFormatterOptions } from "@cucumber/cucumber";
import {
  MAX_OWNED_EVIDENCE_BYTES,
  OWNED_EVIDENCE_FEATURE,
  OWNED_EVIDENCE_ID,
  OWNED_EVIDENCE_SCENARIO,
  OWNED_EVIDENCE_STATUSES,
  OWNED_EVIDENCE_STEPS,
} from "./owned-evidence";
import type { CucumberStepStatus } from "./index";

/** Snapshot a completed case before AfterAll can prevent JSON finalization.
 * Only fixed reviewed names are matched; only fixed IDs and status enums leave
 * the worker. Attachments, parameters, error text and hook messages never do.
 */
export default class OwnedEvidenceFormatter extends Formatter {
  constructor(options: IFormatterOptions) {
    super(options);
    let emitted = false;
    options.eventBroadcaster.on("envelope", (envelope) => {
      if (!envelope.testCaseFinished || emitted) return;
      emitted = true;
      try {
        const attempt = this.eventDataCollector.getTestCaseAttempt(
          envelope.testCaseFinished.testCaseStartedId,
        );
        const { pickle, gherkinDocument, testCase, stepResults } = attempt;
        if (
          attempt.attempt !== 0 ||
          attempt.willBeRetried ||
          pickle.uri !== "fixtures/execution/reviewed-scenarios.feature" ||
          gherkinDocument.feature?.name !== OWNED_EVIDENCE_FEATURE ||
          pickle.name !== OWNED_EVIDENCE_SCENARIO ||
          !pickle.tags.some(
            (tag) => tag.name === `@scenario-id=${OWNED_EVIDENCE_ID}`,
          ) ||
          pickle.steps.length !== OWNED_EVIDENCE_STEPS.length ||
          pickle.steps.some(
            (step, index) => step.text !== OWNED_EVIDENCE_STEPS[index],
          )
        )
          return;
        const business = testCase.testSteps.filter((step) => step.pickleStepId);
        if (business.length !== pickle.steps.length) return;
        const steps = business.map((step, index) => {
          if (
            step.pickleStepId !== pickle.steps[index].id ||
            !stepResults[step.id]
          )
            throw new Error("incomplete");
          const status = stepResults[
            step.id
          ].status.toLowerCase() as CucumberStepStatus;
          if (!OWNED_EVIDENCE_STATUSES.includes(status))
            throw new Error("unknown");
          return status;
        });
        const snapshot =
          JSON.stringify({
            schemaVersion: 1,
            scenarioId: OWNED_EVIDENCE_ID,
            steps,
          }) + "\n";
        if (Buffer.byteLength(snapshot) <= MAX_OWNED_EVIDENCE_BYTES)
          this.log(snapshot);
      } catch {
        // Supplemental evidence must not replace the worker's original failure.
        // Missing/partial output is rejected by the parent; no success is invented.
      }
    });
  }
}
