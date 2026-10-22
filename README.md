# Cloudflare Solver (Turnstile & WAF Challenge)

Server solver mandiri (*self-hosted*) berkinerja tinggi dan hemat sumber daya untuk menyelesaikan Cloudflare Turnstile dan Cloudflare WAF / Managed Challenge (mendapatkan token Turnstile dan cookie `cf_clearance`).

---

## 1. Persyaratan Sistem & Instalasi

### Kebutuhan Sistem:
- **Sistem Operasi**: Linux (Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12) atau OS lain yang didukung.
- **Node.js**: v18.x atau v20.x ke atas.
- **Browser**: Google Chrome atau Chromium.
- **Xvfb**: X Virtual Framebuffer untuk emulasi display di server headless/VPS.

### Langkah Instalasi di Linux / VPS:

#### A. Install Dependensi Sistem (Chromium & Xvfb)
```bash
sudo apt-get update -y
sudo apt-get install -y \
  wget \
  gnupg \
  ca-certificates \
  apt-transport-https \
  xvfb \
  procps
```

Jika ingin menggunakan **Google Chrome Stable** (sangat disarankan):
```bash
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O /tmp/chrome.deb
sudo apt-get install -y /tmp/chrome.deb
rm -f /tmp/chrome.deb
```
Atau menggunakan **Chromium**:
```bash
sudo apt-get install -y chromium chromium-driver
```

#### B. Install Dependensi Node.js
Masuk ke direktori project `/root/solver` dan install paket:
```bash
cd /root/solver
npm install
```

---

## 2. Cara Menjalankan Server

### Mode Development:
```bash
npm run dev
```

### Mode Standar (Production):
```bash
npm start
```

### Menggunakan PM2 (Rekomendasi di VPS agar berjalan di background):
```bash
npm install -g pm2
pm2 start app.js --name cf-solver
pm2 save
pm2 startup
```

### Menjalankan dengan Docker:
```bash
docker build -t cf-solver .
docker run -d --name cf-solver -p 9898:9898 --restart unless-stopped cf-solver
```

Server default berjalan pada port `9898` (dapat diubah melalui environment variable `PORT=9898`).

---

## 3. Efisiensi Sumber Daya (RAM, CPU, & Disk)

Solver ini dioptimalkan agar **tidak membebani server** VPS:
- **Idle Auto-Close**: Browser hanya berjalan ketika ada request masuk. Jika tidak ada aktivitas selama 60 detik, instance browser otomatis ditutup untuk mengembalikan RAM server ke titik minimum (~25 MB).
- **Penanganan `finally` yang Ketat**: Seluruh resource (page tab, browser context, timeout timer, counter antrean) selalu dibersihkan di blok `finally`, bahkan ketika terjadi timeout, error koneksi, atau error navigasi.
- **Limit Disk & Media Cache**: Caching disk dibatasi ketat (`--disk-cache-size=10485760` / 10 MB) untuk mencegah disk VPS membengkak.
- **Hemat CPU & Bandwidth pada WAF**: Request berupa gambar (`image`), audio/video (`media`), dan font diblokir otomatis pada session WAF sehingga tidak membebani CPU dengan rendering berat yang tidak diperlukan.
- **Zombie Process Cleanup**: Pembersihan berkala terhadap proses Xvfb atau browser yang menggantung.

---

## 4. Dokumentasi API

### A. Cloudflare Turnstile Solver

Digunakan untuk mendapatkan token respon Turnstile dari widget Cloudflare Turnstile.

**Endpoints:**
- `GET /cfsolver/turnstilemin` atau `POST /cfsolver/turnstilemin`
- `GET /cfsolver/turnstile` atau `POST /cfsolver/turnstile`

#### Parameters:
| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `url` (atau `link`) | string | Ya | URL target halaman web |
| `sitekey` (atau `siteKey`, `key`) | string | Ya | Sitekey Cloudflare Turnstile target |
| `proxy` | string | Tidak | Format: `http://user:pass@host:port` atau `http://host:port` |

#### Contoh Request GET:
```bash
curl "http://localhost:9898/cfsolver/turnstilemin?url=https://example.com&sitekey=0x4AAAAAA..."
```

#### Contoh Request POST (JSON):
```bash
curl -X POST "http://localhost:9898/cfsolver/turnstile" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "sitekey": "0x4AAAAAA...",
    "proxy": "http://user:password@1.2.3.4:8080"
  }'
```

#### Contoh Respon Sukses:
```json
{
  "status": true,
  "token": "0.4c_Yq0eF...",
  "result": {
    "token": "0.4c_Yq0eF...",
    "siteKey": "0x4AAAAAA...",
    "url": "https://example.com"
  }
}
```

---

### B. Cloudflare WAF / Managed Challenge Solver

Digunakan untuk melewati halaman tunggu Cloudflare ("Just a moment...", "Attention Required", Managed Challenge, 5-second shield) dan mengekstrak cookie sesi valid (`cf_clearance`), User-Agent, dan semua cookie lainnya.

**Endpoints:**
- `GET /cfsolver/waf` atau `POST /cfsolver/waf`
- `GET /waf` atau `POST /waf`

#### Parameters:
| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `url` (atau `link`) | string | Ya | URL target yang terproteksi Cloudflare WAF |
| `proxy` | string | Tidak | Format: `http://user:pass@host:port` |
| `timeout` | number | Tidak | Batas waktu maksimal penyelesaian dalam milidetik (default: 60000) |

#### Contoh Request GET:
```bash
curl "http://localhost:9898/cfsolver/waf?url=https://nowsecure.nl"
```

#### Contoh Request POST (JSON):
```bash
curl -X POST "http://localhost:9898/cfsolver/waf" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://nowsecure.nl",
    "timeout": 45000,
    "proxy": "http://1.2.3.4:8080"
  }'
```

#### Contoh Respon Sukses:
```json
{
  "status": true,
  "result": {
    "url": "https://nowsecure.nl",
    "title": "nowSecure.nl",
    "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36...",
    "cookies": [
      {
        "name": "cf_clearance",
        "value": "w91x_9c18j...",
        "domain": ".nowsecure.nl",
        "path": "/",
        "httpOnly": true,
        "secure": true
      }
    ],
    "cfClearance": "w91x_9c18j...",
    "solved": true
  }
}
```

---

## 5. Status HTTP Response

- `200 OK`: Challenge berhasil diselesaikan.
- `400 Bad Request`: Parameter `url` atau `sitekey` tidak disertakan.
- `429 Too Many Requests`: Batas konkurensi browser tercapai (`browserLimit: 5`), server sedang memproses antrean maksimal.
- `504 Gateway Timeout`: Waktu tunggu challenge melebihi batas waktu (timeout).
- `500 Internal Server Error`: Kesalahan internal server.
