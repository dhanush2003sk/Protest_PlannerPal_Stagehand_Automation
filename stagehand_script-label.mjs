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

    if (/^Acceptance Criteria\s*\(#Stagehand\)/i.test(trimmed)) {
      collecting = true;
      continue;
    }

    if (/^Acceptance Criteria(?!\s*\(#Stagehand\))/i.test(trimmed)) {
      collecting = false;
      continue;
    }

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
    const res = await fetch(AUDIO_URL);
    if (!res.ok) throw new Error(`Failed to fetch audio. Status: ${res.status}`);

    const buffer = await res.arrayBuffer();
    const localPath = "./audio.mp3";
    fs.writeFileSync(localPath, Buffer.from(buffer));
    console.log("⬇️ Audio file saved locally");

    let uploadInput = await page.$('input[type="file"]');

    if (!uploadInput) {
      throw new Error("File input not found on page.");
    }

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

    if (isHidden) {
      const browseButton = await page.$("text=Browse files");
      if (browseButton) {
        console.log("🖱️ Clicking 'Browse files' to activate input...");
        await browseButton.click();
        await page.waitForTimeout(1000);
      }
    }

    uploadInput = await page.$('input[type="file"]');
    await uploadInput.setInputFiles(localPath);
    console.log("📤 Audio file uploaded successfully.");
  } catch (err) {
    console.error("❌ uploadAudio error:", err.message);
    await stagehand.page.screenshot({ path: "FAILED_uploadAudio.png", fullPage: true });
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

      if (
        text.toLowerCase().includes("upload audio") ||
        text.toLowerCase().includes("attach recording")
      ) {
        console.log("🎧 Detected audio upload step — starting upload sequence...");
        await uploadAudio(stagehand);
        console.log("✅ Audio upload completed");

        for (let j = 1; j <= 2; j++) {
          if (steps[i + j]) {
            const nextStep = steps[i + j].text;
            console.log(`➡️ Running post-upload step: "${nextStep}"`);
            await page.act(nextStep);
            console.log(`✅ Completed: "${nextStep}"`);
          }
        }

        const transcriptBtn = await page.waitForSelector("text=View transcript", {
          timeout: 240000,
          state: "visible",
        });

        if (transcriptBtn) {
          await transcriptBtn.click();
          console.log("📄 Clicked 'View transcript' after audio upload.");
        } else {
          throw new Error("Transcript button not found after audio upload.");
        }

        // 🎵 Added: Play and pause the audio element directly
        try {
          console.log("▶️ Attempting to play and pause audio...");
          await page.waitForTimeout(2000);

          // Play
          await page.evaluate(() => {
            const audio = document.querySelector("audio");
            if (!audio) throw new Error("Audio element not found");
            audio.play();
          });
          console.log("🎶 Audio playback started.");
          await page.waitForTimeout(5000); // play for 5 seconds

          // Pause
          await page.evaluate(() => {
            const audio = document.querySelector("audio");
            if (!audio) throw new Error("Audio element not found");
            audio.pause();
          });
          console.log("⏸️ Audio playback paused successfully.");
        } catch (err) {
          console.warn("⚠️ Audio play/pause failed:", err.message);
        }

        i += 3;
        continue;
      }

      if (
        text.toLowerCase().includes("wait until 'view document' button is visible") ||
        (text.toLowerCase().includes("click it") &&
          steps[i - 1]?.text.toLowerCase().includes("generate document"))
      ) {
        console.log("⏳ Waiting for document generation...");

        const documentBtn = await page.waitForSelector("text=View document", {
          timeout: 240000,
          state: "visible",
        });

        if (documentBtn) {
          await documentBtn.click();
          console.log("📄 Clicked 'View document' after generation.");
        } else {
          throw new Error("Document button not found after generation.");
        }

        continue;
      }

      if (text.toLowerCase().includes("enter the otp")) {
        console.log("🔢 Detected OTP entry step...");
        const otpMatch = text.match(/["']?(\d{6})["']?/);
        if (!otpMatch) throw new Error("No 6-digit OTP found in step text");

        const otp = otpMatch[1];
        console.log(`📨 Typing OTP: ${otp}`);

        const otpInputs = await page.locator('input[type="numeric"]');
        const count = await otpInputs.count();

        if (count < 6) throw new Error(`Found only ${count} OTP input boxes`);

        for (let k = 0; k < otp.length; k++) {
          await otpInputs.nth(k).fill(otp[k]);
          await page.waitForTimeout(200);
        }

        console.log("✅ OTP entered successfully.");
        continue;
      }

      if (text.includes("#soloadviser")) {
        console.log("🕒 Staying idle on homepage for #soloadviser...");
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

      if (
        err.message.includes("Target page") ||
        err.message.includes("cdpSession.send")
      ) {
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

      if (["PLA-2705", "PLA-2536", "PLA-2874"].includes(issue.identifier)) {
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

  const midpoint = Math.ceil(projectIssues.length / 2);
  const projectIssuesPart1 = projectIssues.slice(0, midpoint);
  const projectIssuesPart2 = projectIssues.slice(midpoint);

  console.log(`
  🧩 Total Regression Pack issues: ${projectIssues.length}
  ➤ Session 2: ${projectIssuesPart1.length} issues
  ➤ Session 3: ${projectIssuesPart2.length} issues
  `);

  const session1 = runSessionChunk(labeledIssues, "session-labeled");

  const session2 = new Promise((resolve) => {
    setTimeout(() => {
      resolve(runSessionChunk(projectIssuesPart1, "session-project-part1"));
    }, 40000);
  });

  const session3 = new Promise((resolve) => {
    setTimeout(() => {
      resolve(runSessionChunk(projectIssuesPart2, "session-project-part2"));
    }, 70000);
  });

  const results = await Promise.all([session1, session2, session3]);

  console.log("\n========= 🧾 Summary =========");
  console.table(
    results.flat().map((r) => ({
      Identifier: r.identifier,
      Title: r.title,
      Status: r.status,
    }))
  );
})();
