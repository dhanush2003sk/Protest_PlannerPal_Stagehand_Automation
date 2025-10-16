import { Stagehand } from "@browserbasehq/stagehand";
import { authenticator } from "otplib";
import { chromium } from "playwright";
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const {
  OPENAI_API_KEY,
  LINEAR_API_KEY,
  APP_BASE_URL,
  USER_NAME,
  PASSWORD,
  TOTP_SECRET,
} = process.env;

// ---------------------- 🎧 Audio URL ----------------------
const AUDIO_URL =
  "https://raw.githubusercontent.com/dhanush2003sk/Protest_PlannerPal_Stagehand_Automation/main/audio.mp3";

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
    await page.act(`Enter "${USER_NAME}" into the email field`);
    await page.act("Click the 'Next' button");
    await page.act(`Enter "${PASSWORD}" into the password field`);
    await page.act("Click the 'Submit' button");

    if (TOTP_SECRET) {
      const token = authenticator.generate(TOTP_SECRET);
      console.log("🔐 TOTP Code:", token);
      await page.act(
        `Enter the code ${token} into the two-factor authentication field`
      );
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
  console.log("🔍 Parsing issue description...");

  const bulletRegex = /^(\s*[-•·*]\s*)(Given|When|Then|And)\s/i;
  const lines = description.split("\n");

  const steps = [];
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Start collecting when we hit a Stagehand-tagged block
    if (/^Acceptance Criteria\s*\(#Stagehand\)/i.test(trimmed)) {
      collecting = true;
      continue;
    }

    // Stop collecting if we hit another Acceptance Criteria block
    if (/^Acceptance Criteria(?!\s*\(#Stagehand\))/i.test(trimmed)) {
      collecting = false;
      continue;
    }

    // If we're inside a Stagehand block, extract valid steps
    if (collecting && bulletRegex.test(trimmed)) {
      const cleaned = trimmed.replace(bulletRegex, "").trim();
      steps.push({ text: cleaned });
    }
  }

  console.log(`🧩 Extracted ${steps.length} step(s).`);
  return steps;
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

// ---------------------- 🎧 Upload Audio Helper ----------------------
async function uploadAudio(stagehand) {
  const page = stagehand.page;
  console.log("🎧 Starting audio upload...");

  try {
    // Download and save the audio file locally
    const res = await fetch(AUDIO_URL);
    if (!res.ok) throw new Error(`Failed to fetch audio. Status: ${res.status}`);

    const buffer = await res.arrayBuffer();
    const localPath = "./audio.mp3";
    fs.writeFileSync(localPath, Buffer.from(buffer));
    console.log("⬇️ Audio file saved locally");

    // Wait for any file input (even if hidden)
    let uploadInput = await page.$('input[type="file"]');

    if (!uploadInput) {
      throw new Error("File input not found on page.");
    }

    // Check if input is hidden, try to make it visible if needed
    const isHidden = await uploadInput.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.display === "none" || style.visibility === "hidden";
    });

    if (isHidden) {
      console.log("👀 File input is hidden — trying to reveal it...");
      await page.evaluate(() => {
        const el = document.querySelector('input[type="file"]');
        if (el) el.style.display = "block";
      });
    }

    // If still not visible, try clicking “Browse files” to trigger it
    if (isHidden) {
      const browseButton = await page.$("text=Browse files");
      if (browseButton) {
        console.log("🖱️ Clicking 'Browse files' to activate input...");
        await browseButton.click();
        await page.waitForTimeout(1000);
      }
    }

    // Finally set the file
    uploadInput = await page.$('input[type="file"]');
    await uploadInput.setInputFiles(localPath);
    console.log("📤 Audio file uploaded successfully.");
  } catch (err) {
    console.error("❌ uploadAudio error:", err.message);
    await page.screenshot({ path: "FAILED_uploadAudio.png", fullPage: true });
    throw err;
  }
}


// ---------------------- 🧪 Run Steps (Modified Flow) ----------------------
async function runSteps(stagehand, issue, browserRef) {
  console.log(`🚦 Running scenario: ${issue.title} (${issue.identifier})`);

  let steps = parseSteps(issue.description);

  if (steps.length === 0) {
    console.warn(`⚠️ No valid steps found in issue "${issue.identifier}"`);
    await reportStatus(stagehand, {
      status: "skipped",
      reason: "No valid steps found",
      scenario: issue.identifier,
    });
    return {
      identifier: issue.identifier,
      title: issue.title,
      status: "not_completed",
    };
  }

  let page = stagehand.page;

  for (let i = 0; i < steps.length; i++) {
    const text = steps[i].text;
    console.log(`\n🧩 Step ${i + 1}/${steps.length}: "${text}"`);

    try {
      if (page.isClosed()) throw new Error("Target page is already closed");
      await page.screenshot({
        path: `screenshots/${issue.identifier}-step-${i + 1}.png`,
      });

      // 🟩 Handle "upload audio" step
      if (
        text.toLowerCase().includes("upload audio") ||
        text.toLowerCase().includes("attach recording")
      ) {
        console.log("🎧 Detected audio upload step — starting upload sequence...");
        await uploadAudio(stagehand);
        console.log("✅ Audio upload completed");

        // 🟨 Fetch next 2 steps (transcribe + voice note)
        for (let j = 1; j <= 2; j++) {
          if (steps[i + j]) {
            const nextStep = steps[i + j].text;
            console.log(`➡️ Running post-upload step: "${nextStep}"`);
            await page.act(nextStep);
            console.log(`✅ Completed: "${nextStep}"`);
          }
        }

        // 🕒 Wait for transcript to generate
        console.log("⏳ Waiting for transcript generation...");
        const maxWait = 4 * 60 * 1000;
        const checkInterval = 5000;
        let transcriptReady = false;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          const content = await page.content();
          if (
            content.includes("TRANSCRIPT GENERATED") ||
            content.includes("View transcript")
          ) {
            transcriptReady = true;
            break;
          }
          console.log("🕒 Transcript not ready yet, waiting 5s...");
          await page.waitForTimeout(checkInterval);
        }

        if (!transcriptReady)
          throw new Error("Timeout waiting for transcript generation");

        // ✅ Click "View transcript"
        const viewBtn = await page.waitForSelector("text=View transcript", {
          timeout: 30000,
          state: "visible",
        });
        if (viewBtn) {
          await viewBtn.click();
          console.log("📄 Clicked 'View transcript' button after generation completed");
        } else {
          console.warn(
            "⚠️ 'View transcript' button not found even after transcript ready"
          );
        }

        // Skip next two steps since already handled
        i += 2;
        continue;
      }

      // 🟦 Idle or special step
      if (text.includes("#soloadviser")) {
        console.log("🕒 Staying idle on homepage for #soloadviser...");
        await new Promise((res) => setTimeout(res, 4000));
        console.log("✅ Step passed (idle).");
        continue;
      }

      // 🔹 Normal Stagehand action
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

      await page.screenshot({
        path: `screenshots/FAILED-${issue.identifier}-step-${i + 1}.png`,
      });
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

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-gpu", "--no-sandbox"],
  });

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

  try {
    await stagehand.shutdown();
    console.log(`🛑 Browserbase session (${sessionId}) terminated.`);
  } catch (err) {
    console.warn(`⚠️ Could not shut down session (${sessionId}):`, err.message);
  }

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

  const session1 = runSessionChunk(labeledIssues, "session-labeled");

  const session2 = new Promise((resolve) => {
    setTimeout(() => {
      resolve(runSessionChunk(projectIssues, "session-project"));
    }, 30000);
  });

  const results = await Promise.all([session1, session2]);

  console.log("\n========= Summary =========");
  console.table(
    results.flat().map((r) => ({
      Identifier: r.identifier,
      Title: r.title,
      Status: r.status,
    }))
  );
})();
