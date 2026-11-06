import { test, expect } from "./support/fixtures";

test("Page Objects + Components: save a synthetic draft", async ({
  drafts,
  draft,
}) => {
  await drafts.open();
  await expect(drafts.drafts).toHaveCount(0);
  await drafts.editor.save(draft.title);
  await expect(drafts.status).toHaveText(`Saved: ${draft.title}`);
  await expect(drafts.drafts).toHaveText([draft.title]);
});
