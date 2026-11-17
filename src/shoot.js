// Screenshots each HTML file in a manifest: node shoot.js manifest.json width height
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [manifest, w, h] = process.argv.slice(2);
  const jobs = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  for (const j of jobs) {
    await page.goto('file://' + j.html, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    await page.screenshot({ path: j.out, type: 'jpeg', quality: 90 });
    console.log(j.out);
  }
  await browser.close();
})();
