# ===== Build stage =====
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ===== Production stage =====
FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Sharp's prebuilt libvips cannot decode HEVC-based HEIC photos.
RUN apk add --no-cache libheif-tools tesseract-ocr tesseract-ocr-data-kor tesseract-ocr-data-eng

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3000

USER node

CMD ["node", "dist/main"]
