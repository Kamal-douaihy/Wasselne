import { BrowserContext, expect, test as base } from "@playwright/test";
import { authenticator } from "otplib";

const reviewer = JSON.parse(process.env.E2E_REVIEWER!) as { email: string; password: string; secret: string };
const auditor = JSON.parse(process.env.E2E_AUDITOR!) as { email: string; password: string; secret: string };
const driverId = process.env.E2E_DRIVER_ID!;

// One browser context for the whole serial run, so the session cookie set by the sign-in test
// carries through (Playwright otherwise gives every test a fresh context).
let shared: BrowserContext;
const test = base.extend({
  context: async ({}, use) => { // eslint-disable-line no-empty-pattern
    await use(shared);
  },
  page: async ({ context }, use) => {
    const p = await context.newPage();
    await use(p);
    await p.close();
  },
});
test.beforeAll(async ({ browser }) => {
  shared = await browser.newContext({ baseURL: process.env.CONSOLE_URL });
});
test.afterAll(async () => {
  await shared.close();
});

async function signInWithCode(page: import("@playwright/test").Page, who: typeof auditor, code: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe.serial("admin console", () => {
  test("signed-out visitors are sent to sign-in", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto(`/drivers/${driverId}`);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("pages carry anti-framing and no-store headers", async ({ page }) => {
    const res = await page.goto("/login");
    const h = res!.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["cache-control"]).toContain("no-store");
  });

  test("a wrong password gives one generic message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(reviewer.email);
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("p[role='alert']")).toHaveText("Email or password is incorrect.");
    await page.getByLabel("Email").fill("nobody@example.test");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("p[role='alert']")).toHaveText("Email or password is incorrect.");
  });

  test("first sign-in forces MFA enrolment: QR, key, 10 recovery codes, saved-confirmation gate", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(reviewer.email);
    await page.getByLabel("Password").fill(reviewer.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Multi-factor sign-in is mandatory")).toBeVisible();
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    await expect(page.getByAltText("Authenticator QR code")).toBeVisible();
    await expect(page.locator(".codes > div")).toHaveCount(10);
    const confirm = page.getByRole("button", { name: "Confirm and sign in" });
    await page.getByLabel("Code from the app").fill("000000");
    await expect(confirm).toBeDisabled(); // must tick "I saved these" first
    await page.getByLabel("I saved these recovery codes").check();
    await confirm.click();
    await expect(page.locator("p[role='alert']")).toBeVisible(); // wrong code refused
    // the enrolment secret is what the page displayed; read it from the page to compute a real code
    const secret = (await page.locator("code").first().innerText()).trim();
    await page.getByLabel("Code from the app").fill(authenticator.generate(secret));
    await confirm.click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(page.getByRole("heading", { name: "Driver approvals" })).toBeVisible();
    // the session token is httpOnly: browser script cannot read it
    expect(await page.evaluate(() => document.cookie)).not.toContain("wsl_admin_session");
    const cookies = await page.context().cookies();
    const s = cookies.find((c) => c.name === "wsl_admin_session")!;
    expect(s.httpOnly).toBe(true);
    expect(s.sameSite).toBe("Strict");
  });

  test("reviewer sees only the screens their role allows", async ({ page }) => {
    await page.goto("/approvals");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Driver approvals" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Drivers" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Riders" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Audit log" })).toHaveCount(0);
    await page.goto("/riders");
    await expect(page.getByText("You don't have permission to view this")).toBeVisible();
    await page.goto("/audit");
    await expect(page.getByText("You don't have permission to view this")).toBeVisible();
  });

  test("reviewer approves each document and the driver; every action needs a reason", async ({ page, context }) => {
    await page.goto("/approvals");
    await expect(page.getByRole("link", { name: /Dana Seeded/ })).toBeVisible();
    await page.getByRole("link", { name: /Dana Seeded/ }).click();
    await expect(page.getByRole("heading", { name: /Dana Seeded/ })).toBeVisible();
    await expect(page.getByText("SUBMITTED").first()).toBeVisible();

    // view a document: opens a short-lived signed link in a new tab and returns the image bytes
    const popupPromise = context.waitForEvent("page");
    await page.getByRole("row", { name: /National ID/ }).getByRole("button", { name: "View" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url()).toContain("X-Amz-Signature");

    // reason dialog: Confirm stays disabled until a reason is typed
    const approveDoc = async (rowName: RegExp) => {
      await page.getByRole("row", { name: rowName }).getByRole("button", { name: "Approve" }).click();
      const dialog = page.getByRole("dialog");
      const ok = dialog.getByRole("button", { name: "Confirm" });
      await expect(ok).toBeDisabled();
      await dialog.getByLabel(/Reason/).fill("Document checked against the original");
      await ok.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    await approveDoc(/National ID/);
    await expect(page.getByRole("row", { name: /National ID/ }).getByText("APPROVED")).toBeVisible();
    await approveDoc(/Vehicle registration/);
    await expect(page.getByRole("row", { name: /Vehicle registration/ }).getByText("APPROVED")).toBeVisible();

    await page.getByRole("button", { name: "Approve driver" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Reason/).fill("Application verified end to end");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("heading", { name: /Dana Seeded/ }).getByText("APPROVED")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve driver" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Suspend" })).toBeVisible();
  });

  test("suspending and reinstating a driver from the console updates the status", async ({ page }) => {
    await page.goto(`/drivers/${driverId}`);
    await page.getByRole("button", { name: "Suspend" }).click();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Testing the suspend flow");
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("heading", { name: /Dana Seeded/ }).getByText("SUSPENDED")).toBeVisible();
    await page.getByRole("button", { name: "Reinstate" }).click();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Suspension lifted after review");
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("heading", { name: /Dana Seeded/ }).getByText("APPROVED")).toBeVisible();
  });

  test("CSRF: a state-changing call to the console's proxy without the custom header is refused", async ({ page }) => {
    await page.goto("/drivers");
    const status = await page.evaluate(async (id) => {
      const r = await fetch(`/api/bff/drivers/${id}/suspend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "forged request" }) });
      return r.status; // session cookie is sent, the custom header is not
    }, driverId);
    expect(status).toBe(403);
    await page.goto(`/drivers/${driverId}`);
    await expect(page.getByRole("heading", { name: /Dana Seeded/ }).getByText("APPROVED")).toBeVisible(); // unchanged
    const other = await page.evaluate(async () => (await fetch("/api/bff/rides", { headers: { "X-Wasselne-Admin": "1" } })).status);
    expect(other).toBe(404); // only whitelisted API prefixes are proxied
  });

  test("sign out ends the session on the server, not just in the browser", async ({ page, context }) => {
    const before = (await context.cookies()).find((c) => c.name === "wsl_admin_session")!.value;
    await page.goto("/approvals");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/approvals");
    await expect(page).toHaveURL(/\/login$/);
    // replay the old token straight at the API: it must be dead
    const res = await page.request.get(`${process.env.E2E_API_URL}/v1/admin/drivers`, { headers: { Authorization: `Bearer ${before}` } });
    expect(res.status()).toBe(401);
  });

  test("an auditor reads the audit trail of that review but cannot act on it", async ({ page }) => {
    await signInWithCode(page, auditor, authenticator.generate(auditor.secret));
    await expect(page).toHaveURL(/\/approvals$/);
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Audit log" })).toBeVisible();
    await page.goto("/audit");
    await expect(page.getByRole("row", { name: /driver\.approve/ })).toContainText("Application verified end to end");
    await expect(page.getByRole("row", { name: /driver_document\.view/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /driver\.suspend/ })).toContainText("Testing the suspend flow");
    await page.goto(`/approvals/${driverId}`);
    await expect(page.getByRole("heading", { name: /Dana Seeded/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Approve|Reject|Suspend|Block/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "View" })).toHaveCount(0); // auditors cannot open documents
  });

  test("an auditor who calls the proxy directly is refused by the API, not just hidden in the UI", async ({ page }) => {
    await page.goto("/audit"); // same-site fetch from the console's own page, like the UI would make
    const status = await page.evaluate(async (id) => {
      const r = await fetch(`/api/bff/driver-approvals/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Wasselne-Admin": "1" },
        body: JSON.stringify({ reason: "auditor attempting a decision" }),
      });
      return r.status;
    }, driverId);
    expect(status).toBe(403);
  });
});
