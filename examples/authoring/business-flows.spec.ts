import { test, expect } from "./support/fixtures";

test("Business Flows: create a synthetic draft", async ({
  flow,
  drafts,
  draft,
}) => {
  await flow.createDraft(draft);
  await expect(drafts.drafts).toHaveText([draft.title]);
});
