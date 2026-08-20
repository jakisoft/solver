FROM node:latest

RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    apt-transport-https \
    chromium \
    chromium-driver \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

WORKDIR /app

COPY package*.json ./

RUN npm install
RUN npx playwright install chromium
RUN npx playwright install-deps
RUN npm i -g pm2

COPY . .

EXPOSE 9898

CMD ["pm2-runtime", "app.js"]
