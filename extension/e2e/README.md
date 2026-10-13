# E2E tren Chrome that (Extension da build)

Nap `dist/` vao Chrome that (Chrome 137+ bo co `--load-extension`, nen dung `enableExtensions` cua Puppeteer >= 25),
chan URL `https://shopee.vn/m/...` va tra ve trang voucher mo phong de content script va background service worker that chay tren do.

```bash
cd extension && npm run build   # ban phat hanh la du: trang mo phong nam tren shopee.vn
cd e2e && npm init -y >/dev/null && npm install puppeteer-core@25
node ext_semi.mjs     # Tren bang san: «Chon nut» -> bam nut voucher, «Gio khac» = phut ke tiep, «Bat dau san»; kiem tra khong bam nut moi nhu (decoy), bam dung nut duoc React ve lai, bao da luu (~60s)
node ext_full.mjs     # Tu dong 100%: Service worker Background dispatch TRIGGER_FULL_AUTO, bam nut dua tren target descriptor va tu khoa, cap nhat trang thai that vao storage (~90s)
node calib_chrome.mjs # Do lech dong ho may chu Shopee bang phuong phap bat moc doi giay bang HEAD request (cach background canh gio)
```
