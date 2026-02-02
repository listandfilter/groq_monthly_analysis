import puppeteer from "puppeteer-extra";
import Stealth from "puppeteer-extra-plugin-stealth";
import chalk from "chalk";
import { getTopGainers } from "./rediff.js";
import { summariseFeeds } from "./groq.js";
import { visitStockEdge } from "./stockEdge.js";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

puppeteer.use(Stealth());

/* ---------- Helpers ---------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const wpApiUrl = process.env.WP_API_URL;

async function sendToWordPress(
  stockName,
  nseSymbol,
  changePercent,
  reasons,
  tag = "monthlygainer"
) {
  // 1) Hard fail early if URL missing (most common in GitHub Actions)
  if (!wpApiUrl) {
    console.error("❌ WP_API_URL is missing. Set it in GitHub Secrets / workflow env.");
    return null;
  }

  try {
    const payload = {
      stockName,
      nseSymbol,
      changePercent: `+${Number(changePercent).toFixed(2)}%`,
      summary1: reasons?.[0] ?? "",
      summary2: reasons?.[1] ?? "",
      summary3: reasons?.[2] ?? "",
      tag,
    };

    const response = await axios.post(wpApiUrl, payload, {
      auth: {
        username: process.env.WP_USER ?? "",
        password: process.env.WP_PASS ?? "",
      },
      timeout: 30000,
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true, // so we can see WP error responses in logs
    });

    if (response.status < 200 || response.status >= 300) {
      console.error(`❌ WordPress responded ${response.status}`);
      console.error("URL:", wpApiUrl);
      console.error("Response body:", response.data);
      return null;
    }

    console.log(`✅ Posted to WordPress for ${stockName}:`, response.data);
    return response.data;
  } catch (error) {
    console.error(`❌ WordPress request failed for ${stockName}`);
    console.error("URL:", error.config?.url);
    console.error("Code:", error.code);              // ETIMEDOUT / ECONNRESET etc.
    console.error("Message:", error.message);
    console.error("Status:", error.response?.status);
    console.error("Body:", error.response?.data);
    return null;
  }
}


/* ---------- Orchestrator ---------- */
(async () => {
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

      await sendToWordPress(g.name, symbol, g.change, reasons);
    } catch (err) {
      console.log(chalk.red(`Skipped ${g.name}: ${err.message}`));
    }
  }

  await browser.close();
})();

