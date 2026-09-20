'use strict';

/**
 * Render an authentic MEPCO bill to PDF using Puppeteer Request Interception.
 * This solves CORS blocking and race conditions by serving the raw HTML on the 
 * authentic domain and explicitly waiting for dynamic JS (QR codes & Meter Snaps) to finish.
 */

const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const path = require('path');

// Ensure this matches the name of your core scraping file
const { fetchMepcoBillRaw } = require('./mepco'); 

const BILL_ORIGIN = 'https://bill.pitc.com.pk';
const DEFAULT_OUTPUT_DIR = path.join(__dirname, 'bills');

async function renderBillPdf(refNo, opts = {}) {
  if (!/^\d{14}$/.test(refNo)) {
    throw new Error('refNo must be a 14-digit MEPCO reference number');
  }

  console.log(`[${refNo}] 1/4 Fetching raw HTML and session cookies...`);
  const { html, bill, cookies } = await fetchMepcoBillRaw(refNo);
  
  if (!html) {
    throw new Error(`Failed to fetch HTML for ${refNo}`);
  }

  console.log(`[${refNo}] 2/4 Launching headless browser...`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });
    
    // Inject the session cookies so authenticated API calls (like meter snaps) succeed
    if (cookies) {
      const cookieObjs = cookies.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return {
          name: name.trim(),
          value: rest.join('=').trim(),
          domain: 'bill.pitc.com.pk'
        };
      }).filter(c => c.name);
      
      if (cookieObjs.length > 0) {
        await page.setCookie(...cookieObjs);
      }
    }

    // Intercept network requests to serve our scraped HTML natively
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url() === `${BILL_ORIGIN}/mock-bill-render`) {
        req.respond({
          status: 200,
          contentType: 'text/html',
          body: html
        });
      } else {
        // Allow all other requests (QR scripts, CSS, and API calls) to proceed naturally
        req.continue();
      }
    });

    console.log(`[${refNo}] 3/4 Rendering page and waiting for dynamic assets...`);
    
    // Navigate to our intercepted URL. 
    // networkidle0 forces the browser to wait until the QR generator finishes 
    // and the async meter snap API completes its payload.
    await page.goto(`${BILL_ORIGIN}/mock-bill-render`, {
      waitUntil: 'networkidle0',
      timeout: 45000
    });

    // Add a 1-second artificial delay to ensure canvas elements (QR codes) are fully painted
    await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));

    const outputDir = opts.outputDir || DEFAULT_OUTPUT_DIR;
    await fs.mkdir(outputDir, { recursive: true });
    const pdfPath = path.join(outputDir, `mepco_${refNo}.pdf`);

    console.log(`[${refNo}] 4/4 Saving PDF...`);
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      format: 'A4',
      margin: { top: '0', bottom: '0', left: '0', right: '0' } 
    });

    return { pdfPath, bill };
  } finally {
    await browser.close();
  }
}

module.exports = { renderBillPdf };

// CLI Runner for quick testing
if (require.main === module) {
  const refNo = process.argv[2];
  if (!refNo) {
    console.error('Usage: node mepco-pdf.js <14-digit reference number>');
    process.exit(1);
  }
  renderBillPdf(refNo)
    .then(({ pdfPath }) => {
      console.log(`✅ Success! PDF saved with QR codes and images: ${pdfPath}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Render failed:', err);
      process.exit(1);
    });
}
