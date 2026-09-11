const fs = require("fs");
const path = require("path");
const { solveVisualChallenge } = require("./visionSolver");
const { createBrowser } = require("./cfsolver");

if (!global.timeOut) global.timeOut = 60000;
if (!global.browserLimit) global.browserLimit = 20;
if (!global.browserLength) global.browserLength = 0;
if (!global.finished) global.finished = false;

// Ensure browser is available
async function getBrowser(maxWaitMs = 30000) {
  if (global.browser && global.browser.isConnected()) {
    return global.browser;
  }
  if (!global.browser) {
    createBrowser().catch(() => {});
  }
  const start = Date.now();
  while ((!global.browser || !global.browser.isConnected()) && Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 500));
  }
  if (!global.browser || !global.browser.isConnected()) {
    throw new Error("Browser not initialized. Please ensure the server is ready.");
  }
  return global.browser;
}

function parseProxy(proxy) {
  if (!proxy) return null;
  if (typeof proxy === "object" && proxy.host && proxy.port) {
    return proxy;
  }
  if (typeof proxy === "string") {
    try {
      const url = new URL(proxy.startsWith("http") ? proxy : `http://${proxy}`);
      return {
        host: url.hostname,
        port: url.port,
        username: url.username || undefined,
        password: url.password || undefined
      };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Solves an interactive visual hCaptcha challenge with AI Vision
 */
async function handleVisualChallenge(page, challengeFrame, aiOptions = {}) {
  try {
    const promptText = await challengeFrame.$eval('.prompt-text, h2', el => el.innerText.trim()).catch(() => "");
    if (!promptText) return false;

    const challengeElement = await page.$('iframe[src*="hcaptcha.com"][src*="frame=challenge"]');
    if (!challengeElement) return false;

    const box = await challengeElement.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) return false;

    const screenshotBuffer = await page.screenshot({
      clip: {
        x: Math.max(0, Math.floor(box.x)),
        y: Math.max(0, Math.floor(box.y)),
        width: Math.floor(box.width),
        height: Math.floor(box.height)
      },
      type: "jpeg",
      quality: 80
    });

    const base64Image = screenshotBuffer.toString("base64");
    const tiles = await challengeFrame.$$('.task-image');
    const tileCount = tiles.length || 9;

    if (tileCount === 0) return false;

    const matchedIndices = await solveVisualChallenge({
      base64Image,
      promptText,
      tileCount,
      ...aiOptions
    });

    console.log(`[hCaptcha Solver] Prompt: "${promptText}" | Detected tiles to click:`, matchedIndices);

    for (const tileNum of matchedIndices) {
      const idx = tileNum - 1;
      if (tiles[idx]) {
        await tiles[idx].click().catch(() => {});
        await new Promise(r => setTimeout(r, 120 + Math.random() * 100));
      }
    }

    await new Promise(r => setTimeout(r, 350));
    const submitBtn = await challengeFrame.$('.button-submit, .prompt-submit, div[title="Verify"], div[title="Next"]');
    if (submitBtn) {
      await submitBtn.click().catch(() => {});
    }

    await new Promise(r => setTimeout(r, 2000));
    return true;
  } catch (err) {
    console.error("[hCaptcha Solver] Visual solve error:", err.message);
    return false;
  }
}

/**
 * Main hCaptcha solver function
 * @param {Object} params
 * @param {string} params.url - Target page URL
 * @param {string} params.siteKey - hCaptcha sitekey
 * @param {string} [params.rqdata] - Enterprise rqdata payload (used e.g. by ElevenLabs)
 * @param {Object|string} [params.proxy] - Proxy config
 * @param {string} [params.aiKey] - AI API key (Groq, OpenRouter, HuggingFace, Gemini, etc.)
 * @param {string} [params.aiProvider] - 'groq' | 'openrouter' | 'huggingface' | 'ollama' | 'gemini' | 'custom'
 * @param {string} [params.aiModel] - Optional model override
 * @param {string} [params.aiBaseUrl] - Optional base URL (e.g. for Ollama)
 * @param {number} [params.timeout] - Timeout in milliseconds
 * @returns {Promise<string>} Solved token
 */
function HCaptchaSolve({
  url,
  siteKey,
  rqdata,
  proxy,
  aiKey,
  aiProvider,
  aiModel,
  aiBaseUrl,
  timeout = global.timeOut
}) {
  return new Promise(async (resolve, reject) => {
    if (!url) return reject(new Error("Missing url parameter"));
    if (!siteKey) return reject(new Error("Missing siteKey parameter"));

    let browser;
    try {
      browser = await getBrowser();
    } catch (err) {
      return reject(err);
    }

    if (global.browserLength >= global.browserLimit) {
      return reject(new Error("Too Many Requests"));
    }

    global.browserLength++;

    const parsedProxy = parseProxy(proxy);
    const context = await browser
      .createBrowserContext({
        proxyServer: parsedProxy ? `http://${parsedProxy.host}:${parsedProxy.port}` : undefined
      })
      .catch(() => null);

    if (!context) {
      global.browserLength--;
      return reject(new Error("Failed to create browser context"));
    }

    let isDone = false;
    const timeoutHandle = setTimeout(async () => {
      if (!isDone) {
        isDone = true;
        await context.close().catch(() => {});
        global.browserLength--;
        reject(new Error("Timeout Error"));
      }
    }, timeout || 60000);

    try {
      const page = await context.newPage();

      if (parsedProxy?.username && parsedProxy?.password) {
        await page.authenticate({
          username: parsedProxy.username,
          password: parsedProxy.password
        });
      }

      await page.setRequestInterception(true);

      const fakeHtmlPath = path.join(__dirname, "../data/fakePageHCaptcha.html");
      const fakeHtml = fs
        .readFileSync(fakeHtmlPath, "utf8")
        .replace(/<site-key>/g, siteKey)
        .replace(/<rq-data>/g, rqdata || "");

      page.on("request", async request => {
        const reqUrl = request.url();
        if (
          ([url, url + "/"].includes(reqUrl) || reqUrl.startsWith(url)) &&
          request.resourceType() === "document"
        ) {
          await request.respond({
            status: 200,
            contentType: "text/html",
            body: fakeHtml
          });
        } else {
          await request.continue();
        }
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Poll until the hCaptcha checkbox frame is attached with proper URL
      let checkboxFrame = null;
      const frameStart = Date.now();
      while (!checkboxFrame && Date.now() - frameStart < 20000) {
        checkboxFrame = page.frames().find(
          f => f.url().includes("hcaptcha.com") && f.url().includes("frame=checkbox")
        );
        if (!checkboxFrame) await new Promise(r => setTimeout(r, 200));
      }

      if (!checkboxFrame) {
        throw new Error("hCaptcha checkbox iframe not found");
      }

      // Locate and click the checkbox element
      const checkbox = await checkboxFrame.waitForSelector('#checkbox, [role="checkbox"], #anchor', {
        timeout: 15000
      });

      if (!checkbox) {
        throw new Error("hCaptcha checkbox button not found");
      }

      const box = await checkbox.boundingBox();
      if (box) {
        await page.mouse.click(box.x + 30, box.y + box.height / 2);
      } else {
        await checkbox.click();
      }

      // Resolve effective AI configurations
      const effectiveAiKey =
        aiKey ||
        process.env.AI_API_KEY ||
        process.env.GROQ_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        process.env.HUGGINGFACE_TOKEN ||
        process.env.HF_TOKEN ||
        process.env.GEMINI_API_KEY;

      const effectiveProvider = aiProvider || process.env.AI_PROVIDER;
      const effectiveModel = aiModel || process.env.AI_MODEL;
      const effectiveBaseUrl = aiBaseUrl || process.env.AI_BASE_URL || process.env.OLLAMA_BASE_URL;

      const canSolveVisual = Boolean(
        effectiveAiKey ||
        effectiveBaseUrl ||
        effectiveProvider === "ollama"
      );

      const loopStart = Date.now();
      const maxWait = (timeout || 60000) - 5000;
      let visualAttempts = 0;

      while (!isDone && Date.now() - loopStart < maxWait) {
        // 1. Check if token is ready (must be non-empty and length > 20)
        const token = await page.evaluate(() => {
          const els = document.querySelectorAll('[name="h-captcha-response"], [name="g-recaptcha-response"]');
          for (const el of els) {
            if (el && el.value && el.value.length > 20) return el.value;
          }
          return null;
        });

        if (token) {
          isDone = true;
          clearTimeout(timeoutHandle);
          await context.close().catch(() => {});
          global.browserLength--;
          return resolve(token);
        }

        // 2. Check for explicit error from hCaptcha
        const errMsg = await page.evaluate(() => {
          const errEl = document.querySelector('[name="h-captcha-error"]');
          return errEl ? errEl.value : null;
        });

        if (errMsg) {
          throw new Error(`hCaptcha error: ${errMsg}`);
        }

        // 3. Check for challenge frame (visual puzzle)
        const challengeFrame = page
          .frames()
          .find(f => f.url().includes("hcaptcha.com") && f.url().includes("frame=challenge"));

        if (challengeFrame && visualAttempts < 4) {
          const promptEl = await challengeFrame.$('.prompt-text, h2');
          if (promptEl) {
            const hasTiles = await challengeFrame.$('.task-image');
            if (hasTiles) {
              if (canSolveVisual) {
                visualAttempts++;
                console.log(`[hCaptcha Solver] Solving visual challenge (attempt ${visualAttempts})...`);
                await handleVisualChallenge(page, challengeFrame, {
                  apiKey: effectiveAiKey,
                  provider: effectiveProvider,
                  model: effectiveModel,
                  baseUrl: effectiveBaseUrl
                });
              } else {
                const promptText = await promptEl.evaluate(el => el.innerText.trim()).catch(() => "");
                throw new Error(
                  `Visual challenge detected ("${promptText || "Interactive puzzle"}"). To solve image puzzles for FREE without billing, set GROQ_API_KEY (from console.groq.com) or OPENROUTER_API_KEY (from openrouter.ai), or provide 'aiKey' / 'aiProvider' parameter.`
                );
              }
            }
          }
        }

        await new Promise(r => setTimeout(r, 800));
      }

      throw new Error("Failed to obtain hCaptcha token within timeout limit");
    } catch (e) {
      if (!isDone) {
        isDone = true;
        clearTimeout(timeoutHandle);
        await context.close().catch(() => {});
        global.browserLength--;
        reject(e);
      }
    }
  });
}

module.exports = { HCaptchaSolve };
