import { Stagehand } from "@browserbasehq/stagehand";
import { authenticator } from "otplib";
import { chromium } from "playwright";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

// Helper to report run status to Browserbase via Stagehand logs.
// Stagehand v2.5.0 has no stagehand.setMetadata API; instead, Browserbase
// surfaces structured log lines in the session UI and via the Logs API.
// This function standardizes our logging format for pass/fail/skip/error.
async function reportStatus(stagehand, payload) {
  // payload example: { status: "failed", scenario, failedStep, errorMessage }
  try {
    stagehand.log({
      category: "run",
      message: `Scenario status: ${payload.status}`,
      level: payload.status === "passed" ? 1 : 0,
      auxiliary: Object.fromEntries(
        Object.entries(payload).map(([key, value]) => ([
          key,
          { value: String(value), type: typeof value === "number" ? "float" : typeof value === "boolean" ? "boolean" : "string" }
        ]))
      )
    });
  } catch (err) {
    // Best-effort logging; do not throw if logging fails
    console.warn("reportStatus log failed:", err?.message || err);
  }
}

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
async function getAllIssues() {
  const query = `
    query {
      issues(filter: {
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
    // Emit a visible log in Browserbase and return a not_completed result
    await reportStatus(stagehand, {
      status: "skipped",
      reason: "No valid steps found",
      scenario: issue.identifier
    });
    return {
      identifier: issue.identifier,
      title: issue.title,
      status: "not_completed",
      errorMessage: "No valid steps found"
    };
  }

  const page = stagehand.page;

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

      await page.screenshot({
        path: `screenshots/FAILED-${issue.identifier}-step-${i + 1}.png`
      });

      // Mark scenario failure in logs and return structured failure
      await reportStatus(stagehand, {
        status: "failed",
        scenario: issue.identifier,
        failedStep: text,
        errorMessage: err.message
      });

      return {
        identifier: issue.identifier,
        title: issue.title,
        status: "failed",
        failedStep: text,
        errorMessage: err.message
      };
    }
  }

  // Scenario succeeded; log and return structured success
  await reportStatus(stagehand, {
    status: "passed",
    scenario: issue.identifier,
    totalSteps: steps.length
  });
  return {
    identifier: issue.identifier,
    title: issue.title,
    status: "passed"
  };
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

    console.log("📥 Fetching Linear issues with label 'stagehand_script'...");
    const issues = await getAllIssues();

    if (issues.length === 0) {
      // Nothing to run; set a clear run-level status and end gracefully
      console.warn("⚠️ No issues with label 'stagehand_script' found.");
    // Replaced setMetadata with reportStatus for run-level skip
    await reportStatus(stagehand, { status: "skipped", reason: "no_issues" });
      return; // teardown handled in finally
    }

    console.log(`📄 Found ${issues.length} issue(s) to execute.`);

    // Collect structured results for summary
    const results = [];

    for (const issue of issues) {
      console.log("\n------------------------------------------");
      const result = await runSteps(stagehand, issue);
      if (result) results.push(result);
    }

    // Summarize results in terminal
    const counts = { passed: 0, failed: 0, not_completed: 0 };
    for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

    console.log("\n========= Summary =========");
    console.table([
      { Status: "passed", Count: counts.passed || 0 },
      { Status: "failed", Count: counts.failed || 0 },
      { Status: "not_completed", Count: counts.not_completed || 0 },
    ]);

    const byStatus = {
      passed: results.filter(r => r.status === "passed"),
      failed: results.filter(r => r.status === "failed"),
      not_completed: results.filter(r => r.status === "not_completed"),
    };

    const formatLine = r => `- ${r.identifier}: ${r.title}${r.failedStep ? ` | step: ${r.failedStep}` : ""}${r.errorMessage ? ` | error: ${r.errorMessage}` : ""}`;

    if (byStatus.passed.length) {
      console.log("\nPassed:");
      for (const r of byStatus.passed) console.log(formatLine(r));
    }
    if (byStatus.failed.length) {
      console.log("\nFailed:");
      for (const r of byStatus.failed) console.log(formatLine(r));
    }
    if (byStatus.not_completed.length) {
      console.log("\nNot completed:");
      for (const r of byStatus.not_completed) console.log(formatLine(r));
    }

    const hadFailures = (counts.failed || 0) > 0;
    // Emit a final run-level status and set a non-zero exit code if needed
    await reportStatus(stagehand, {
      status: hadFailures ? "failed" : "passed",
      totalScenarios: issues.length,
      passed: counts.passed || 0,
      failed: counts.failed || 0,
      not_completed: counts.not_completed || 0,
    });
    if (hadFailures) process.exitCode = 1;
  } catch (err) {
    console.error("\n🚨 Script terminated due to error:");
    console.error(err.message);
    // Replaced setMetadata with reportStatus to record unexpected script error
    await reportStatus(stagehand, {
      status: "error",
      reason: err.message
    });
    process.exit(1);
  } finally {
    // Always close Stagehand first to flush metadata, then close the browser
    await stagehand.close();
    await browser.close();
  }
})();
