const express = require("express")
const { TurnstileMin } = require("../lib/cfsolver")

const router = express.Router()

router.get("/turnstilemin", async (req, res) => {
  const { url, sitekey } = req.query

  if (!url || !sitekey) {
    return res.status(400).json({
      status: false,
      message: "url and sitekey parameters are required"
    })
  }

  try {
    const token = await TurnstileMin({
      url,
      siteKey: sitekey
    })

    return res.status(200).json({
      status: true,
      token
    })

  } catch (error) {
    console.error("Turnstile Error:", error)

    if (error.message === "Too Many Requests") {
      return res.status(429).json({
        status: false,
        message: "Server busy, please try again later"
      })
    }

    if (error.message === "Timeout Error") {
      return res.status(504).json({
        status: false,
        message: "Request timeout"
      })
    }

    return res.status(500).json({
      status: false,
      message: error.message || "Internal Server Error"
    })
    console.log(error)
  }
})

module.exports = router
