import puppeteer from "puppeteer-extra";
import Stealth from "puppeteer-extra-plugin-stealth";
import chalk from "chalk";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

import { getTopLoser } from "./rediffL.js";       // <-- your file
import { summariseFeeds } from "./groqL.js";      // <-- your file
import { visitStockEdge } from "./stockEdge.js"; // <-- your file

puppeteer.use(Stealth());

/* ---------- Helpers ---------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const wpApiUrl = process.env.WP_API_URL;
const wpUser = process.env.WP_USER;
const wpPass = process.env.WP_PASS;

function mask(str = "", keep = 3) {
  if (!str) return "";
  if (str.length <= keep) return "*".repeat(str.length);
  return str.slice(0, keep) + "*".repeat(Math.max(0, str.length - keep));
}

async function wpPreflightCheck() {
  console.log(chalk.cyan("\n===== WP ENV CHECK ====="));
  console.log("WP_API_URL:", wpApiUrl || "(missing)");
  console.log("WP_USER:", wpUser || "(missing)");
  console.log("WP_PASS:", wpPass ? mask(wpPass, 4) : "(missing)");

  if (!wpApiUrl || !wpUser || !wpPass) {
    console.log(chalk.red("❌ Missing WP_API_URL / WP_USER / WP_PASS in .env"));
    return false;
  }

  // 1) Check the wp-json root (should respond 200)
  try {
    const rootUrl = new URL("/wp-json/", wpApiUrl).toString();
    const r1 = await axios.get(rootUrl, { timeout: 20000 });
    console.log(chalk.green("✅ WP JSON root OK:"), rootUrl, "status:", r1.status);
  } catch (e) {
    console.log(chalk.red("❌ WP JSON root failed."));
    console.log("Details:", {
      message: e.message,
      code: e.code,
      status: e.response?.status,
      data: e.response?.data,
    });
    return false;
  }

  // 2) Check your exact endpoint with GET (even if it rejects GET, we will see status)
  try {
    const r2 = await axios.get(wpApiUrl, {
      timeout: 20000,
      auth: { username: wpUser, password: wpPass },
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      validateStatus: () => true, // don't throw for 401/403/404
    });

    console.log(
      chalk.yellow("🔎 Endpoint GET check:"),
      wpApiUrl,
      "status:",
      r2.status
    );

    // show small part only
    const preview =
      typeof r2.data === "string"
        ? r2.data.slice(0, 200)
        : JSON.stringify(r2.data).slice(0, 300);

    console.log("Response preview:", preview);
  } catch (e) {
    console.log(chalk.red("❌ Endpoint GET request crashed."));
    console.log("Details:", {
      message: e.message,
      code: e.code,
      status: e.response?.status,
      data: e.response?.data,
    });
    return false;
  }

  console.log(chalk.cyan("===== END CHECK =====\n"));
  return true;
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
    changePercent: `${changePercent.toFixed(2)}%`,
    summary1: reasons?.[0] ?? "",
    summary2: reasons?.[1] ?? "",
    summary3: reasons?.[2] ?? "",
    tag,
  };

  console.log(chalk.blue("\n➡️ Sending payload to WP:"));
  console.log(JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(wpApiUrl, payload, {
      auth: { username: wpUser, password: wpPass },
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      validateStatus: () => true, // IMPORTANT: we handle non-2xx ourselves
    });

    console.log(chalk.magenta("📩 WP Response status:"), response.status);

    // If WP returns an error JSON, show it clearly
    if (response.status < 200 || response.status >= 300) {
      console.log(chalk.red("❌ WordPress returned non-2xx"));
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
    console.log(chalk.red("Stopping because WP preflight check failed."));
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
