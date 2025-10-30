import { Stagehand } from "@browserbasehq/stagehand";
import { authenticator } from "otplib";
import { chromium } from "playwright";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const {
  OPENAI_API_KEY,
  LINEAR_API_KEY,
  TARGET_ISSUE_ID, // e.g. PLA-2806 or issue_<uuid>
  APP_BASE_URL,
  USER_NAME,
  PASSWORD,
  TOTP_SECRET,
} = process.env;

/**
 * 📥 Fetch issue directly from Linear using TARGET_ISSUE_ID (like "PLA-2806")
 */
async function getIssueById(identifier) {
  const query = `
    query GetIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        url
      }
    }
  `;

  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_API_KEY,
    },
    body: JSON.stringify({
      query,
      variables: { id: identifier },
    }),
  });

  const data = await res.json();

  if (data.errors) {
    console.error("⚠️ Linear API error:", data.errors);
    throw new Error(`Issue "${identifier}" not found in Linear.`);
  }

  const issue = data?.data?.issue;
  if (!issue) throw new Error(`Issue "${identifier}" not found in Linear.`);

  console.log(`✅ Found issue: ${issue.identifier || identifier} — ${issue.title}`);
  console.log(`🔗 View in Linear: ${issue.url}\n`);
  return issue;
}

/**
 * 🧠 Parse Gherkin-style steps
 */
function parseSteps(description) {
  const bulletRegex = /^(\s*[-•·*]\s*)(Given|When|Then|And)\s/i;
  return description
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => bulletRegex.test(line))
    .map((line) => {
      const cleaned = line.replace(bulletRegex, "").trim();
      return { text: cleaned };
    });
}

/**
 * 🔐 Login to PlannerPal
 */
async function login(stagehand) {
  const page = await stagehand.page;
  await page.goto(APP_BASE_URL, { waitUntil: "networkidle" });
  await page.waitForLoadState("domcontentloaded");

  await page.act("Click the 'Sign In' button");
  await page.act(`Enter "${USER_NAME}" into the email field`);
  await page.act("Click the 'Next' button");
  await page.act(`Enter "${PASSWORD}" into the password field`);
  await page.act("Click the 'Submit' button");

  if (TOTP_SECRET) {
    const token = authenticator.generate(TOTP_SECRET);
    await page.act(
      `Enter the code ${token} into the two-factor authentication field`
    );
    await page.act("Click the 'Submit' button to complete login");
  }

  await page.act("Confirm that the dashboard is visible after login");
}

/**
 * 🧪 Execute steps sequentially
 */
async function runSteps(stagehand, steps) {
  for (const step of steps) {
    const text = step.text;
    console.log(`🧪 Step: ${text}`);

    try {
      await stagehand.page.screenshot({
        path: `step-${text.slice(0, 30).replace(/[^a-z0-9]/gi, "_")}.png`,
      });

      await stagehand.page.act(text);
    } catch (err) {
      console.error(`❌ Failed to execute step: "${text}"`, err.message);
    }
  }
}

/**
 * 🚀 Main runner
 */
(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    modelName: "openai/gpt-4.1-mini",
    modelClientOptions: { apiKey: OPENAI_API_KEY },
  });
  await stagehand.init({ context });

  console.log("🔐 Logging in...");
  await login(stagehand);

  console.log("📥 Fetching issue...");
  const issue = await getIssueById(TARGET_ISSUE_ID);

  const steps = parseSteps(issue.description || "");
  if (steps.length === 0) {
    console.warn("⚠️ No valid steps found in issue description.");
    await browser.close();
    return;
  }

  console.log(`🚦 Running scenario: ${issue.title}`);
  await runSteps(stagehand, steps);

  await browser.close();
})();
