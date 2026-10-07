# E2E trên Chrome thật (extension đã build)

Nạp `dist/` vào Chrome thật (Chrome 137+ bỏ cờ `--load-extension`, nên dùng `enableExtensions` của Puppeteer ≥ 25),
chặn một URL `https://shopee.vn/m/...` và trả về trang voucher mô phỏng để content script thật chạy trên đó.

```bash
cd extension && npm run build
cd e2e && npm init -y >/dev/null && npm install puppeteer-core@25
node ext_semi.mjs     # Bán tự động: khóa nút đang disabled, React render lại nút lúc mở mã, mồi nhử không bị click, báo "ĐÃ LƯU" chỉ khi trang xác nhận (~60s)
node ext_full.mjs     # Tự động 100%: service worker -> content script, lọc từ khóa "500k", trạng thái lưu thật vào storage; alarm mở tab Shopee (~90s)
node calib_chrome.mjs # Đo lệch đồng hồ Shopee bằng phương pháp bắt mốc đổi giây (so với `sntp time.apple.com`)
```
