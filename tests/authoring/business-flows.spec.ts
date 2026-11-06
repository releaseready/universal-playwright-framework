import { test } from "./support/fixtures";

test("Business Flows: create a synthetic draft", async ({ flow, draft }) => {
  await flow.createDraft(draft);
});
