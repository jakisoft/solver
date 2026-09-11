const axios = require("axios");

/**
 * Robustly parses tile match numbers from LLM response text
 * @param {string} text 
 * @returns {number[]}
 */
function parseMatchesFromText(text) {
  if (!text || typeof text !== "string") return [];

  // Try parsing exact schema: {"matches": [1, 4]}
  try {
    const jsonMatch = text.match(/\{[\s\S]*?"matches"\s*:\s*\[([\s\S]*?)\][\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.matches)) {
        return parsed.matches.map(Number).filter(n => !isNaN(n) && n > 0);
      }
    }
  } catch {}

  // Fallback: match any JSON object with an array
  try {
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const candidate = codeBlockMatch ? codeBlockMatch[1] : text;
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed.matches)) {
      return parsed.matches.map(Number).filter(n => !isNaN(n) && n > 0);
    }
    if (Array.isArray(parsed)) {
      return parsed.map(Number).filter(n => !isNaN(n) && n > 0);
    }
  } catch {}

  // Fallback: extract any isolated numbers list [1, 2, 3]
  try {
    const arrayMatch = text.match(/\[([0-9,\s]*)\]/);
    if (arrayMatch) {
      return arrayMatch[1]
        .split(",")
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n > 0);
    }
  } catch {}

  return [];
}

/**
 * Builds standard system & user prompt for CAPTCHA tile identification
 */
function buildPrompt(promptText, tileCount = 9) {
  return `You are an automated vision assistant for CAPTCHA accessibility verification.
Challenge prompt: "${promptText}".
The provided image contains a grid of ${tileCount} tiles, indexed from 1 to ${tileCount} (row 1: 1, 2, 3; row 2: 4, 5, 6; row 3: 7, 8, 9).
Carefully determine which numbered tiles match the description in the prompt.
Respond ONLY with a valid JSON object matching this schema:
{"matches": [1, 4]}
If no tiles match, respond with:
{"matches": []}`;
}

/**
 * Detect provider from key format, provider parameter, or environment variables
 */
function detectProvider({ apiKey, provider, baseUrl }) {
  if (provider) return provider.toLowerCase();
  if (baseUrl) return "custom";

  if (apiKey) {
    if (apiKey.startsWith("gsk_")) return "groq";
    if (apiKey.startsWith("sk-or-")) return "openrouter";
    if (apiKey.startsWith("hf_")) return "huggingface";
    if (apiKey.startsWith("AIza")) return "gemini";
  }

  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN) return "huggingface";
  if (process.env.OLLAMA_BASE_URL) return "ollama";
  if (process.env.GEMINI_API_KEY) return "gemini";

  return "groq";
}

/**
 * Solves using OpenAI-compatible Vision API (Groq, OpenRouter, HuggingFace, Ollama, OpenAI, vLLM)
 */
async function solveWithOpenAICompatible({
  base64Image,
  promptText,
  tileCount,
  apiKey,
  endpoint,
  models,
  headers = {}
}) {
  const prompt = buildPrompt(promptText, tileCount);

  for (const model of models) {
    try {
      const response = await axios.post(
        endpoint,
        {
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: prompt
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          temperature: 0.1
        },
        {
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...headers
          },
          timeout: 20000
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (content) {
        const matches = parseMatchesFromText(content);
        return matches;
      }
    } catch (err) {
      const errDetail = err.response?.data?.error?.message || err.response?.data?.message || err.message;
      console.warn(`[VisionSolver] OpenAI compatible (${model}) failed:`, errDetail);
    }
  }

  return [];
}

/**
 * Solves using Google Gemini Native API
 */
async function solveWithGeminiNative({ base64Image, promptText, tileCount, apiKey, models }) {
  const prompt = buildPrompt(promptText, tileCount);

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: base64Image
                  }
                }
              ]
            }
          ],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1
          }
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 20000
        }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const matches = parseMatchesFromText(text);
        return matches;
      }
    } catch (err) {
      const errDetail = err.response?.data?.error?.message || err.message;
      console.warn(`[VisionSolver] Gemini (${model}) failed:`, errDetail);
    }
  }

  return [];
}

/**
 * Master multi-provider vision challenge solver
 * @param {Object} params
 * @param {string} params.base64Image - Base64 encoded JPEG image of the challenge
 * @param {string} params.promptText - Challenge instructions
 * @param {number} [params.tileCount=9] - Number of tiles (usually 9)
 * @param {string} [params.apiKey] - Provider API key
 * @param {string} [params.provider] - 'groq' | 'openrouter' | 'huggingface' | 'ollama' | 'gemini' | 'custom'
 * @param {string} [params.model] - Optional model override
 * @param {string} [params.baseUrl] - Optional base URL override
 * @returns {Promise<number[]>} Array of 1-based tile indices to click, e.g. [1, 4, 7]
 */
async function solveVisualChallenge({
  base64Image,
  promptText,
  tileCount = 9,
  apiKey,
  provider,
  model,
  baseUrl
}) {
  const resolvedProvider = detectProvider({ apiKey, provider, baseUrl });

  const effectiveKey =
    apiKey ||
    process.env.AI_API_KEY ||
    (resolvedProvider === "groq" ? process.env.GROQ_API_KEY : null) ||
    (resolvedProvider === "openrouter" ? process.env.OPENROUTER_API_KEY : null) ||
    (resolvedProvider === "huggingface" ? (process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN) : null) ||
    (resolvedProvider === "gemini" ? process.env.GEMINI_API_KEY : null);

  switch (resolvedProvider) {
    case "groq": {
      // 100% Free - no credit card required at console.groq.com
      if (!effectiveKey) {
        throw new Error("GROQ_API_KEY is required for Groq Vision (Free at https://console.groq.com)");
      }
      const models = model ? [model] : ["llama-3.2-11b-vision-preview", "llama-3.2-90b-vision-preview"];
      return await solveWithOpenAICompatible({
        base64Image,
        promptText,
        tileCount,
        apiKey: effectiveKey,
        endpoint: `${baseUrl || "https://api.groq.com/openai/v1"}/chat/completions`,
        models
      });
    }

    case "openrouter": {
      // 100% Free with :free models - no credit card required at openrouter.ai
      if (!effectiveKey) {
        throw new Error("OPENROUTER_API_KEY is required for OpenRouter (Free at https://openrouter.ai)");
      }
      const models = model
        ? [model]
        : ["inclusionai/ling-3.0-flash-vl:free", "nex-agi/nex-n2.5-mini:free"];
      return await solveWithOpenAICompatible({
        base64Image,
        promptText,
        tileCount,
        apiKey: effectiveKey,
        endpoint: `${baseUrl || "https://openrouter.ai/api/v1"}/chat/completions`,
        models,
        headers: {
          "HTTP-Referer": "https://github.com/jakisoft/solver",
          "X-Title": "Multi-Captcha Solver"
        }
      });
    }

    case "huggingface":
    case "hf": {
      // 100% Free Hugging Face user access token
      if (!effectiveKey) {
        throw new Error("HUGGINGFACE_TOKEN is required for Hugging Face Inference API");
      }
      const models = model ? [model] : ["Qwen/Qwen2.5-VL-7B-Instruct"];
      return await solveWithOpenAICompatible({
        base64Image,
        promptText,
        tileCount,
        apiKey: effectiveKey,
        endpoint: `${baseUrl || "https://router.huggingface.co/hf-inference/v1"}/chat/completions`,
        models
      });
    }

    case "ollama": {
      // 100% Free & local - no API key needed
      const endpoint = `${baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1"}/chat/completions`;
      const models = model ? [model] : ["llama3.2-vision", "qwen2.5-vl", "minicpm-v"];
      return await solveWithOpenAICompatible({
        base64Image,
        promptText,
        tileCount,
        apiKey: effectiveKey || "ollama",
        endpoint,
        models
      });
    }

    case "gemini": {
      if (!effectiveKey) {
        throw new Error("GEMINI_API_KEY is required for Google Gemini Vision");
      }
      const models = model ? [model] : ["gemini-2.5-flash", "gemini-1.5-flash"];
      return await solveWithGeminiNative({
        base64Image,
        promptText,
        tileCount,
        apiKey: effectiveKey,
        models
      });
    }

    case "custom":
    case "openai":
    default: {
      const endpoint = `${baseUrl || process.env.AI_BASE_URL || "https://api.openai.com/v1"}/chat/completions`;
      const models = model ? [model] : ["gpt-4o-mini", "llama-3.2-11b-vision-preview"];
      return await solveWithOpenAICompatible({
        base64Image,
        promptText,
        tileCount,
        apiKey: effectiveKey,
        endpoint,
        models
      });
    }
  }
}

module.exports = {
  solveVisualChallenge,
  parseMatchesFromText,
  detectProvider
};
