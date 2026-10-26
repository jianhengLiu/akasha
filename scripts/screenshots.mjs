// Regenerates the README screenshots from the mock (fake data only).
// Start the dev stack with AI pointed at the mock first:
//   AKASHA_AI_BASE_URL=http://localhost:8001/v1 AKASHA_AI_API_KEY=test-key AKASHA_AI_MODEL=mock npm run dev
// then: node scripts/screenshots.mjs  (needs Playwright with Chromium installed)
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.AKASHA_URL ?? "http://localhost:5173";
const OUT = "docs/screenshots";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// A made-up insurance policy to "photograph".
const POLICY = `<html><body style="margin:0;background:#d9d4cb;display:grid;place-items:center;height:100vh">
<div style="width:520px;height:700px;background:#fff;box-shadow:0 8px 30px #0003;transform:rotate(-2deg);font-family:sans-serif;padding:40px;box-sizing:border-box">
<div style="font-size:30px;font-weight:bold;color:#1d4e89">中国太平洋保险</div>
<div style="font-size:24px;margin:16px 0 30px">个人医疗保险单</div>
${["被保险人 王**", "保单号 CPIC2026****0417", "保险期间 2026-05-01 至 2027-04-30", "年保费 1,560 元"].map((l) => `<div style="font-size:20px;margin:14px 0;color:#333">${l}</div>`).join("")}
<div style="margin-top:60px;height:12px;background:#eee"></div><div style="margin-top:12px;height:12px;width:70%;background:#eee"></div></div></body></html>`;

async function login(browser, username, extra = {}) {
  const ctx = await browser.newContext({ ...PHONE, ...extra });
  // Keep the shots about the content: no install card, no floating feedback button.
  await ctx.addInitScript(() => localStorage.setItem("akasha.installDismissed", "1"));
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.locator("input").first().fill(username);
  await page.locator('input[type="password"]').fill(username);
  await page.keyboard.press("Enter");
  await page.waitForSelector("text=拍照", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  return page;
}

async function shot(page, name) {
  await page.addStyleTag({ content: "button.fixed{display:none!important}" });
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

// A pending account request, so Settings has something to show.
await fetch(`${BASE}/api/signup`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "爸爸", username: "baba", password: "baba-2026!" }),
}).catch(() => {});

const policy = await (await browser.newPage({ viewport: { width: 600, height: 800 } }));
await policy.setContent(POLICY);
const photo = await policy.screenshot({ type: "jpeg", quality: 85 });

const mama = await login(browser, "mama");
await shot(mama, "home");
await mama.goto(`${BASE}/#/upload`);
await mama.locator('input[type="file"]').first().setInputFiles({ name: "policy.jpg", mimeType: "image/jpeg", buffer: photo });
await mama.waitForSelector("text=AI 帮你填好了", { timeout: 15000 });
await mama.locator("text=AI 帮你填好了").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 110));
await mama.waitForTimeout(400);
await shot(mama, "upload");

const admin = await login(browser, "admin");
await admin.goto(`${BASE}/#/doc/1`);
await admin.waitForTimeout(1000);
await admin.locator("h2").first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120));
await admin.waitForTimeout(300);
await shot(admin, "detail");
await admin.goto(`${BASE}/#/settings`);
await admin.waitForTimeout(1200);
await shot(admin, "settings");


// Banner: four phones side by side, for the top of the README.
const shots = await Promise.all(["home", "upload", "detail", "settings"].map(async (n) =>
  `data:image/png;base64,${(await readFile(`${OUT}/${n}.png`)).toString("base64")}`));
const banner = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await banner.setContent(`<html><body style="margin:0;width:1600px;height:900px;background:linear-gradient(135deg,#f6f1e7,#ead9c6);display:flex;align-items:center;justify-content:center;gap:36px">
${shots.map((s, i) => `<div style="width:340px;height:736px;border-radius:44px;background:#1f1a17;padding:12px;box-shadow:0 24px 60px #5b4a2e40;transform:translateY(${i % 2 ? 28 : -28}px)">
<img src="${s}" style="width:100%;height:100%;border-radius:34px;object-fit:cover;object-position:top"></div>`).join("")}</body></html>`);
await banner.waitForTimeout(300);
await banner.screenshot({ path: `${OUT}/banner.png` });

await browser.close();
console.log(`screenshots written to ${OUT}/`);
