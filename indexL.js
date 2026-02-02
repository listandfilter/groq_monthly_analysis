// ==========================
// ✅ indexL.js (LOSER) - IPv4 FORCED VERSION
// ==========================
import puppeteer from "puppeteer-extra";
import Stealth from "puppeteer-extra-plugin-stealth";
import chalk from "chalk";
import axios from "axios";
import dotenv from "dotenv";
import https from "https";

import { getTopLoser } from "./rediffL.js";
import { summariseFeeds } from "./groqL.js";
import { visitStockEdge } from "./stockEdge.js";

dotenv.config();
puppeteer.use(Stealth());

/* ---------- IPv4 Forced HTTPS Agent ---------- */
const httpsAgent = new https.Agent({
  keepAlive: true,
  family: 4, // ✅ FORCE IPv4
});

/* ---------- Helpers ---------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const wpApiUrl = process.env.WP_API_URL;
const wpUser = process.env.WP_USER;
const wpPass = process.env.WP_PASS;

function mask(str = "", keep = 4) {
  if (!str) return "";
  if (str.length <= keep) return "*".repeat(str.length);
  return str.slice(0, keep) + "*".repeat(str.length - keep);
}

async function wpPreflightCheck() {
  console.log(chalk.cyan("\n===== WP PRE-FLIGHT CHECK (LOSER) ====="));
  console.log("WP_API_URL:", wpApiUrl || "(missing)");
  console.log("WP_USER:", wpUser || "(missing)");
  console.log("WP_PASS:", wpPass ? mask(wpPass) : "(missing)");

  if (!wpApiUrl || !wpUser || !wpPass) {
    console.log(chalk.red("❌ Missing WP_API_URL / WP_USER / WP_PASS in env."));
    return false;
  }

  try {
    const rootUrl = new URL("/wp-json/", wpApiUrl).toString();

    const r = await axios.get(rootUrl, {
      timeout: 60000,
      httpsAgent,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      validateStatus: () => true,
    });

    console.log(chalk.yellow("🔎 /wp-json/ status:"), r.status);
    if (r.status < 200 || r.status >= 500) {
      console.log(chalk.red("❌ /wp-json/ looks unreachable or server error"));
      console.log("Preview:", typeof r.data === "string" ? r.data.slice(0, 200) : r.data);
      return false;
    }

    console.log(chalk.green("✅ /wp-json/ reachable via IPv4"));
    return true;
  } catch (e) {
    console.log(chalk.red("❌ /wp-json/ request failed (IPv4 forced)"));
    console.log("Details:", {
      message: e.message,
      code: e.code,
      status: e.response?.status,
      data: e.response?.data,
    });
    return false;
  }
}

async function sendToWordPress(
  stockName,
  nseSymbol,
  changePercent,
  reasons,
  tag = "monthlylosers"
) {
  const payload = {
    stockName,
    nseSymbol,
    changePercent: `${Number(changePercent).toFixed(2)}%`,
    summary1: reasons?.[0] ?? "",
    summary2: reasons?.[1] ?? "",
    summary3: reasons?.[2] ?? "",
    tag,
  };

  console.log(chalk.blue("\n➡️ Posting to WP (LOSER)"));
  console.log("URL:", wpApiUrl);
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(wpApiUrl, payload, {
      auth: { username: wpUser, password: wpPass },
      timeout: 60000,
      httpsAgent, // ✅ IPv4 forced
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      validateStatus: () => true,
    });

    console.log(chalk.magenta("📩 WP status:"), res.status);

    if (res.status < 200 || res.status >= 300) {
      console.log(chalk.red("❌ WP returned error (non-2xx)"));
      console.log("Response data:", res.data);
      return null;
    }

    console.log(chalk.green(`✅ Posted to WordPress for ${stockName}`));
    return res.data;
  } catch (e) {
    console.log(chalk.red("❌ Axios crash posting to WP"));
    console.log("Error:", {
      message: e.message,
      code: e.code,
      status: e.response?.status,
      data: e.response?.data,
    });
    return null;
  }
}

/* ---------- Orchestrator ---------- */
(async () => {
  const ok = await wpPreflightCheck();
  if (!ok) process.exit(1);

  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1920,1080",
    ],
  });

  const [page] = await browser.pages();
  const losers = await getTopLoser(page);
  console.log(chalk.cyan(`✔ Found ${losers.length} losers`));

  for (const g of losers) {
    console.log(chalk.yellow(`\n🔍 Processing ${g.name} ...`));
    try {
      const { symbol, recentFeeds } = await visitStockEdge(browser, g);
      const reasons = await summariseFeeds(g.name, recentFeeds);

      console.log(
        chalk.greenBright(
          JSON.stringify(
            { company: g.name, symbol, change: g.change, reasons },
            null,
            2
          )
        )
      );

      await sendToWordPress(g.name, symbol, g.change, reasons, "monthlylosers");
      await wait(1000);
    } catch (err) {
      console.log(chalk.red(`Skipped ${g.name}: ${err.message}`));
    }
  }

  await browser.close();
})();
