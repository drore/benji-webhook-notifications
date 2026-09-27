import { expect, test } from "@playwright/test";

import {
  createEndpoint,
  enableEndpoint,
  publishEvent,
  selectLatestEvent,
  uniqueSuffix,
} from "./helpers";

test.describe("payload safety", () => {
  test("HTML in a payload is displayed as text and never executed", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    const suffix = uniqueSuffix();
    const name = `E2E XSS ${suffix}`;
    await page.goto("/");
    await createEndpoint(page, { name, types: [`e2e_xss_${suffix}`] });
    await enableEndpoint(page, name);
    await publishEvent(page, {
      type: "custom",
      custom: `e2e_xss_${suffix}`,
      payload: '{"html":"<img src=x onerror=alert(1)>"}',
    });
    await selectLatestEvent(page, `e2e_xss_${suffix}`);
    await page.getByTestId("branch").first().click();
    await expect(page.getByTestId("payload-json")).toContainText("<img src=x onerror=alert(1)>");
    await page.waitForTimeout(500);
    expect(dialogs).toEqual([]);
  });
});
