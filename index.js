// ✅ UPDATED GAINER SCRIPT (debug-friendly)
// - Prints exact WP errors (status + response body)
// - Preflight checks /wp-json/ and your exact WP_API_URL
// - Shows payload being sent (so you can match WP-side expectations)

import puppeteer from "puppeteer-extra";
import Stealth from "puppeteer-extra-plugin-stealth";
import chalk from "chalk";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

import { getTopGainers } from "./rediff.js";
import { summariseFeeds } from "./groq.js";
import { visitStockEdge } from "./stockEdge.js";

puppeteer.use(Stealth());

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
  console.log(chalk.cyan("\n===== WP PRE-FLIGHT CHECK (GAINER) ====="));
  console.log("WP_API_URL:", wpApiUrl || "(missing)");
  console.log("WP_USER:", wpUser || "(missing)");
  console.log("WP_PASS:", wpPass ? mask(wpPass) : "(missing)");

  if (!wpApiUrl || !wpUser || !wpPass) {
    console.log(
      chalk.red("❌ Missing WP_API_URL / WP_USER / WP_PASS in your env (.env / secrets).")
    );
    return false;
  }

  // 1) Check /wp-json/ root
  try {
    const rootUrl = new URL("/wp-json/", wpApiUrl).toString();
    const r1 = await axios.get(rootUrl, { timeout: 20000 });
    console.log(chalk.green("✅ /wp-json/ reachable:"), rootUrl, "status:", r1.status);
  } catch (e) {
    console.log(chalk.red("❌ /wp-json/ root failed (domain/WP issue)"));
    console.log("Details:", {
      message: e.message,
      code: e.code,
      status: e.response?.status,
      data: e.response?.data,
    });
    return false;
  }

  // 2) Check your endpoint with GET to see status/response
  try {
    const r2 = await axios.get(wpApiUrl, {
      timeout: 20000,
      auth: { username: wpUser, password: wpPass },
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      validateStatus: () => true,
    });

    console.log(
      chalk.yellow("🔎 Endpoint GET check:"),
      wpApiUrl,
      "status:",
      r2.status
    );

    const preview =
      typeof r2.data === "string"
        ? r2.data.slice(0, 400)
        : JSON.stringify(r2.data).slice(0, 600);

    console.log("Response preview:", preview);
  } catch (e) {
    console.log(chalk.red("❌ Endpoint GET request crashed"));
    console.log("Details:", {
      message: e.message,
      code: e.code,
      status: e.response?.status,
      data: e.response?.data,
    });
    return false;
  }

  console.log(chalk.cyan("===== END PRE-FLIGHT =====\n"));
  return true;
}

async function sendToWordPress(
  stockName,
  nseSymbol,
  changePercent,
  reasons,
  tag = "monthlygainer"
) {
  const payload = {
    stockName,
    nseSymbol,
    changePercent: `+${Number(changePercent).toFixed(2)}%`,
    summary1: reasons?.[0] ?? "",
    summary2: reasons?.[1] ?? "",
    summary3: reasons?.[2] ?? "",
    tag,
  };

  console.log(chalk.blue("\n➡️ Posting to WP"));
  console.log("URL:", wpApiUrl);
  console.log("Payload:", JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(wpApiUrl, payload, {
      auth: { username: wpUser, password: wpPass },
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      validateStatus: () => true, // we'll handle errors ourselves
    });

    console.log(chalk.magenta("📩 WP Response status:"), response.status);

    if (response.status < 200 || response.status >= 300) {
      console.log(chalk.red("❌ WordPress returned an error (non-2xx)"));
      console.log("Response headers:", response.headers);
      console.log("Response data:", response.data);
      return null;
    }

    console.log(chalk.green(`✅ Posted to WordPress for ${stockName}`));
    console.log("Response data:", response.data);
    return response.data;
  } catch (error) {
    console.log(chalk.red("❌ Axios/network crash while posting to WP"));
    console.log("Error details:", {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers,
    });
    return null;
  }
}

/* ---------- Orchestrator ---------- */
(async () => {
  const ok = await wpPreflightCheck();
  if (!ok) {
    console.log(chalk.red("Stopping because WP preflight failed."));
    process.exit(1);
  }

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
  const gainers = await getTopGainers(page);
  console.log(chalk.cyan(`✔ Found ${gainers.length} gainers ≥ 25`));

  for (const g of gainers) {
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

      await sendToWordPress(g.name, symbol, g.change, reasons, "monthlygainer");
      await wait(1000);
    } catch (err) {
      console.log(chalk.red(`Skipped ${g.name}: ${err.message}`));
    }
  }

  await browser.close();
})();
