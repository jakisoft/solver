const express = require("express");
const crypto = require("crypto");
const { HCaptchaSolve } = require("../lib/hcaptchasolver");

const router = express.Router();

// In-memory task storage for 2Captcha-style polling
const tasks = new Map();

// Helper to extract parameters from GET or POST
function getParams(req) {
  const q = req.method === "POST" ? req.body || {} : req.query || {};
  return {
    url: q.url || q.pageurl || q.websiteURL,
    sitekey: q.sitekey || q.siteKey || q.websiteKey,
    rqdata: q.rqdata,
    proxy: q.proxy,
    aiKey: q.aiKey || q.geminiKey || q.ai_key || q.apiKey,
    aiProvider: q.aiProvider || q.provider || q.ai_provider,
    aiModel: q.aiModel || q.model || q.ai_model,
    aiBaseUrl: q.aiBaseUrl || q.baseUrl || q.ai_base_url
  };
}

/**
 * Custom hCaptcha Solve Endpoint (GET & POST)
 * Example: GET /hcaptchasolver/solve?url=https://example.com&sitekey=10000000-ffff-ffff-ffff-000000000001
 */
async function handleSolve(req, res) {
  const { url, sitekey, rqdata, proxy, aiKey, aiProvider, aiModel, aiBaseUrl } = getParams(req);

  if (!url || !sitekey) {
    return res.status(400).json({
      status: false,
      message: "Both 'url' and 'sitekey' parameters are required"
    });
  }

  try {
    const token = await HCaptchaSolve({
      url,
      siteKey: sitekey,
      rqdata,
      proxy,
      aiKey,
      aiProvider,
      aiModel,
      aiBaseUrl
    });

    return res.status(200).json({
      status: true,
      token,
      solution: {
        gRecaptchaResponse: token,
        respKey: token
      }
    });
  } catch (error) {
    console.error("[hCaptcha API] Error:", error.message || error);

    if (error.message === "Too Many Requests") {
      return res.status(429).json({
        status: false,
        message: "Server busy, please try again later"
      });
    }

    if (error.message === "Timeout Error" || error.message?.includes("timeout limit")) {
      return res.status(504).json({
        status: false,
        message: "Request timeout while solving hCaptcha"
      });
    }

    return res.status(500).json({
      status: false,
      message: error.message || "Internal Server Error"
    });
  }
}

router.get("/solve", handleSolve);
router.post("/solve", handleSolve);

// Alias compatible with cfsolver's naming style
router.get("/hcaptchamin", handleSolve);
router.get("/turnstilemin", handleSolve);

/**
 * 2Captcha Compatibility Endpoints
 * Supports /in.php and /res.php format
 */
router.all("/in.php", async (req, res) => {
  const { url, sitekey, rqdata, proxy, aiKey, aiProvider, aiModel, aiBaseUrl } = getParams(req);

  if (!url || !sitekey) {
    return res.send("ERROR_WRONG_USER_KEY");
  }

  const taskId = crypto.randomBytes(8).toString("hex");
  tasks.set(taskId, { status: "processing", token: null, error: null, created: Date.now() });

  // Clean old tasks after 5 minutes
  setTimeout(() => tasks.delete(taskId), 300000);

  // Run in background
  HCaptchaSolve({ url, siteKey: sitekey, rqdata, proxy, aiKey, aiProvider, aiModel, aiBaseUrl })
    .then(token => {
      const task = tasks.get(taskId);
      if (task) {
        task.status = "ready";
        task.token = token;
      }
    })
    .catch(err => {
      const task = tasks.get(taskId);
      if (task) {
        task.status = "error";
        task.error = err.message;
      }
    });

  return res.send(`OK|${taskId}`);
});

router.all("/res.php", (req, res) => {
  const id = req.query.id || req.body?.id;
  const action = req.query.action || req.body?.action || "get";

  if (!id) return res.send("ERROR_WRONG_ID_FORMAT");

  const task = tasks.get(id);
  if (!task) return res.send("ERROR_WRONG_CAPTCHA_ID");

  if (task.status === "processing") {
    return res.send("CAPCHA_NOT_READY");
  }

  if (task.status === "error") {
    return res.send(`ERROR_${task.error || "CAPTCHA_UNSOLVABLE"}`);
  }

  if (task.status === "ready" && task.token) {
    return res.send(`OK|${task.token}`);
  }

  return res.send("CAPCHA_NOT_READY");
});

module.exports = router;
