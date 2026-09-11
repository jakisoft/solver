const { solveVisualChallenge } = require("./visionSolver");

/**
 * Backwards compatibility wrapper for solveWithGemini
 */
async function solveWithGemini({ base64Image, promptText, tileCount = 9, apiKey }) {
  return await solveVisualChallenge({
    base64Image,
    promptText,
    tileCount,
    apiKey,
    provider: "gemini"
  });
}

module.exports = { solveWithGemini };
