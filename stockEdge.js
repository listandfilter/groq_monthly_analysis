import dayjs from "dayjs";

export async function visitStockEdge(browser, { name }) {
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.118 Safari/537.36";
  const searchPage = await browser.newPage();
  await searchPage.setUserAgent(userAgent);
  await searchPage.goto("https://search.stockedge.com/", {
    waitUntil: "networkidle2",
  });

  /* 1. search */
  await searchPage.type("#searchText", name, { delay: 25 });
  await Promise.all([
    searchPage.keyboard.press("Enter"),
    searchPage.waitForNavigation({ waitUntil: "networkidle2" }),
  ]);

  /* 2. grab first “Stock” result’s URL */
  await searchPage.waitForSelector(".response-table tr", { timeout: 10000 });
  const rawUrl = await searchPage.$eval(
    ".response-table tr td span.entity_name",
    (badge) => {
      // climb up to <td> then first <a> inside
      const td = badge.closest("td");
      return td.querySelector("a").href;
    }
  );

  if (!rawUrl.includes("/share/"))
    throw new Error("No Stock row found in search results");

  const feedUrl = `${rawUrl}?section=feeds`;
  await searchPage.close();

  /* 3. open feeds page directly */
  const page = await browser.newPage();
  await page.goto(feedUrl, { waitUntil: "networkidle2" });
  await page.waitForSelector("ion-item", { timeout: 10000 });

  /* 4. scrape */
  const { symbol, feeds } = await page.evaluate(() => {
    const symbol =
      document
        .querySelector("ion-text.small-font.low-margin-left")
        ?.textContent.trim() || "N/A";
    const feeds = [...document.querySelectorAll("ion-item")].map((it) => ({
      date: it
        .querySelector("ion-col:nth-child(2) ion-text")
        ?.textContent.trim(),
      headline: it.querySelector("p")?.textContent.trim(),
    }));
    return { symbol, feeds };
  });
  await page.close();

  /* 5. keep ≤ 90 days */
  const recentFeeds = feeds
    .filter((f) =>
      dayjs(f.date, "DD-MMM-YYYY").isAfter(dayjs().subtract(90, "day"))
    )
    .map((f) => f.headline);

  return { symbol, recentFeeds };
}
