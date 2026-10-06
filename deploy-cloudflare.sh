#!/bin/bash
echo "========================================================="
echo "   Knaben Stremio Addon - Triển Khai Cloudflare Worker"
echo "========================================================="
echo ""

if ! command -v npx &> /dev/null; then
    echo "[LỖI] Chưa cài đặt Node.js / npx!"
    echo "Vui lòng cài đặt Node.js từ https://nodejs.org"
    exit 1
fi

echo "Đang triển khai lên Cloudflare Workers bằng Wrangler..."
npx wrangler deploy

echo ""
echo "========================================================="
echo "  Triển khai hoàn tất!"
echo "  Hãy lấy link Worker và dán /manifest.json vào Stremio."
echo "========================================================="
