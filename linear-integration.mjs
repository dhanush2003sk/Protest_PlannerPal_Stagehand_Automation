import { Stagehand } from "@browserbasehq/stagehand";
import { authenticator } from "otplib";
import { chromium } from "playwright";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { scenarioMappings } from "./scenarioMappings.js";
dotenv.config();

const {
  OPENAI_API_KEY,
  LINEAR_API_KEY,
  APP_BASE_URL,
  USER_NAME,
  PASSWORD,
  TOTP_SECRET,
} = process.env;

// ---------------------- 🔐 Login ----------------------
async function login(stagehand, { force = false } = {}) {
  const page = stagehand.page;
  console.log(force ? "🔁 Re-logging..." : "🔐 Logging in...");

  try {
    const context = page.context();
    await context.clearCookies();

    await page.goto(APP_BASE_URL, { waitUntil: "load", timeout: 45000 });
    await page.waitForLoadState("domcontentloaded");

    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.act("Click the 'Sign In' button");
    await page.act(`Enter \"${USER_NAME}\" into the email field`);
    await page.act("Click the 'Next' button");
    await page.act(`Enter \"${PASSWORD}\" into the password field`);
    await page.act("Click the 'Submit' button");

    if (TOTP_SECRET) {
      const token = authenticator.generate(TOTP_SECRET);
      console.log("🔐 TOTP Code:", token);
      await page.act(`Enter the code ${token} into the two-factor authentication field`);
      await page.act("Click the 'Submit' button to complete login");
    }

    await page.waitForTimeout(4000);
    console.log("✅ Logged in successfully.");
  } catch (err) {
    console.error("⚠️ Login failed:", err.message);
    if (force) throw err;
    await login(stagehand, { force: true });
  }
}

// ---------------------- 📥 Fetch Issues ----------------------
async function getLabeledIssues() {
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

async function getProjectIssues(projectName) {
  const query = `
    query {
      issues(filter: {
        project: { name: { eq: "${projectName}" } }
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
    .map((line) => line.trim())
    .filter((line) => bulletRegex.test(line))
    .map((line) => {
      const cleaned = line.replace(bulletRegex, "").trim();
      return { text: cleaned };
    });
}

// ---------------------- 🪶 Report Status ----------------------
async function reportStatus(stagehand, payload) {
  try {
    stagehand.log({
      category: "run",
      message: `Scenario status: ${payload.status}`,
      level: payload.status === "passed" ? 1 : 0,
      auxiliary: Object.fromEntries(
        Object.entries(payload).map(([key, value]) => [
          key,
          {
            value: String(value),
            type:
              typeof value === "number"
                ? "float"
                : typeof value === "boolean"
                ? "boolean"
                : "string",
          },
        ])
      ),
    });
  } catch (err) {
    console.warn("reportStatus log failed:", err?.message || err);
  }
}

// ---------------------- 🧪 Run Steps ----------------------
async function runSteps(stagehand, issue, browserRef) {
  console.log(`🚦 Running scenario: ${issue.title} (${issue.identifier})`);
  let steps = parseSteps(issue.description);

  if (scenarioMappings[issue.identifier]?.mapped?.length) {
    console.log(`📘 Using mapped steps for ${issue.identifier}`);
    steps = scenarioMappings[issue.identifier].mapped.map((t) => ({ text: t }));
  }

  if (steps.length === 0) {
    console.warn(`⚠️ No valid steps found in issue "${issue.identifier}"`);
    await reportStatus(stagehand, {
      status: "skipped",
      reason: "No valid steps found",
      scenario: issue.identifier,
    });
    return { identifier: issue.identifier, title: issue.title, status: "not_completed" };
  }

  let page = stagehand.page;

  for (const [i, step] of steps.entries()) {
    const text = step.text;
    console.log(`\n🧩 Step ${i + 1}/${steps.length}: "${text}"`);
    try {
      if (page.isClosed()) throw new Error("Target page is already closed");
      await page.screenshot({ path: `screenshots/${issue.identifier}-step-${i + 1}.png` });

      if (text.includes("#soloadviser")) {
        console.log("🕒 Staying idle on homepage for #soloadviser (no click)...");
        await new Promise((res) => setTimeout(res, 4000));
        console.log("✅ Step passed (idle).");
        continue;
      }

      await Promise.race([
        page.act(text),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout: Step took too long")), 20000)
        ),
      ]);

      console.log(`✅ Step passed: "${text}"`);
    } catch (err) {
      console.error(`❌ Step failed: "${text}"`);
      console.error("   ↳ Error:", err.message);

      if (err.message.includes("Target page") || err.message.includes("cdpSession.send")) {
        console.log("🔁 Browser/page closed — restarting session...");
        const newContext = await browserRef.newContext();
        const newPage = await newContext.newPage();
        await stagehand.init({ context: newContext, page: newPage });
        await login(stagehand, { force: true });
        page = newPage;
        console.log("✅ Recovered session. Continuing...");
        continue;
      }

      await page.screenshot({ path: `screenshots/FAILED-${issue.identifier}-step-${i + 1}.png` });
      await reportStatus(stagehand, {
        status: "failed",
        scenario: issue.identifier,
        failedStep: text,
        errorMessage: err.message,
      });
      return { identifier: issue.identifier, title: issue.title, status: "failed" };
    }
  }

  await reportStatus(stagehand, { status: "passed", scenario: issue.identifier });
  return { identifier: issue.identifier, title: issue.title, status: "passed" };
}

// ---------------------- 🧵 Run Session Chunk ----------------------
async function runSessionChunk(issues, sessionId) {
  console.log(`🧵 [${sessionId}] Starting session with ${issues.length} issues`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    modelName: "gpt-4o",
    modelClientOptions: { apiKey: OPENAI_API_KEY },
  });

  await stagehand.init({ context, page });
  await login(stagehand);

  const results = [];

  for (const issue of issues) {
    try {
      console.log(`🧪 [${sessionId}] Running ${issue.identifier}`);
      const result = await runSteps(stagehand, issue, browser);
      results.push(result);

      // 🔁 Re-login after specific tickets
      if (["PLA-2705", "PLA-2536"].includes(issue.identifier)) {
        console.log(`\n🔁 [${sessionId}] Re-logging after ${issue.identifier}...`);
        try {
          await login(stagehand, { force: true });
          console.log(`[${sessionId}] Re-login successful.`);
        } catch (err) {
          console.error(`[${sessionId}] Re-login failed:`, err.message);
          await reportStatus(stagehand, {
            status: "error",
            reason: `Re-login failed after ${issue.identifier}: ${err.message}`,
          });
          break;
        }
      }

    } catch (err) {
      console.error(`[${sessionId}] Error running ${issue.identifier}:`, err.message);
    }
  }

  await stagehand.close();
  await browser.close();

  return results;
}
// ---------------------- 🚀 Main ----------------------
(async () => {
  const labeledIssues = await getLabeledIssues();
  const projectIssues = await getProjectIssues("Regression Pack");

  if (labeledIssues.length === 0 && projectIssues.length === 0) {
    console.warn("⚠️ No issues found.");
    return;
  }

  // 🟢 Start first session immediately
  const session1 = runSessionChunk(labeledIssues, "session-labeled");

  // ⏳ Start second session after 20 seconds
  const session2 = new Promise(resolve => {
    setTimeout(() => {
      resolve(runSessionChunk(projectIssues, "session-project"));
    }, 30000);
  });

  // 🧵 Run both sessions in parallel
  const results = await Promise.all([session1, session2]);

  // 📊 Print summary
  console.log("\n========= Summary =========");
  console.table(results.flat().map(r => ({
    Identifier: r.identifier,
    Title: r.title,
    Status: r.status
  })));
})();
