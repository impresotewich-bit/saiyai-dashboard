#!/bin/sh
# สร้าง index.html (เอกสาร HTML เต็ม + viewport + PWA) จาก saiyai-dashboard.html (ตัวเดียวกับ artifact)
cd "$(dirname "$0")" || exit 1
{
  cat <<'HEAD'
<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Saiyai</title>
<meta name="theme-color" content="#0E7C7B">
<meta name="description" content="ระบบรายงานงานติดตั้งและซ่อมแซมสายเคเบิล">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Saiyai">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" href="icon-192.png">
</head>
<body>
HEAD
  cat saiyai-dashboard.html
  cat <<'FOOT'
<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});}</script>
</body>
</html>
FOOT
} > index.html
echo "built index.html"
