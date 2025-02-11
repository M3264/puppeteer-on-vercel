const express = require('express');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');
const { Mutex } = require('async-mutex');

const app = express();
const port = process.env.PORT || 3000;
const lock = new Mutex();
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Apply stealth plugin
puppeteerExtra.use(StealthPlugin());

// Device configurations
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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
  }
};

// Browser launch configuration
const getBrowserConfig = () => ({
  args: [
    ...chromium.args,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-extensions'
  ],
  defaultViewport: null,
  executablePath: process.env.CHROME_PATH || chromium.executablePath,
  headless: "new",
  ignoreHTTPSErrors: true
});

// Page setup helper
async function setupPage(browser, deviceConfig) {
  const page = await browser.newPage();
  await page.setUserAgent(deviceConfig.userAgent);
  await page.setViewport({
    width: deviceConfig.width,
    height: deviceConfig.height,
    deviceScaleFactor: deviceConfig.deviceScaleFactor,
    isMobile: deviceConfig.isMobile,
    hasTouch: deviceConfig.hasTouch
  });
  
  // Block unnecessary resources
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
      request.abort();
    } else {
      request.continue();
    }
  });

  return page;
}

// Google search helper
async function extractGoogleResults(page) {
  await page.waitForSelector('div.g', { timeout: 5000 }).catch(() => null);
  
  return page.evaluate(() => {
    const results = [];
    const elements = document.querySelectorAll('div.g');
    
    elements.forEach(element => {
      const titleEl = element.querySelector('h3');
      const linkEl = element.querySelector('a');
      const snippetEl = element.querySelector('div.VwiC3b');
      
      if (titleEl && linkEl) {
        results.push({
          title: titleEl.innerText.trim(),
          link: linkEl.href,
          snippet: snippetEl ? snippetEl.innerText.trim() : ''
        });
      }
    });
    
    return results;
  });
}

// Google Search endpoint
app.get('/google', async (req, res) => {
  const { query, numResults = 10 } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  let browser;
  const release = await lock.acquire();

  try {
    browser = await puppeteerExtra.launch(getBrowserConfig());
    const page = await setupPage(browser, devicePresets.desktop);

    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'networkidle0',
      timeout: 15000
    });

    await wait(1000); // Small delay to ensure content loads
    
    const results = await extractGoogleResults(page);
    
    res.json({
      query,
      results: results.slice(0, parseInt(numResults))
    });

  } catch (error) {
    console.error('Google search error:', error);
    res.status(500).json({ 
      error: 'Search failed',
      message: error.message
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
  const { url, device = 'desktop', width, height, fullPage = 'true' } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  let browser;
  const release = await lock.acquire();

  try {
    browser = await puppeteerExtra.launch(getBrowserConfig());
    
    let deviceConfig = devicePresets[device.toLowerCase()] || devicePresets.desktop;
    if (width && height) {
      deviceConfig = {
        ...deviceConfig,
        width: parseInt(width),
        height: parseInt(height)
      };
    }

    const page = await setupPage(browser, deviceConfig);

    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 15000
    });

    await wait(1000);

    const screenshot = await page.screenshot({
      fullPage: fullPage === 'true',
      type: 'png',
      encoding: 'binary',
      captureBeyondViewport: true
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="screenshot.png"');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(screenshot);

  } catch (error) {
    console.error('Screenshot error:', error);
    res.status(500).json({
      error: 'Screenshot failed',
      message: error.message
    });
  } finally {
    if (browser) {
      await browser.close().catch(console.error);
    }
    release();
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});