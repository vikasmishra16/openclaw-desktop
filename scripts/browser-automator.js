import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Persistent storage path (saves cookies/login between runs)
const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE_PATH = join(__dirname, '.browser-state.json');

// Main Entry Point
(async () => {
    // 1. Parse Input Payload
    const envPayload = process.env.BROWSER_PAYLOAD;
    if (!envPayload) {
        console.error("No BROWSER_PAYLOAD provided");
        process.exit(1);
    }

    let payload;
    try {
        payload = JSON.parse(envPayload);
    } catch (e) {
        console.error("Invalid JSON payload:", envPayload);
        process.exit(1);
    }

    console.log(`🤖 Browser Automator Starting: ${payload.task}`);
    console.log(`🛡️ Sandbox: ${payload.sandbox ? 'ON' : 'OFF'}`);

    // 2. Launch Browser using user's Chrome channel for native look
    const browser = await chromium.launch({
        headless: false,
        channel: 'chrome', // Uses real Chrome instead of Chromium test browser
        slowMo: 50
    });

    // 3. Load saved login state if available (persistent sessions)
    const contextOptions = {
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    if (existsSync(STORAGE_PATH)) {
        console.log("📂 Loading saved login session...");
        contextOptions.storageState = STORAGE_PATH;
    } else {
        console.log("🆕 No saved session. You may need to log in.");
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    try {
        // 4. Router
        switch (payload.task) {
            case 'post_linkedin':
                await postToLinkedIn(page, payload.content, payload.confirm, payload.sandbox);
                break;
            case 'search_linkedin':
                await searchLinkedIn(page, payload.query);
                break;
            case 'interact_linkedin':
                await interactLinkedIn(page, payload.instruction, payload.sandbox);
                break;
            case 'comment_linkedin':
                await commentOnLinkedIn(page, payload.query, payload.content, payload.sandbox);
                break;
            default:
                console.error(`Unknown task: ${payload.task}`);
        }
    } catch (e) {
        console.error("Execution Failed:", e.message || e);
    } finally {
        // 5. Save login state for next time (cookies, localStorage, etc.)
        try {
            await context.storageState({ path: STORAGE_PATH });
            console.log("💾 Session saved for next run.");
        } catch (e) {
            console.log("⚠️ Could not save session:", e.message);
        }

        await page.waitForTimeout(2000);
        await browser.close();
        console.log("Browser closed.");
    }
})();

// ================= TASKS =================

async function postToLinkedIn(page, content, autoSubmit, sandbox) {
    console.log("Navigating to LinkedIn...");
    await page.goto('https://linkedin.com/', { waitUntil: 'domcontentloaded' });

    // Check Login — with saved state, this should pass immediately
    try {
        await page.waitForSelector('text=Start a post', { timeout: 8000 });
        console.log("✅ Already logged in (session restored).");
    } catch (e) {
        console.log("⚠️ Not logged in. Please log in manually in the browser window...");
        console.log("   (Your login will be saved for future runs)");
        await page.waitForSelector('text=Start a post', { timeout: 120000 }); // 2 min to login
    }

    console.log("Clicking 'Start a post'...");
    await page.click('text=Start a post');
    await page.waitForTimeout(1000);

    // Type Content  
    console.log("Typing content...");
    const editor = page.getByRole('textbox', { name: 'Text editor for creating content' });
    await editor.fill(content);

    // Submit or Wait
    if (autoSubmit && !sandbox) {
        console.log("Submitting...");
        const postButton = page.getByRole('button', { name: 'Post', exact: true });
        await postButton.waitFor({ state: 'visible' });
        await postButton.click();
        console.log("✅ Posted to LinkedIn!");
        await page.waitForTimeout(3000);
    } else {
        if (sandbox) console.log("🛡️ SANDBOX: Content typed but NOT posted. Review in browser.");
        else console.log("✋ Auto-submit disabled. Review in browser.");
        await page.waitForTimeout(5000);
    }
}

async function searchLinkedIn(page, query) {
    console.log(`Searching for: ${query}`);

    // Go directly to search results URL (bypasses the search box entirely)
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodedQuery}&origin=GLOBAL_SEARCH_HEADER`;

    console.log(`Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check if we got redirected to login
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
        console.log("⚠️ Not logged in. Please log in manually...");
        await page.waitForURL('**/search/**', { timeout: 120000 });
        console.log("✅ Logged in, search results loading...");
        await page.waitForTimeout(3000);
    } else {
        console.log("✅ Logged in. Search results loading...");
    }

    await page.waitForTimeout(3000);

    // Click "Posts" filter if available
    try {
        const postsTab = page.locator('button:has-text("Posts")').first();
        if (await postsTab.count() > 0) {
            await postsTab.click();
            await page.waitForTimeout(2000);
            console.log("📋 Filtered by Posts.");
        }
    } catch (e) { /* Posts filter not available */ }

    // Scroll down to load results
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(2000);

    console.log("✅ Search completed. Results displayed in browser.");
}


async function interactLinkedIn(page, instruction, sandbox) {
    console.log(`Instruction: ${instruction}`);
    await page.goto('https://linkedin.com/feed/', { waitUntil: 'domcontentloaded' });

    try {
        await page.waitForSelector('text=Start a post', { timeout: 8000 });
        console.log("✅ Logged in.");
    } catch (e) {
        console.log("⚠️ Not logged in. Please log in...");
        await page.waitForSelector('text=Start a post', { timeout: 120000 });
    }

    await page.waitForTimeout(3000);

    if (instruction.toLowerCase().includes("like")) {
        console.log("Looking for Like buttons...");
        const likeButtons = page.locator('button[aria-label*="Like"], button[aria-label*="React Like"]');
        const count = await likeButtons.count();

        if (count > 0) {
            console.log(`Found ${count} like buttons.`);
            if (!sandbox) {
                await likeButtons.first().click();
                console.log("✅ Liked the first post!");
            } else {
                console.log("🛡️ SANDBOX: Found like button but skipped clicking.");
            }
        } else {
            console.log("⚠️ No like buttons found on the feed.");
        }
    } else {
        console.log("Navigated to LinkedIn feed.");
    }
}

async function commentOnLinkedIn(page, query, commentText, sandbox) {
    console.log(`Searching for posts with: ${query}`);
    await page.goto('https://linkedin.com/feed/', { waitUntil: 'domcontentloaded' });

    // Check login
    try {
        await page.waitForSelector('text=Start a post', { timeout: 8000 });
        console.log("✅ Logged in.");
    } catch (e) {
        console.log("⚠️ Not logged in. Please log in...");
        await page.waitForSelector('text=Start a post', { timeout: 120000 });
    }

    // Search for the hashtag/query
    const searchBox = page.getByPlaceholder('Search');
    await searchBox.click();
    await searchBox.fill(query);
    await searchBox.press('Enter');
    await page.waitForTimeout(3000);
    console.log("✅ Search results loaded.");

    // Click on "Posts" filter tab if available
    try {
        const postsTab = page.locator('button:has-text("Posts")');
        if (await postsTab.count() > 0) {
            await postsTab.first().click();
            await page.waitForTimeout(2000);
            console.log("Filtered by Posts.");
        }
    } catch (e) { console.log("Posts filter not found, continuing..."); }

    // Find comment buttons
    const commentButtons = page.locator('button[aria-label*="Comment"], button:has-text("Comment")');
    const count = await commentButtons.count();

    if (count > 0) {
        console.log(`Found ${count} comment buttons. Clicking first...`);
        await commentButtons.first().click();
        await page.waitForTimeout(1500);

        // Type the comment
        const commentEditor = page.locator('[role="textbox"]').last();
        await commentEditor.fill(commentText);
        console.log(`Typed comment: "${commentText.slice(0, 60)}..."`);

        if (!sandbox) {
            // Find and click the submit/post comment button
            try {
                const submitBtn = page.locator('button.comments-comment-box__submit-button, button[aria-label*="Post comment"], button:has-text("Post")').last();
                await submitBtn.click();
                console.log("✅ Comment posted!");
            } catch (e) {
                console.log("⚠️ Could not find submit button. Comment typed but not submitted.");
            }
            await page.waitForTimeout(3000);
        } else {
            console.log("🛡️ SANDBOX: Comment typed but NOT submitted.");
            await page.waitForTimeout(5000);
        }
    } else {
        console.log("⚠️ No comment buttons found in search results.");
    }
}
