

const express = require('express');
const puppeteerExtra = require('puppeteer-extra');
const chromium = require('@sparticuz/chromium');
const { Mutex } = require('async-mutex');

const app = express();
const port = 3000;
const lock = new Mutex();
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

    // Set viewport and device parameters
    let deviceSettings = devicePresets[device.toLowerCase()] || devicePresets.desktop;
    
    // Override width and height if provided in query params
    if (width && height) {
      deviceSettings = {
        ...deviceSettings,
        width: parseInt(width),
        height: parseInt(height)
      };
    }

    // Apply device settings
    await page.setUserAgent(deviceSettings.userAgent);
    await page.setViewport({
      width: deviceSettings.width,
      height: deviceSettings.height,
      deviceScaleFactor: deviceSettings.deviceScaleFactor,
      isMobile: deviceSettings.isMobile,
      hasTouch: deviceSettings.hasTouch,
    });

    // Add request interception to optimize loading
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // Skip unnecessary resources
      const resourceType = request.resourceType();
      if (['font', 'media'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Navigate to URL with improved error handling
    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 10000 // 30 second timeout
      });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.warn(`Navigation timeout for ${url}, attempting screenshot anyway`);
      } else {
        throw error;
      }
    }

    // Wait for content to stabilize
    await wait(500);

    // Take screenshot
    const screenshotOptions = {
      fullPage: fullPage === 'true',
      type: 'png',
      encoding: 'binary',
      captureBeyondViewport: true,
    };

    const img = await page.screenshot(screenshotOptions);

    // Set response headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="screenshot.png"');
    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
    res.end(img);

  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).send(`Screenshot failed: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    release();
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(port, () => {
  console.log(`Screenshot service running on port ${port}`);
});