import { Stagehand } from "@browserbasehq/stagehand";
import { authenticator } from "otplib";
import { chromium } from "playwright";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();
 
const {
  OPENAI_API_KEY,
  LINEAR_API_KEY,
  LINEAR_PROJECT_NAME,
  TARGET_ISSUE_ID,
  APP_BASE_URL,
  USER_NAME,
  PASSWORD,
  TOTP_SECRET
} = process.env;
 
// 🔍 Resolve Linear project ID
async function getProjectId(projectName) {
  const query = `
    query {
      projects {
        nodes {
          id
          name
        }
      }
    }
  `;
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_API_KEY,
    },
    body: JSON.stringify({ query }),
  });
 
  const data = await res.json();
  const project = data?.data?.projects?.nodes?.find(p => p.name === projectName);
  if (!project) throw new Error(`Project "${projectName}" not found.`);
  return project.id;
}
 
// 📥 Fetch issue by ID
async function getIssueById(projectId, issueId) {
  const query = `
    query {
      issues(filter: {
        project: { id: { eq: "${projectId}" } },
        labels: { name: { eq: "stagehand_script" } }
      }) {
        nodes {
          id
          identifier
          title
          description
        }
      }
    }
  `;
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_API_KEY,
    },
    body: JSON.stringify({ query }),
  });
 
  const data = await res.json();
  const issue = data?.data?.issues?.nodes?.find(i => i.identifier === issueId);
  if (!issue) throw new Error(`Issue "${issueId}" not found.`);
  return issue;
}
 
// 🧠 Parse Gherkin-style steps (no mapping)
function parseSteps(description) {
  const bulletRegex = /^(\s*[-•·*]\s*)(Given|When|Then|And)\s/i;
  return description
    .split("\n")
    .map(line => line.trim())
    .filter(line => bulletRegex.test(line))
    .map(line => {
      const cleaned = line.replace(bulletRegex, "").trim();
      return { text: cleaned };
    });
}
 
// 🔐 Login to PlannerPal
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
    await page.act(`Enter the code ${token} into the two-factor authentication field`);
    await page.act("Click the 'Submit' button to complete login");
  }
 
  await page.act("Confirm that the dashboard is visible after login");
}
 
// 🧪 Execute scenario steps (direct execution)
async function runSteps(stagehand, steps) {
  for (const step of steps) {
    const text = step.text;
    console.log(`🧪 Step: ${text}`);
 
    try {
      await stagehand.page.screenshot({
        path: `step-${text.slice(0, 30).replace(/[^a-z0-9]/gi, "_")}.png`
      });
 
      await stagehand.page.act(text);
    } catch (err) {
      console.error(`❌ Failed to execute step: "${text}"`, err);
    }
  }
}
 
// 🚀 Main
(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
 
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    modelName: "gpt-4o",
    modelClientOptions: { apiKey: OPENAI_API_KEY },
  });
  await stagehand.init({ context });
 
  console.log("🔐 Logging in...");
  await login(stagehand);
 
  console.log("📥 Fetching issue...");
  const projectId = await getProjectId(LINEAR_PROJECT_NAME);
  const issue = await getIssueById(projectId, TARGET_ISSUE_ID);
 
  const steps = parseSteps(issue.description);
  if (steps.length === 0) {
    console.warn("⚠️ No valid steps found in issue description.");
    await browser.close();
    return;
  }
 
  console.log(`🚦 Running scenario: ${issue.title}`);
  await runSteps(stagehand, steps);
 
  await browser.close();
})();