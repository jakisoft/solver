const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { connect } = require("puppeteer-real-browser");

if (!global.timeOut) global.timeOut = 60000;
if (!global.browserLimit) global.browserLimit = 5;
if (!global.browserLength) global.browserLength = 0;
if (!global.activeJobs) global.activeJobs = 0;

const IDLE_CLOSE_TIMEOUT_MS = 60000;

function ensureSnapTmp() {
  if (process.platform !== "linux") return;
  try {
    const base = "/tmp/snap-private-tmp";
    const sub = path.join(base, "snap.chromium");
    const tmp = path.join(sub, "tmp");

    if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    else {
      try { fs.chmodSync(base, 0o700); } catch {}
    }

    if (!fs.existsSync(sub)) fs.mkdirSync(sub, { recursive: true, mode: 0o700 });
    else {
      try { fs.chmodSync(sub, 0o700); } catch {}
    }

    if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true, mode: 0o1777 });
    else {
      try { fs.chmodSync(tmp, 0o1777); } catch {}
    }

    const mntFile = "/run/snapd/ns/chromium.mnt";
    if (fs.existsSync(mntFile)) {
      try {
        const testFile = path.join(tmp, `.test_${Date.now()}`);
        fs.writeFileSync(testFile, "1");
        fs.unlinkSync(testFile);
      } catch {
        try { execSync("umount -l /run/snapd/ns/chromium.mnt 2>/dev/null", { stdio: "ignore" }); } catch {}
        try { fs.unlinkSync(mntFile); } catch {}
        try { fs.unlinkSync("/run/snapd/ns/snap.chromium.fstab"); } catch {}
        try { fs.unlinkSync("/run/snapd/ns/snap.chromium.info"); } catch {}
      }
    }
  } catch {}
}

function killZombieBrowsers() {
  if (process.platform !== "linux") return;
  try {
    execSync("pkill -9 -f 'Xvfb :1' 2>/dev/null", { stdio: "ignore" });
  } catch {}
}

function resetIdleTimer() {
  if (global.idleCloseTimer) {
    clearTimeout(global.idleCloseTimer);
    global.idleCloseTimer = undefined;
  }
}

function scheduleIdleClose() {
  resetIdleTimer();
  if ((global.activeJobs || 0) <= 0) {
    global.idleCloseTimer = setTimeout(async () => {
      if ((global.activeJobs || 0) <= 0 && global.browser) {
        await closeBrowser().catch(() => {});
      }
    }, IDLE_CLOSE_TIMEOUT_MS);
  }
}

async function closeBrowser() {
  resetIdleTimer();
  const currentBrowser = global.browser;
  global.browser = null;
  global.browserPromise = null;
  global.browserLength = 0;

  if (currentBrowser) {
    try {
      if (typeof currentBrowser.close === "function") {
        await currentBrowser.close().catch(() => {});
      }
    } catch {}
  }
  killZombieBrowsers();
}

if (typeof window === "undefined") {
  const handleExit = () => {
    try {
      if (global.browser) {
        global.browser.close().catch(() => {});
        global.browser = null;
      }
    } catch {}
    killZombieBrowsers();
  };
  process.once("SIGTERM", handleExit);
  process.once("SIGINT", handleExit);
  process.once("exit", handleExit);
}

async function createBrowser() {
  resetIdleTimer();
  ensureSnapTmp();

  if (global.browser && global.browser.isConnected && global.browser.isConnected()) {
    return global.browser;
  }
  if (global.browserPromise) return global.browserPromise;

  global.browserPromise = (async () => {
    try {
      global.browser = null;
      const { browser } = await connect({
        headless: false,
        turnstile: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-features=ProcessSingleton",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-background-networking",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-breakpad",
          "--disable-client-side-phishing-detection",
          "--disable-component-update",
          "--disable-default-apps",
          "--disable-extensions",
          "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,AutofillServerCommunication,PrivacySandboxSettings4,RenderDocument",
          "--disable-hang-monitor",
          "--disable-ipc-flooding-protection",
          "--disable-popup-blocking",
          "--disable-prompt-on-repost",
          "--disable-renderer-backgrounding",
          "--disable-sync",
          "--force-color-profile=srgb",
          "--metrics-recording-only",
          "--no-first-run",
          "--mute-audio",
          "--disk-cache-size=10485760",
          "--media-cache-size=10485760",
          "--js-flags=--max-old-space-size=128"
        ],
        connectOption: {
          defaultViewport: null
        },
        disableXvfb: false
      });

      global.browser = browser;

      browser.on("disconnected", () => {
        global.browser = null;
        global.browserPromise = null;
        global.browserLength = 0;
      });

      return browser;
    } catch {
      global.browser = null;
      global.browserPromise = null;
      global.browserLength = 0;
      return null;
    }
  })();

  return global.browserPromise;
}

function parseProxy(proxy) {
  if (!proxy) return undefined;
  if (typeof proxy === "object" && proxy.host && proxy.port) {
    return proxy;
  }
  if (typeof proxy === "string" && proxy.trim()) {
    try {
      const parsedUrl = new URL(proxy.startsWith("http") ? proxy : `http://${proxy}`);
      return {
        host: parsedUrl.hostname,
        port: parsedUrl.port || "80",
        username: parsedUrl.username || undefined,
        password: parsedUrl.password || undefined
      };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function TurnstileMin({ url, proxy, siteKey }) {
  if (!url) throw new Error("Missing url parameter");
  if (!siteKey) throw new Error("Missing siteKey parameter");

  resetIdleTimer();
  global.activeJobs = (global.activeJobs || 0) + 1;

  let context = null;
  let page = null;
  let cl = null;
  let browserIncremented = false;

  const timeoutLimit = global.timeOut || 60000;

  try {
    let browserInstance = global.browser;
    if (!browserInstance || !browserInstance.isConnected || !browserInstance.isConnected()) {
      browserInstance = await createBrowser().catch(() => null);
    }

    if (!browserInstance) {
      throw new Error("Browser not initialized");
    }

    const parsedProxy = parseProxy(proxy);

    if ((global.browserLength || 0) >= (global.browserLimit || 5)) {
      throw new Error("Too Many Requests");
    }

    global.browserLength = (global.browserLength || 0) + 1;
    browserIncremented = true;

    context = await browserInstance
      .createBrowserContext({
        proxyServer: parsedProxy ? `http://${parsedProxy.host}:${parsedProxy.port}` : undefined
      })
      .catch(() => null);

    if (!context) {
      throw new Error("Failed to create browser context");
    }

    const timeoutPromise = new Promise((_, reject) => {
      cl = setTimeout(() => {
        reject(new Error("Timeout Error"));
      }, timeoutLimit);
    });

    const solvePromise = (async () => {
      page = await context.newPage();

      if (parsedProxy?.username && parsedProxy?.password) {
        await page.authenticate({
          username: parsedProxy.username,
          password: parsedProxy.password
        });
      }

      await page.setRequestInterception(true);

      const htmlPath = path.join(__dirname, "../data/fakePage.html");
      let fakeHtml = "";
      try {
        fakeHtml = fs.readFileSync(htmlPath, "utf8");
      } catch {
        fakeHtml = `<!DOCTYPE html><html><body><div class="turnstile"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback" defer></script><script>window.onloadTurnstileCallback=function(){turnstile.render('.turnstile',{sitekey:'<site-key>',callback:function(token){var c=document.createElement('input');c.type='hidden';c.name='cf-response';c.value=token;document.body.appendChild(c);}});};</script></body></html>`;
      }

      page.on("request", async (request) => {
        try {
          const reqUrl = request.url();
          const resType = request.resourceType();
          const cleanReqUrl = reqUrl.split("?")[0].replace(/\/$/, "");
          const cleanTargetUrl = url.split("?")[0].replace(/\/$/, "");

          if ((cleanReqUrl === cleanTargetUrl || [url, url + "/"].includes(reqUrl)) && resType === "document") {
            await request.respond({
              status: 200,
              contentType: "text/html",
              body: fakeHtml.replace(/<site-key>/g, siteKey)
            });
          } else {
            await request.continue();
          }
        } catch {
          try {
            await request.continue().catch(() => {});
          } catch {}
        }
      });

      await page.goto(url, { waitUntil: "domcontentloaded" });

      const startTime = Date.now();
      let token = null;

      while (Date.now() - startTime < timeoutLimit) {
        token = await page.evaluate(() => {
          try {
            const el = document.querySelector('[name="cf-response"]');
            if (el && el.value && el.value.length > 10) return el.value;
            const elTurnstile = document.querySelector('[name="cf-turnstile-response"]');
            if (elTurnstile && elTurnstile.value && elTurnstile.value.length > 10) return elTurnstile.value;
            return null;
          } catch {
            return null;
          }
        });

        if (token) {
          break;
        }

        await new Promise((r) => setTimeout(r, 150));
      }

      if (!token || token.length < 10) {
        throw new Error("Failed to get token");
      }

      return token;
    })();

    return await Promise.race([solvePromise, timeoutPromise]);
  } finally {
    if (cl) clearTimeout(cl);
    if (page) {
      try {
        await page.close().catch(() => {});
      } catch {}
    }
    if (context) {
      try {
        await context.close().catch(() => {});
      } catch {}
    }
    if (browserIncremented) {
      global.browserLength = Math.max(0, (global.browserLength || 1) - 1);
    }
    global.activeJobs = Math.max(0, (global.activeJobs || 1) - 1);
    scheduleIdleClose();
  }
}

async function SolveWafSession({ url, proxy, timeout }) {
  if (!url) throw new Error("Missing url parameter");

  resetIdleTimer();
  global.activeJobs = (global.activeJobs || 0) + 1;

  let context = null;
  let page = null;
  let cl = null;
  let browserIncremented = false;

  const timeoutLimit = timeout || global.timeOut || 60000;

  try {
    let browserInstance = global.browser;
    if (!browserInstance || !browserInstance.isConnected || !browserInstance.isConnected()) {
      browserInstance = await createBrowser().catch(() => null);
    }

    if (!browserInstance) {
      throw new Error("Browser not initialized");
    }

    const parsedProxy = parseProxy(proxy);

    if ((global.browserLength || 0) >= (global.browserLimit || 5)) {
      throw new Error("Too Many Requests");
    }

    global.browserLength = (global.browserLength || 0) + 1;
    browserIncremented = true;

    context = await browserInstance
      .createBrowserContext({
        proxyServer: parsedProxy ? `http://${parsedProxy.host}:${parsedProxy.port}` : undefined
      })
      .catch(() => null);

    if (!context) {
      throw new Error("Failed to create browser context");
    }

    const timeoutPromise = new Promise((_, reject) => {
      cl = setTimeout(() => {
        reject(new Error("Timeout Error waiting for WAF challenge"));
      }, timeoutLimit);
    });

    const solvePromise = (async () => {
      page = await context.newPage();

      if (parsedProxy?.username && parsedProxy?.password) {
        await page.authenticate({
          username: parsedProxy.username,
          password: parsedProxy.password
        });
      }

      await page.setRequestInterception(true);
      page.on("request", (req) => {
        try {
          const resourceType = req.resourceType();
          if (["image", "media", "font"].includes(resourceType)) {
            req.abort();
          } else {
            req.continue();
          }
        } catch {
          try {
            req.continue().catch(() => {});
          } catch {}
        }
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutLimit });

      const startTime = Date.now();
      let cookies = [];
      let cfClearance = "";
      let title = "";
      let userAgent = "";

      while (Date.now() - startTime < timeoutLimit - 3000) {
        cookies = await page.cookies();
        const cfCookie = cookies.find((c) => c.name === "cf_clearance");
        title = await page.title().catch(() => "");
        userAgent = await page.evaluate(() => navigator.userAgent).catch(() => "");

        if (cfCookie && cfCookie.value) {
          cfClearance = cfCookie.value;
          break;
        }

        if (
          !title.toLowerCase().includes("just a moment") &&
          !title.toLowerCase().includes("attention required") &&
          !title.toLowerCase().includes("cloudflare")
        ) {
          if (cookies.length > 0) {
            break;
          }
        }

        await new Promise((r) => setTimeout(r, 600));
      }

      return {
        url,
        title,
        userAgent,
        cookies,
        cfClearance: cfClearance || undefined,
        solved: Boolean(
          cfClearance ||
            (!title.toLowerCase().includes("just a moment") &&
              !title.toLowerCase().includes("attention required"))
        )
      };
    })();

    return await Promise.race([solvePromise, timeoutPromise]);
  } finally {
    if (cl) clearTimeout(cl);
    if (page) {
      try {
        await page.close().catch(() => {});
      } catch {}
    }
    if (context) {
      try {
        await context.close().catch(() => {});
      } catch {}
    }
    if (browserIncremented) {
      global.browserLength = Math.max(0, (global.browserLength || 1) - 1);
    }
    global.activeJobs = Math.max(0, (global.activeJobs || 1) - 1);
    scheduleIdleClose();
  }
}

module.exports = {
  TurnstileMin,
  SolveWafSession,
  createBrowser,
  closeBrowser,
  parseProxy,
  resetIdleTimer,
  scheduleIdleClose,
  ensureSnapTmp,
  killZombieBrowsers
};
