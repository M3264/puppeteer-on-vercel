const express = require('express');
const puppeteerExtra = require('puppeteer-extra');
const chromium = require('@sparticuz/chromium');
const { Mutex } = require('async-mutex');

const app = express();
const port = 3000;
const lock = new Mutex();

// Browser pool configuration
let browserPool = null;
const MAX_POOL_SIZE = 3; // Adjust based on your server's capacity

// Initialize browser pool
async function initBrowserPool() {
  if (!browserPool) {
    browserPool = [];
    for (let i = 0; i < MAX_POOL_SIZE; i++) {
      const browser = await puppeteerExtra.launch({
        args: [
          ...chromium.args,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--hide-scrollbars',
          '--disable-notifications',
          '--disable-extensions',
          '--disable-logging',
          '--no-default-browser-check',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-component-extensions-with-background-pages',
          '--disable-features=TranslateUI,BlinkGenPropertyTrees',
          '--disable-ipc-flooding-protection',
          '--disable-renderer-backgrounding',
          '--enable-low-end-device-mode',
        ],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
    });
      browserPool.push(browser);
    }
  }
}

// Get available browser from pool
async function getBrowser() {
  if (!browserPool) await initBrowserPool();
  return browserPool[Math.floor(Math.random() * MAX_POOL_SIZE)];
}

// Device configurations optimized for speed
const devicePresets = {
  mobile: {
    width: 375,
    height: 667,
    deviceScaleFactor: 1, // Reduced for speed
    isMobile: true,
  },
  tablet: {
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    isMobile: true,
  },
  desktop: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
  }
};

app.get('/ss', async (req, res) => {
  const { url, device = 'desktop', width, height, fullPage = 'true' } = req.query;
  
  if (!url) {
    return res.status(400).send('URL required');
  }

  let page;
  const release = await lock.acquire();

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Aggressive performance optimizations
    await page.setCacheEnabled(true);
    await page.setRequestInterception(true);
    
    // Block unnecessary resources
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media', 'websocket'].includes(resourceType)) {
        req.abort();
      } else if (resourceType === 'script') {
        // Only allow essential scripts
        req.abort();
      } else {
        req.continue();
      }
    });

    // Disable JavaScript for faster loading
    await page.setJavaScriptEnabled(false);

    // Apply device settings
    let deviceSettings = devicePresets[device.toLowerCase()] || devicePresets.desktop;
    if (width && height) {
      deviceSettings.width = parseInt(width);
      deviceSettings.height = parseInt(height);
    }

    await page.setViewport(deviceSettings);

    // Optimized page load
    await page.goto(url, {
      waitUntil: 'domcontentloaded', // Faster than networkidle2
      timeout: 10000 // 10 second timeout
    });

    // Take screenshot immediately
    const img = await page.screenshot({
      fullPage: fullPage === 'true',
      type: 'jpeg', // JPEG is faster than PNG
      quality: 80, // Reduced quality for speed
      encoding: 'binary',
    });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', 'inline; filename="screenshot.jpg"');
    res.end(img);

  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).send('Screenshot failed');
  } finally {
    if (page) {
      await page.close(); // Close page but keep browser
    }
    release();
  }
});

// Initialize browser pool on startup
app.listen(port, async () => {
  await initBrowserPool();
  console.log(`Fast screenshot service running on port ${port}`);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browserPool) {
    for (const browser of browserPool) {
      await browser.close();
    }
  }
  process.exit();
});