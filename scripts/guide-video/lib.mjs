import { chromium } from "playwright-core";
import fs from "node:fs";
export const BASE = "http://localhost:3000";
export const OUT = new URL("./.work/shots/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const acc = Object.fromEntries(fs.readFileSync(new URL("./.work/demo-accounts.txt", import.meta.url), "utf8").trim().split("\n").map(l => { const [r, e, p] = l.split(" "); return [r, { email: e, password: p }]; }));
export async function open(role, vp = { width: 1280, height: 720 }, dsf = 1) {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dsf, locale: "ja-JP" });
  const page = await ctx.newPage(); page.setDefaultNavigationTimeout(120000); page.setDefaultTimeout(60000);
  if (role) {
    await page.goto(BASE + "/login");
    await page.fill("#email", acc[role].email);
    await page.fill("#password", acc[role].password);
    await page.click("button[type=submit]");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  }
  return { browser, page };
}
export async function shot(page, name, opts = {}) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: OUT + name + ".png", ...opts });
}
export async function hideDevBadge(page) {
  await page.addStyleTag({ content: "nextjs-portal, [data-nextjs-toast], [data-next-badge-root]{display:none !important}" }).catch(() => {});
}
export async function dump(page) {
  return page.evaluate(() => {
    const t = (e) => (e.innerText || e.value || e.placeholder || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const out = [];
    document.querySelectorAll("h1,h2,h3,summary,label,input:not([type=hidden]),textarea,select,button,a").forEach((e) => {
      out.push(`${e.tagName.toLowerCase()}${e.name ? "[" + e.name + "]" : ""}${e.getAttribute("type") ? "(" + e.getAttribute("type") + ")" : ""} ${t(e)}${e.href ? " -> " + e.getAttribute("href") : ""}`);
    });
    return out.join("\n");
  });
}
