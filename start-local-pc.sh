#!/bin/bash
echo "========================================================="
echo "   Knaben Stremio Addon - Engine Khởi Chạy Local PC"
echo "========================================================="
echo ""

if ! command -v node &> /dev/null; then
    echo "[LỖI] Máy tính chưa cài đặt Node.js!"
    echo "Vui lòng tải và cài đặt Node.js tại: https://nodejs.org"
    exit 1
fi

echo "[1/2] Đang kiểm tra và cài đặt thư viện (npm install)..."
npm install --legacy-peer-deps
echo ""

echo "[2/2] Đang khởi chạy Knaben Stremio Addon Server..."
echo "========================================================="
echo "  Server đang chạy tại: http://127.0.0.1:3000"
echo ""
echo "  Mở Stremio -> Add-ons -> Dán link này để cài đặt:"
echo "  http://127.0.0.1:3000/manifest.json"
echo "========================================================="
echo ""

npm start
