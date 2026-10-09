# Ket Noi Hai Chieu Giua Web App va DealHunter Assistant Extension

Tai lieu nay mo ta kien truc, giao thuc truyen tin va quy chuan bao mat ket noi giua ung dung web DealHunter (Next.js Frontend) va tien ich mo rong Chrome (Manifest V3).

Cap nhat: 2026-10-09

---

## 1. Tong Quan Kien Truc Ket Noi

He thong DealHunter ket noi giua nen tang Web va Tien ich trinh duyet nham hai muc tieu chinh:
1. **Nhan dien tien ich tu Web App**: Trang web nhan biet nguoi dung da cai tien ich de hien thi trang thai ket noi va huong dan su dung.
2. **Dong bo phien dang nhap va Huy hieu gia in-page**: Tien ich nhan JWT token an toan tu Web App de truy van thong tin lich su gia san pham va so sanh deal tren cac trang thuong mai dien tu (Shopee).

```
┌─────────────────────────────────┐           chrome.runtime.sendMessage
│    DealHunter Web App           │ ──────────────────────────────────────────┐
│  (Next.js / localhost / prod)   │                                          │
└─────────────────────────────────┘                                          ▼
                                                                ┌───────────────────────────┐
                                                                │  Background Service Worker│
                                                                │  (externally_connectable) │
                                                                └─────────────┬─────────────┘
                                                                              │
                                                                              ▼
                                                                ┌───────────────────────────┐
                                                                │  chrome.storage.session   │
                                                                │  (Luu JWT token an toan)  │
                                                                └─────────────┬─────────────┘
                                                                              │
                                                                              ▼
┌─────────────────────────────────┐   Doc session & API query   ┌───────────────────────────┐
│     Shopee Product Page         │ ◄───────────────────────────┤   Content Script In-Page  │
│  (Price History Tracker Badge)  │                             │  (PriceHistoryBadge.tsx)  │
└─────────────────────────────────┘                             └───────────────────────────┘
```

---

## 2. Cau Hinh Quyen va Origin Tin Cay

### 2.1. Khai bao `externally_connectable` trong `manifest.json`
Extension chi cho phep nhan tin nhan truc tiep tu cac origin web duoc phe duyet truoc:

```json
"externally_connectable": {
  "matches": [
    "http://localhost:3000/*",
    "https://dealhunter.vn/*",
    "https://www.dealhunter.vn/*"
  ]
}
```

### 2.2. Hang so `DEALHUNTER_WEB_ORIGINS`
Trong ma nguon TypeScript [`extension/src/lib/constants.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/lib/constants.ts):

```typescript
export const DEALHUNTER_WEB_ORIGINS = [
  "http://localhost:3000",
  "https://dealhunter.vn",
  "https://www.dealhunter.vn",
] as const;
```

Moi tin nhan tu ben ngoai deu duoc kiem tra `sender.origin` thuoc danh sach nay truoc khi xu ly.

---

## 3. Bien Moi Truong He Thong

De Web App co the gui tin nhan den Extension, Web App can biet ID cua Extension da cai dat tren trinh duyet nguoi dung:

### 3.1. Moi truong Frontend Web App (`.env.example`, `.env.local`)
```bash
# ID cua DealHunter Assistant Chrome Extension (xem tai chrome://extensions)
NEXT_PUBLIC_EXTENSION_ID=abcdefghijklmnopqrstuvwxyz123456
```

### 3.2. Moi truong Docker Compose Production (`docker-compose.prod.yml`)
```yaml
environment:
  - NEXT_PUBLIC_EXTENSION_ID=${EXTENSION_ID}
```

---

## 4. Giao Thuc Truyen Tin (Message Protocol)

Giao tiep giua Web App va Extension duoc thuc hien qua API `chrome.runtime.sendMessage(extensionId, message)`.

### 4.1. Kiem tra su ton tai cua Extension (`PING`)
Web App gui yeu cau kiem tra xem extension da duoc cai dat hay chua:

- **Payload gui di**:
```json
{
  "type": "PING"
}
```

- **Phan hoi tu Extension**:
```json
{
  "success": true,
  "version": "1.0.0",
  "name": "DealHunter Assistant"
}
```

### 4.2. Dong bo xac thuc nguoi dung (`SYNC_AUTH`)
Khi nguoi dung dang nhap tren DealHunter Web App, Web App gui thong tin xac thuc den Extension de kich hoat tinh nang theo doi gia:

- **Payload gui di**:
```json
{
  "type": "SYNC_AUTH",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "usr_12345",
    "email": "user@example.com"
  }
}
```

- **Xu ly phia Extension**:
  - Background Service Worker kiem tra tinh hop le cua origin gui den.
  - Luu JWT token va thong tin nguoi dung vao `chrome.storage.session`.
  - Luu y: Khong su dung `chrome.storage.local` de luu token nham dam bao content script cua cac website khac khong the doc duoc token qua API storage thong thuong. Token se tu dong bi huy khi trinh duyet dong.

- **Phan hoi tu Extension**:
```json
{
  "success": true,
  "message": "Auth session synchronized"
}
```

### 4.3. Dang xuat hoac xoa phien (`CLEAR_AUTH`)
Khi nguoi dung dang xuat tren Web App:

- **Payload gui di**:
```json
{
  "type": "CLEAR_AUTH"
}
```

- **Phan hoi tu Extension**:
```json
{
  "success": true
}
```

---

## 5. Hoat Dong Cua Content Script va Price History Badge

1. **Nhan dien trang san pham**:
   - Content script chi tu dong khoi chay `PriceHistoryBadge` tren cac trang san pham Shopee hop le (`shopee.vn/product/...` hoac `shopee.vn/*-i.*.*`).
2. **Truy van du lieu gia**:
   - Component `PriceHistoryBadge` doc token tu session va gui yeu cau den Backend REST API qua [`api_client.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/lib/api_client.ts):
     - `GET /api/v1/tracked-products?source_url=...`
     - `GET /api/v1/products/{id}/comparison`
3. **Hien thi tren giao dien**:
   - Badge duoc neo doc lap tai `top: 90px; right: 24px` (z-index 2147483646) de khong de len giao dien Floating HUD o goc duoi `bottom: 24px`.
   - Hien thi gia thap nhat ghi nhan, muc chenh lech voi deal tot nhat tren cac san khac, va nut bam mo xem chi tiet tren DealHunter Web App.

---

## 6. Nguyen Tac An Toan va Bao Mat

1. **Khong tin tuong `window.postMessage`**: Toan bo luong lien lac di qua kenh `chrome.runtime.sendMessage` cua trinh duyet voi danh sach origin co dinh trong manifest. Khong su dung `window.postMessage` de tranh bi script doc hai tren trang can thiep.
2. **Loai bo quyen thua (P3)**: Extension khong yeu cau quyen `"tabs"` khong can thiet, gioi han `web_accessible_resources` chi mo cho cac web origin cua DealHunter de chong ky thuat nhan dang tien ich trai phep (extension fingerprinting).
3. **Kiem tra ID tin nhan (P4)**: Service Worker background luon kiem tra `sender.id` va bat loi `catch` cho moi async listener, dam bao he thong khong bao gio bi crash boi cac tin nhan khong hop le.
