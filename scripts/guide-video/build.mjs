import fs from "node:fs";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { open, hideDevBadge, BASE } from "./lib.mjs";
import { videos, reading } from "./spec.mjs";

const HERE = new URL("./", import.meta.url).pathname;
const ROOT = HERE + ".work/"; // 作業用(スクリーンショット・音声・途中のMP4)。git管理外
const REPO = new URL("../../", import.meta.url).pathname;
fs.mkdirSync(ROOT, { recursive: true });
const SHOTS = ROOT + "shots/", AUDIO = ROOT + "audio/", SEG = ROOT + "seg/";
for (const d of [SHOTS, AUDIO, SEG]) fs.mkdirSync(d, { recursive: true });
const [, , stage = "all", only] = process.argv;
const list = videos.filter((v) => !only || v.slug === only);
const logo = "data:image/png;base64," + fs.readFileSync(REPO + "/public/logo.png").toString("base64");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function cardHtml(c) {
  const items = (c.items || []).map((i) => `<li>${esc(i)}</li>`).join("");
  return `<!doctype html><meta charset=utf-8><style>
  *{box-sizing:border-box} body{margin:0;width:1280px;height:720px;background:#fff;font-family:"Hiragino Sans","Noto Sans JP",sans-serif;color:#1f1b19;position:relative;overflow:hidden}
  .bar{position:absolute;left:0;top:0;right:0;height:8px;background:#a91b1b}
  .brand{position:absolute;left:56px;top:36px;display:flex;align-items:center;gap:14px;font-weight:700;font-size:26px}
  .brand img{width:44px;height:44px;border-radius:50%}
  .wrap{position:absolute;left:96px;right:96px;top:150px;bottom:70px;display:flex;flex-direction:column;justify-content:center}
  .kicker{font-size:28px;font-weight:700;color:#a91b1b;margin-bottom:22px;letter-spacing:.04em}
  h1{text-wrap:balance;margin:0;font-size:${c.big ? 66 : 58}px;line-height:1.3;font-weight:800}
  .sub{margin-top:26px;font-size:32px;line-height:1.6;color:#4a4340;font-weight:600}
  ul{margin:30px 0 0;padding:0;list-style:none} li{font-size:32px;line-height:1.5;font-weight:600;margin:10px 0;padding-left:30px;position:relative;color:#2c2623}
  li:before{content:"";position:absolute;left:0;top:.62em;width:12px;height:12px;border-radius:50%;background:#a91b1b}
  .foot{position:absolute;right:56px;bottom:30px;font-size:20px;color:#6a625e;font-weight:600}
  </style><div class=bar></div><div class=brand><img src="${logo}">Synclie</div>
  <div class=wrap><div class=kicker>${esc(c.kicker || "")}</div><h1>${esc(c.title)}</h1>${c.sub ? `<div class=sub>${esc(c.sub)}</div>` : ""}${items ? `<ul>${items}</ul>` : ""}</div>
  <div class=foot>Synclie - Boundless Learning System</div>`;
}

async function overlay(page, hl, banner) {
  const boxes = [];
  for (const h of hl || []) {
    const loc = h.sel ? page.locator(h.sel).first() : page.getByText(h.text).first();
    try {
      await loc.waitFor({ state: "visible", timeout: 4000 });
      const b = await loc.boundingBox();
      if (b) boxes.push({ ...b, n: h.n });
    } catch { console.warn("  ! highlight not found:", h.sel || h.text); }
  }
  await page.evaluate(({ boxes, banner }) => {
    const mk = (css, html = "") => { const d = document.createElement("div"); d.style.cssText = css; d.innerHTML = html; document.body.appendChild(d); return d; };
    for (const b of boxes) {
      mk(`position:fixed;z-index:99998;left:${b.x - 6}px;top:${b.y - 6}px;width:${b.width + 12}px;height:${b.height + 12}px;border:3px solid #e11d48;border-radius:8px;box-shadow:0 0 0 2px rgba(255,255,255,.9);pointer-events:none`);
      if (b.n) mk(`position:fixed;z-index:99999;left:${b.x - 18}px;top:${b.y - 20}px;width:26px;height:26px;border-radius:50%;background:#e11d48;color:#fff;font:800 16px/26px sans-serif;text-align:center;box-shadow:0 0 0 3px #fff;pointer-events:none`, String(b.n));
    }
    if (banner) mk(`position:fixed;z-index:100000;left:0;right:0;bottom:0;height:52px;background:#7f1d1d;color:#fff;font:700 23px/52px "Hiragino Sans",sans-serif;padding:0 30px;letter-spacing:.03em`, banner.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
  }, { boxes, banner });
}

async function shots() {
  const roles = {};
  const ONLY = process.env.IDS ? process.env.IDS.split(",") : null;
  for (const v of list) for (const s of v.scenes) if (s.shot && (!ONLY || ONLY.includes(s.id))) (roles[s.shot.role] ||= []).push(s);
  for (const [role, scenes] of Object.entries(roles)) {
    const { browser, page } = await open(role, { width: 985, height: 554 }, 1.3);
    for (const s of scenes) {
      const sh = s.shot; const out = SHOTS + s.id + ".png";
      console.log("shot", s.id, sh.path);
      await page.goto(BASE + sh.path); await page.waitForLoadState("networkidle").catch(() => {}); await hideDevBadge(page);
      for (const t of sh.open || []) {
        const d = page.locator("details", { hasText: t }).first();
        if (await d.count() && !(await d.evaluate((e) => e.open))) await d.locator("summary").first().click();
      }
      if (sh.scroll || sh.scrollSel) {
        const el = sh.scrollSel ? page.locator(sh.scrollSel).first() : page.getByText(sh.scroll).first();
        await el.waitFor({ state: "attached", timeout: 5000 }).catch(() => console.warn("  ! scroll target missing", sh.scroll || sh.scrollSel));
        const top = sh.scrollOffset ?? 100;
        await el.evaluate((e, top) => { e.scrollIntoView({ block: "start" }); window.scrollBy(0, -top); }, top).catch(() => {});
        await page.waitForTimeout(250);
      }
      await overlay(page, sh.hl, sh.banner);
      await page.screenshot({ path: out });
    }
    await browser.close();
  }
  // cards
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  for (const v of list) for (const s of v.scenes) if (s.card && (!process.env.IDS || process.env.IDS.split(",").includes(s.id))) { await page.setContent(cardHtml(s.card)); await page.screenshot({ path: SHOTS + s.id + ".png" }); }
  await browser.close();
}

const ttsText = (t) => { let o = t; for (const [k, v] of Object.entries(reading).sort((a, b) => b[0].length - a[0].length)) o = o.split(k).join(v); return o; };
const dur = (f) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
function audio() {
  for (const v of list) for (const s of v.scenes) {
    const text = ttsText(s.say); const h = crypto.createHash("md5").update(text).digest("hex").slice(0, 8);
    const wav = AUDIO + `${s.id}-${h}.wav`; s.wav = wav;
    if (fs.existsSync(wav)) continue;
    const tmp = AUDIO + s.id + ".aiff";
    execFileSync("say", ["-v", "Kyoko", "-r", "170", "-o", tmp, text]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, "-ar", "44100", "-ac", "1", wav]);
    fs.unlinkSync(tmp);
  }
}
const ts = (t) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = (t % 60).toFixed(3).padStart(6, "0"); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`; };
function video() {
  audio();
  const outDir = REPO + "/public/guide/"; fs.mkdirSync(outDir, { recursive: true });
  const manifest = JSON.parse(fs.existsSync(REPO + "/src/app/guide/videos.json") ? fs.readFileSync(REPO + "/src/app/guide/videos.json", "utf8") : "[]");
  for (const v of list) {
    const PRE = 0.5, POST = 0.6; let t = 0; const segs = [], cues = [], transcript = [];
    v.scenes.forEach((s, i) => {
      const a = dur(s.wav), total = PRE + a + POST; const seg = SEG + `${v.slug}-${String(i).padStart(2, "0")}.mp4`;
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-framerate", "10", "-i", SHOTS + s.id + ".png", "-i", s.wav,
        "-filter_complex", `[0:v]scale=1280:720,format=yuv420p,fade=t=in:st=0:d=0.3,fade=t=out:st=${(total - 0.3).toFixed(2)}:d=0.3[v];[1:a]adelay=${PRE * 1000},apad,aresample=44100[a]`,
        "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3), "-r", "10", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-tune", "stillimage", "-c:a", "aac", "-b:a", "64k", "-ar", "44100", "-ac", "1", seg]);
      segs.push(seg);
      const sents = s.say.split(/(?<=。)/).filter(Boolean); const len = sents.reduce((n, x) => n + x.length, 0); let c = t + PRE;
      for (const x of sents) { const d = a * (x.length / len); cues.push(`${ts(c)} --> ${ts(c + d)}\n${x.trim()}\n`); c += d; }
      transcript.push({ heading: s.shot ? s.shot.banner : s.card.title, text: s.say });
      t += total;
    });
    fs.writeFileSync(ROOT + `${v.slug}.list`, segs.map((f) => `file '${f}'`).join("\n"));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", ROOT + `${v.slug}.list`, "-c", "copy", "-movflags", "+faststart", outDir + v.slug + ".mp4"]);
    fs.writeFileSync(outDir + v.slug + ".ja.vtt", "WEBVTT\n\n" + cues.join("\n"));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", SHOTS + v.scenes[0].id + ".png", "-q:v", "4", outDir + v.slug + ".jpg"]);
    const entry = { slug: v.slug, title: v.title, description: v.description, seconds: Math.round(t), transcript };
    const k = manifest.findIndex((m) => m.slug === v.slug); if (k >= 0) manifest[k] = entry; else manifest.push(entry);
    console.log(v.slug, Math.round(t) + "s", (fs.statSync(outDir + v.slug + ".mp4").size / 1e6).toFixed(1) + "MB");
  }
  const order = videos.map((v) => v.slug); manifest.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
  fs.mkdirSync(REPO + "/src/app/guide", { recursive: true });
  fs.writeFileSync(REPO + "/src/app/guide/videos.json", JSON.stringify(manifest, null, 2) + "\n");
}
if (stage === "shots" || stage === "all") await shots();
if (stage === "video" || stage === "all") video();
