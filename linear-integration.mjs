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
  APP_BASE_URL,
  USER_NAME,
  PASSWORD,
  TOTP_SECRET
} = process.env;

// ---------------------- 🔍 Fetch Project ----------------------
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
  if (!project) throw new Error(`❌ Project "${projectName}" not found.`);
  return project.id;
}

// ---------------------- 📥 Fetch Issues ----------------------
async function getAllIssues(projectId) {
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
  return data?.data?.issues?.nodes || [];
}

// ---------------------- 🧠 Parse Gherkin Steps ----------------------
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

// ---------------------- 🔐 Login ----------------------
async function login(stagehand) {
  const page = stagehand.page;
  console.log("🔐 Logging into PlannerPal...");

  await page.goto(APP_BASE_URL, { waitUntil: "networkidle" });
  await page.waitForLoadState("domcontentloaded");

  await page.act("Click the 'Sign In' button");
  await page.act(`Enter "${USER_NAME}" into the email field`);
  await page.act("Click the 'Next' button");
  await page.act(`Enter "${PASSWORD}" into the password field`);
  await page.act("Click the 'Submit' button");

  if (TOTP_SECRET) {
    const token = authenticator.generate(TOTP_SECRET);
    console.log("🔐 TOTP Code:", token);
    await page.act(`Enter the code ${token} into the two-factor authentication field`);
    await page.act("Click the 'Submit' button to complete login");
  }

  await page.waitForTimeout(3000); // allow time for dashboard to load

  const pageContent = await page.content();
  if (!pageContent.includes("Welcome") && !pageContent.includes("PlannerPal")) {
    await page.screenshot({ path: "screenshots/login-failure.png" });
    throw new Error("❌ Login failed: Expected home screen content not found.");
  }

  console.log("✅ Logged in successfully.");
}

// ---------------------- 🧪 Run Steps ----------------------
async function runSteps(stagehand, issue) {
  console.log(`🚦 Running scenario: ${issue.title} (${issue.identifier})`);
  const steps = parseSteps(issue.description);

  if (steps.length === 0) {
    console.warn(`⚠️ No valid steps found in issue "${issue.identifier}"`);
    await stagehand.setMetadata({
      status: "skipped",
      reason: "No valid steps found",
      scenario: issue.identifier
    });
    return;
  }

  const page = stagehand.page;
  const failedSteps = [];

  for (const [i, step] of steps.entries()) {
    const text = step.text;
    console.log(`\n🧩 Step ${i + 1}/${steps.length}: "${text}"`);

    try {
      await page.screenshot({
        path: `screenshots/${issue.identifier}-step-${i + 1}.png`
      });

      if (text.includes("#soloadviser")) {
        console.log("🕒 Staying idle on homepage for #soloadviser (no click)...");
        await new Promise(res => setTimeout(res, 5000));
        console.log("✅ Step passed (idle).");
        continue;
      }

      await Promise.race([
        page.act(text),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout: Step took too long")), 10000)
        )
      ]);

      console.log(`✅ Step passed: "${text}"`);
    } catch (err) {
      console.error(`❌ Step failed: "${text}"`);
      console.error("   ↳ Error:", err.message);
      failedSteps.push({ step: text, error: err.message });

      await page.screenshot({
        path: `screenshots/FAILED-${issue.identifier}-step-${i + 1}.png`
      });

      await stagehand.setMetadata({
        status: "failed",
        scenario: issue.identifier,
        failedStep: text,
        errorMessage: err.message
      });

      throw new Error(`❌ Scenario "${issue.identifier}" failed. Steps: ${failedSteps.map(s => s.step).join(", ")}`);
    }
  }

  await stagehand.setMetadata({
    status: "passed",
    scenario: issue.identifier,
    totalSteps: steps.length
  });
}

// ---------------------- 🚀 Main ----------------------
(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    modelName: "gpt-4o",
    modelClientOptions: { apiKey: OPENAI_API_KEY },
  });
  await stagehand.init({ context });

  try {
    await login(stagehand);

    console.log("📥 Fetching Linear project and issues...");
    const projectId = await getProjectId(LINEAR_PROJECT_NAME);
    const issues = await getAllIssues(projectId);

    if (issues.length === 0) {
      console.warn("⚠️ No issues with label 'stagehand_script' found.");
      await browser.close();
      return;
    }

    console.log(`📄 Found ${issues.length} issue(s) to execute.`);

    for (const issue of issues) {
      console.log("\n------------------------------------------");
      try {
        await runSteps(stagehand, issue);
      } catch (err) {
        console.error(`🚨 Scenario "${issue.identifier}" failed:`, err.message);
        continue; // proceed to next issue
      }
    }

    console.log("\n✅ All scenarios processed.");
  } catch (err) {
    console.error("\n🚨 Script terminated due to error:");
    console.error(err.message);
    await stagehand.setMetadata({
      status: "error",
      reason: err.message
    });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
