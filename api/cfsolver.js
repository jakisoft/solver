const express = require("express");
const { TurnstileMin, SolveWafSession } = require("../lib/cfsolver");

const router = express.Router();

async function handleTurnstile(req, res) {
  const url = req.query.url || req.query.link || req.body?.url || req.body?.link;
  const siteKey = req.query.sitekey || req.query.siteKey || req.query.key || req.body?.sitekey || req.body?.siteKey || req.body?.key;
  const proxy = req.query.proxy || req.body?.proxy;

  if (!url) {
    return res.status(400).json({
      status: false,
      message: "url parameter is required"
    });
  }

  if (!siteKey) {
    return res.status(400).json({
      status: false,
      message: "sitekey parameter is required"
    });
  }

  try {
    const token = await TurnstileMin({
      url,
      siteKey,
      proxy
    });

    return res.status(200).json({
      status: true,
      token,
      result: {
        token,
        siteKey,
        url
      }
    });
  } catch (error) {
    if (error.message === "Too Many Requests") {
      return res.status(429).json({
        status: false,
        message: "Server busy, please try again later"
      });
    }

    if (error.message && error.message.includes("Timeout Error")) {
      return res.status(504).json({
        status: false,
        message: "Request timeout"
      });
    }

    return res.status(500).json({
      status: false,
      message: error.message || "Internal Server Error"
    });
  }
}

async function handleWaf(req, res) {
  const url = req.query.url || req.query.link || req.body?.url || req.body?.link;
  const proxy = req.query.proxy || req.body?.proxy;
  const timeoutParam = req.query.timeout || req.body?.timeout;
  const timeout = timeoutParam ? Number(timeoutParam) : undefined;

  if (!url) {
    return res.status(400).json({
      status: false,
      message: "url parameter is required"
    });
  }

  try {
    const result = await SolveWafSession({
      url,
      proxy,
      timeout
    });

    return res.status(200).json({
      status: true,
      result
    });
  } catch (error) {
    if (error.message === "Too Many Requests") {
      return res.status(429).json({
        status: false,
        message: "Server busy, please try again later"
      });
    }

    if (error.message && error.message.includes("Timeout Error")) {
      return res.status(504).json({
        status: false,
        message: "Request timeout"
      });
    }

    return res.status(500).json({
      status: false,
      message: error.message || "Internal Server Error"
    });
  }
}

router.get("/turnstilemin", handleTurnstile);
router.post("/turnstilemin", handleTurnstile);
router.get("/turnstile", handleTurnstile);
router.post("/turnstile", handleTurnstile);

router.get("/waf", handleWaf);
router.post("/waf", handleWaf);

router.get("/", (req, res, next) => {
  if (req.query.url && (req.query.sitekey || req.query.siteKey || req.query.key)) {
    return handleTurnstile(req, res);
  }
  if (req.query.url) {
    return handleWaf(req, res);
  }
  next();
});

router.post("/", (req, res, next) => {
  if (req.body?.url && (req.body?.sitekey || req.body?.siteKey || req.body?.key)) {
    return handleTurnstile(req, res);
  }
  if (req.body?.url) {
    return handleWaf(req, res);
  }
  next();
});

module.exports = router;
