---
title: Cfsolver
emoji: 📉
colorFrom: red
colorTo: blue
sdk: docker
pinned: false
license: mit
---

# Multi-Captcha Solver (Cloudflare Turnstile & hCaptcha)

Server solver mandiri (*self-hosted*) untuk memecahkan Cloudflare Turnstile dan hCaptcha (termasuk enterprise `rqdata` untuk ElevenLabs/Discord) dengan dukungan AI Vision multi-provider (100% GRATIS tanpa billing/kartu kredit).

---

## 1. Cloudflare Turnstile (ElevenLabs, dll.)

ElevenLabs dan Cloudflare-protected sites umumnya memproteksi form pendaftaran/login menggunakan Cloudflare Turnstile.

**Endpoint:** `GET /cfsolver/turnstilemin`

### Query Parameters:
* `url` *(required)*: URL target (misal: `https://elevenlabs.io`)
* `sitekey` *(required)*: Sitekey Turnstile Cloudflare

```bash
curl "http://localhost:9898/cfsolver/turnstilemin?url=https://elevenlabs.io&sitekey=0x4AAAAAA..."
```

---

## 2. hCaptcha Solver (dengan Enterprise `rqdata` & AI Vision Gratis)

**Endpoint:** `GET /hcaptchasolver/solve` atau `POST /hcaptchasolver/solve`  
*(Alias: `/hcaptcha/solve`)*

### Parameters:
* `url` *(required)*: URL halaman target (misal `https://elevenlabs.io`)
* `sitekey` *(required)*: Sitekey hCaptcha
* `rqdata` *(optional)*: Enterprise payload data (digunakan oleh ElevenLabs, Discord, dll.)
* `proxy` *(optional)*: Proxy format `http://user:pass@host:port`
* `aiKey` *(optional)*: API key untuk AI solver jika puzzle gambar visual muncul
* `aiProvider` *(optional)*: Provider AI: `groq` | `openrouter` | `huggingface` | `ollama` | `gemini`
* `aiModel` *(optional)*: Nama model spesifik (opsional)
* `aiBaseUrl` *(optional)*: Custom base URL (misal: `http://localhost:11434/v1` untuk Ollama lokal)

---

## 3. Pilihan AI Vision 100% GRATIS (Tanpa Billing / Tanpa Kartu Kredit)

Jika hCaptcha memunculkan puzzle gambar (grid 3x3), solver dapat menyelesaikannya otomatis menggunakan AI Vision gratis berikut:

| Provider | Biaya / Billing | Model Rekomendasi | Cara Dapat Key |
|---|---|---|---|
| **Groq (Sangat Cepat)** | 100% GRATIS (Tanpa kartu kredit) | `llama-3.2-11b-vision-preview` | [console.groq.com](https://console.groq.com) |
| **OpenRouter** | 100% GRATIS (Model `:free`) | `inclusionai/ling-3.0-flash-vl:free` | [openrouter.ai](https://openrouter.ai) |
| **Hugging Face** | 100% GRATIS | `Qwen/Qwen2.5-VL-7B-Instruct` | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) |
| **Ollama (Lokal / VPS)** | 100% GRATIS & Offline | `llama3.2-vision` | Self-hosted (`ollama run llama3.2-vision`) |
| **Google Gemini** | Free tier (memerlukan setup) | `gemini-2.5-flash` | [aistudio.google.com](https://aistudio.google.com) |

### Pengaturan Environment Variables (Paling Praktis):
Cukup set salah satu variabel di bawah ini di server (atau file `.env`):
```bash
# Opsi 1: Groq (Recommended - gratis, tanpa billing, sangat cepat)
export GROQ_API_KEY="gsk_..."

# Opsi 2: OpenRouter (Model free)
export OPENROUTER_API_KEY="sk-or-..."

# Opsi 3: Hugging Face (Gratis)
export HUGGINGFACE_TOKEN="hf_..."

# Opsi 4: Ollama lokal (Offline 100%)
export OLLAMA_BASE_URL="http://localhost:11434/v1"

# Opsi 5: Gemini (Jika punya)
export GEMINI_API_KEY="AIzaSy..."
```

---

## 4. Contoh Penggunaan

### A. Contoh Request hCaptcha Standar:
```bash
curl "http://localhost:9898/hcaptchasolver/solve?url=https://accounts.hcaptcha.com/demo&sitekey=10000000-ffff-ffff-ffff-000000000001"
```

### B. Contoh Request ElevenLabs (dengan `rqdata` & Free Groq Key):
```bash
curl -X POST "http://localhost:9898/hcaptchasolver/solve" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://elevenlabs.io",
    "sitekey": "your_hcaptcha_sitekey",
    "rqdata": "your_rqdata_here",
    "aiProvider": "groq",
    "aiKey": "gsk_..."
  }'
```

### Response Sukses:
```json
{
  "status": true,
  "token": "P1_eyJ...",
  "solution": {
    "gRecaptchaResponse": "P1_eyJ...",
    "respKey": "P1_eyJ..."
  }
}
```

---

## 5. Kompatibilitas Format 2Captcha (`in.php` & `res.php`)

Dapat langsung digunakan pada bot atau tools yang menggunakan SDK / format 2Captcha:

1. **Submit Task:**
   ```bash
   curl "http://localhost:9898/in.php?method=hcaptcha&pageurl=https://example.com&sitekey=..."
   # Return: OK|task_id
   ```
2. **Ambil Token:**
   ```bash
   curl "http://localhost:9898/res.php?action=get&id=task_id"
   # Return: OK|P1_eyJ... atau CAPCHA_NOT_READY
   ```
