const express = require('express');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');
const { Mutex } = require('async-mutex');

const app = express();
const port = 3000;
const lock = new Mutex();
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Apply Puppeteer Stealth Plugin
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('chrome.app'); // Remove broken evasion
puppeteerExtra.use(stealth);

// Predefined device configurations
const devicePresets = {
  mobile: {
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
  },
  tablet: {
    width: 768,
    height: 1024,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
  },
  desktop: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  }
};

// 📸 Screenshot endpoint
app.get('/ss', async (req, res) => {
  const { url, device = 'desktop', width, height, fullPage = 'true' } = req.query;

  if (!url) {
    return res.status(400).send('URL is required');
  }

  let browser;
  const release = await lock.acquire();

  try {
    browser = await puppeteerExtra.launch({
      args: [
        ...chromium.args,
        '--no-zygote',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    let deviceSettings = devicePresets[device.toLowerCase()] || devicePresets.desktop;

    // Override width & height if provided
    if (width && height) {
      deviceSettings = { ...deviceSettings, width: parseInt(width), height: parseInt(height) };
    }

    await page.setUserAgent(deviceSettings.userAgent);
    await page.setViewport({
      width: deviceSettings.width,
      height: deviceSettings.height,
      deviceScaleFactor: deviceSettings.deviceScaleFactor,
      isMobile: deviceSettings.isMobile,
      hasTouch: deviceSettings.hasTouch,
    });

    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (['font', 'media'].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Navigate & take a screenshot
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
    } catch (error) {
      console.warn(`Navigation timeout for ${url}, attempting screenshot anyway`);
    }

    await wait(500);

    const img = await page.screenshot({
      fullPage: fullPage === 'true',
      type: 'png',
      encoding: 'binary',
      captureBeyondViewport: true,
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="screenshot.png"');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(img);

  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).send(`Screenshot failed: ${error.message}`);
  } finally {
    if (browser) await browser.close();
    release();
  }
});

// 🔍 Google Search Scraper Endpoint
app.get('/google', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).send({ error: 'Query parameter is required' });

  let browser;
  const release = await lock.acquire();

  try {
    browser = await puppeteerExtra.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-gpu'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setUserAgent(devicePresets.desktop.userAgent);

    // Navigate to Google Search
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    // Extract search results
    const results = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('div.tF2Cxc')).map(el => ({
        title: el.querySelector('h3')?.innerText || '',
        link: el.querySelector('a')?.href || '',
        snippet: el.querySelector('.VwiC3b')?.innerText || '',
      }));
    });

    res.json({ query, results });

  } catch (error) {
    console.error('Google search failed:', error);
    res.status(500).json({ error: `Google search failed: ${error.message}` });
  } finally {
    if (browser) await browser.close();
    release();
  }
});

// ✅ Health Check
app.get('/health', (req, res) => res.status(200).send('OK'));

// 🚀 Start the Server
app.listen(port, () => {
  console.log(`Service running on port ${port}`);
});