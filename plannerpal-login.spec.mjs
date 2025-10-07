import { authenticator } from "otplib";
import { Stagehand } from "@browserbasehq/stagehand";
 
(async () => {
  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    modelName: 'gpt-4o',
    modelClientOptions: { apiKey: process.env.OPENAI_API_KEY },
    localBrowserLaunchOptions: {
      headless: false,
    },
    verbose: 1,
  });
 
  await stagehand.init(); // ✅ No need to pass a page
 
  try {
    const page = await stagehand.page;
    await page.goto("https://staging.plannerpal.co.uk/", {
      waitUntil: "networkidle",
    });
 
    await page.waitForLoadState("domcontentloaded"); // Optional: ensure page is ready
                                                 
    await page.act("Click the 'Sign In' button");
    await page.act(`Fill in the email field with ${process.env.USER_NAME}`);
    await page.act("Click the 'Next' button");  
    await page.act(`Fill in the password field with ${process.env.PASSWORD}`);
    await page.act("Click the 'Submit' button");
 
    const token = authenticator.generate(process.env.TOTP_SECRET);
    console.log("Generated TOTP:", token);
    await page.act(`Enter the code ${token} into the two-factor authentication field`);
    await page.act("Click the 'Submit' button to complete login");
 
    await page.observe("Confirm that the dashboard is visible after login");
    await page.waitForTimeout(5000);
  } 
  finally {
     //stagehand.browser.close(); // ✅ Use Stagehand's browser instance
}
})();