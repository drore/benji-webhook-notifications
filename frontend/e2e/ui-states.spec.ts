import { expect, test } from "@playwright/test";

test.describe("async UI states", () => {
  test("REQ-009 empty states explain the next action", async ({ page }) => {
    await page.route("**/api/endpoints**", (route) =>
      route.fulfill({ json: { items: [] } }),
    );
    await page.route("**/api/events**", (route) => route.fulfill({ json: { items: [] } }));
    await page.route("**/api/overview**", (route) =>
      route.fulfill({
        json: { failed_count: 0, retrying_count: 0, earliest_due_at: null, latest_event: null },
      }),
    );
    await page.goto("/");
    await expect(
      page.getByText("No endpoints yet. To start receiving webhooks:"),
    ).toBeVisible();
    await expect(
      page.getByText("No events yet — publish one on the right to see it fan out."),
    ).toBeVisible();
    await expect(
      page.getByText("Select an event from Recent events to follow its delivery journey."),
    ).toBeVisible();
  });

  test("REQ-009 the publish action disables while its request is pending", async ({ page }) => {
    let release: (() => void) | null = null;
    await page.route("**/api/events", async (route) => {
      if (route.request().method() === "POST") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      await route.continue();
    });
    await page.goto("/");
    const button = page.getByRole("button", { name: "Publish event" });
    await page.getByLabel("Payload").fill('{"member":"m_pending","points":1}');
    await button.click();
    await expect(button).toBeDisabled();
    release?.();
    await expect(button).toBeEnabled();
    await expect(page.getByTestId("accepted")).toBeVisible();
  });

  test("REQ-008 a polling failure shows the stale banner and recovery clears it", async ({
    page,
  }) => {
    let failing = true;
    await page.route("**/api/overview**", async (route) => {
      if (failing) {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.goto("/");
    await expect(page.getByTestId("stale-banner")).toBeVisible();
    failing = false;
    await expect(page.getByTestId("stale-banner")).toBeHidden({ timeout: 8_000 });
  });
});
