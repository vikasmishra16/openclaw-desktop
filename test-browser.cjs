
const { chromium } = require('C:/Users/Vineet Kumar Mishra/AppData/Roaming/npm/node_modules/openclaw/node_modules/playwright-core');

(async () => {
    console.log('Launching browser...');
    try {
        const browser = await chromium.launch({ headless: false });
        console.log('Browser launched!');
        const page = await browser.newPage();
        await page.goto('https://example.com');
        console.log('Page loaded!');
        await browser.close();
        console.log('Success!');
    } catch (error) {
        console.error('Failed:', error);
    }
})();
