const fs = require("fs")
const path = require("path")
const { connect } = require("puppeteer-real-browser")

if (!global.timeOut) global.timeOut = 60000
if (!global.browserLimit) global.browserLimit = 20
if (!global.browserLength) global.browserLength = 0
if (!global.finished) global.finished = false

async function createBrowser() {
  try {
    if (global.finished === true) return

    global.browser = null

    const { browser } = await connect({
      headless: false,
      turnstile: true,
      connectOption: { defaultViewport: null },
      disableXvfb: false,
    })

    global.browser = browser

    browser.on("disconnected", async () => {
      if (global.finished === true) return
      await new Promise(r => setTimeout(r, 3000))
      await createBrowser()
    })
  } catch (e) {
    if (global.finished === true) return
    await new Promise(r => setTimeout(r, 3000))
    await createBrowser()
  }
}

createBrowser()

function TurnstileMin({ url, proxy, siteKey }) {
  return new Promise(async (resolve, reject) => {
    if (!url) return reject("Missing url parameter")
    if (!siteKey) return reject("Missing siteKey parameter")
    if (!global.browser) return reject("Browser not initialized")

    if (global.browserLength >= global.browserLimit)
      return reject("Too Many Requests")

    global.browserLength++

    const context = await global.browser
      .createBrowserContext({
        proxyServer: proxy ? `http://${proxy.host}:${proxy.port}` : undefined,
      })
      .catch(() => null)

    if (!context) {
      global.browserLength--
      return reject("Failed to create browser context")
    }

    let isResolved = false

    const cl = setTimeout(async () => {
      if (!isResolved) {
        isResolved = true
        await context.close().catch(() => {})
        global.browserLength--
        reject("Timeout Error")
      }
    }, global.timeOut)

    try {
      const page = await context.newPage()

      if (proxy?.username && proxy?.password) {
        await page.authenticate({
          username: proxy.username,
          password: proxy.password,
        })
      }

      await page.setRequestInterception(true)

      page.on("request", async request => {
        if (
          [url, url + "/"].includes(request.url()) &&
          request.resourceType() === "document"
        ) {
          await request.respond({
            status: 200,
            contentType: "text/html",
            body: fs
              .readFileSync(
                path.join(__dirname, "../data/fakePage.html"),
                "utf8"
              )
              .replace(/<site-key>/g, siteKey),
          })
        } else {
          await request.continue()
        }
      })

      await page.goto(url, { waitUntil: "domcontentloaded" })

      await page.waitForSelector('[name="cf-response"]', {
        timeout: global.timeOut,
      })

      const token = await page.evaluate(() => {
        try {
          return document.querySelector('[name="cf-response"]').value
        } catch {
          return null
        }
      })

      isResolved = true
      clearTimeout(cl)
      await context.close().catch(() => {})
      global.browserLength--

      if (!token || token.length < 10)
        return reject("Failed to get token")

      resolve(token)
    } catch (e) {
      if (!isResolved) {
        isResolved = true
        clearTimeout(cl)
        await context.close().catch(() => {})
        global.browserLength--
        reject(e.message)
      }
    }
  })
}

module.exports = { TurnstileMin }