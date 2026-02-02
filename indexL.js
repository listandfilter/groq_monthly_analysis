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

/* ---------- IPv4 forced ---------- */
const httpsAgent = new https.Agent({
  keepAlive: true,
  family: 4,
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const wpApiUrl = process.env.WP_API_URL;
const wpUser = process.env.WP_USER;
const wpPass = process.env.WP_PASS;

async function sendToWordPress(
  stockName,
  nseSymbol,
  changePercent,
  reasons,
  tag = "monthlylosers"
) {
  // ✅ FIX: Always provide all summaries
  const safeReasons = [
    reasons?.[0] || "No recent feeds found",
    reasons?.[1] || "Selling pressure continues",
    reasons?.[2] || "Weak price structure observed",
  ];

  const payload = {
    stockName,
    nseSymbol,
    changePercent: `${Number(changePercent).toFixed(2)}%`,
    summary1: safeReasons[0],
    summary2: safeReasons[1],
    summary3: safeReasons[2],
    tag,
  };

  console.log(chalk.blue("\n➡️ Posting to WP (LOSER)"));
  console.log(JSON.stringify(payload, null, 2));

  const res = await axios.post(wpApiUrl, payload, {
    auth: { username: wpUser, password: wpPass },
    timeout: 60000,
    httpsAgent,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    validateStatus: () => true,
  });

  console.log(chalk.magenta("📩 WP status:"), res.status);

  if (res.status < 200 || res.status >= 300) {
    console.log(chalk.red("❌ WP error:"), res.data);
    return;
  }

  console.log(chalk.green(`✅ Posted to WordPress for ${stockName}`));
}

/* ---------- Runner ---------- */
(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
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
    console.log(chalk.yellow(`\n🔍 Processing ${g.name}`));
    try {
      const { symbol, recentFeeds } = await visitStockEdge(browser, g);
      const reasons = await summariseFeeds(g.name, recentFeeds);

      await sendToWordPress(g.name, symbol, g.change, reasons);
      await wait(1000);
    } catch (err) {
      console.log(chalk.red(`Skipped ${g.name}: ${err.message}`));
    }
  }

  await browser.close();
})();
