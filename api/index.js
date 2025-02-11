const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { Mutex } = require('async-mutex');

const app = express();
const port = process.env.PORT || 3000;
const lock = new Mutex();

// Simplified browser configuration for Lambda
const getBrowser = async () => {
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
};

// Common user agents
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EdgeHTML/119.0.0.0'
];

// Google search endpoint
app.get('/google', async (req, res) => {
  const { query, num = 10 } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  let browser;
  const release = await lock.acquire();

  try {
    browser = await getBrowser();
    const page = await browser.newPage();

    // Set random user agent
    await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);

    // Basic request interception
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Navigate to Google
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num}`, {
      waitUntil: 'networkidle0',
      timeout: 10000
    });

    // Extract results
    const results = await page.evaluate(() => {
      const searchResults = [];
      const resultElements = document.querySelectorAll('#search .g');

      resultElements.forEach(element => {
        const titleElement = element.querySelector('h3');
        const linkElement = element.querySelector('a');
        const snippetElement = element.querySelector('.VwiC3b');

        if (titleElement && linkElement) {
          searchResults.push({
            title: titleElement.textContent.trim(),
            url: linkElement.href,
            snippet: snippetElement ? snippetElement.textContent.trim() : ''
          });
        }
      });

      return searchResults;
    });

    res.json({
      query,
      results: results.slice(0, parseInt(num))
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: 'Search failed',
      details: error.message
    });
  } finally {
    if (browser) {
      await browser.close().catch(console.error);
    }
    release();
  }
});

// Screenshot endpoint
app.get('/screenshot', async (req, res) => {
  const { url, fullPage = 'true' } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  let browser;
  const release = await lock.acquire();

  try {
    browser = await getBrowser();
    const page = await browser.newPage();

    // Set viewport
    await page.setViewport({
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
    });

    // Set random user agent
    await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);

    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 10000
    });

    const screenshot = await page.screenshot({
      fullPage: fullPage === 'true',
      type: 'png',
      encoding: 'binary'
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(screenshot);

  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).json({
      error: 'Screenshot failed',
      details: error.message
    });
  } finally {
    if (browser) {
      await browser.close().catch(console.error);
    }
    release();
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});