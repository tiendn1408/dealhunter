# DealHunter — Danh Muc & Dac Ta REST API Toan Dien (REST API Reference)

Tai lieu nay dac ta chi tiet toan bo cac endpoint HTTP REST API cua he thong **DealHunter Backend**, bao gom phuong thuc, header xac thuc, dinh dang du lieu (Request/Response payload), ma trang thai HTTP va vi du `curl` mau.

---

## 1. Tong Quan Giao Thuc & Header Chung

### Base URL:
- **Local Development**: `http://localhost:8080/api/v1`
- **Production**: `https://dealhunter.vn/api/v1`

### Authentication & Authorization Headers:
He thong ho tro 2 phuong thuc xac thuc phien lam viec:

1. **Bearer JWT Token (`Authorization: Bearer <token>`)**:
   - Ap dung cho nguoi dung da dang nhap (Google OAuth hoac Demo Login).
   - Token co thoi han 7 ngay, duoc ky boi `JWT_SECRET`.
   - Bat buoc khi thuc hien cac thao tac quan tri tai khoan hoac truy van du lieu ca nhan cua thanh vien da dang ky.

2. **Guest User Header (`X-User-ID: <uuid>`)**:
   - Ap dung cho khach vang lai chua dang nhap.
   - Neu nguoi dung da dang ky tai khoan that ma su dung header `X-User-ID` khong kem JWT, he thong se tra ve loi `401 Unauthorized` (`ErrImpersonationDisallowed`) de ngan chan gia mao danh tinh.
   - Gia tri mac dinh fallback khi khong truyen: `00000000-0000-0000-0000-000000000001`.

### Dinh dang tra ve chung:
- Content-Type: `application/json; charset=utf-8`
- Ma loi chuan:
  - `400 Bad Request`: Payload JSON khong hop le hoac URL khong hop le.
  - `401 Unauthorized`: Token het han hoac khong co quyen truy cap.
  - `404 Not Found`: Khong tim thay tai nguyen.
  - `409 Conflict`: Trung lap ban ghi (vi du: san pham nguon da ton tai).
  - `422 Unprocessable Entity`: Du lieu khong thoa man dieu kien nghiep vu.
  - `500 Internal Server Error`: Loi he thong hoac co so du lieu.

---

## 2. Nhom Endpoint Kiem Tra He Thong (Health & Metrics)

### 2.1. Health Check
- **Endpoint**: `GET /health` hoac `GET /api/v1/health`
- **Xac thuc**: Khong yeu cau
- **Response `200 OK`**:
  ```json
  {
    "status": "ok",
    "app": "DealHunter"
  }
  ```

### 2.2. Prometheus Metrics
- **Endpoint**: `GET /metrics`
- **Xac thuc**: Chi cho phep truy cap tu mang noi bo (VPC / Localhost)
- **Response `200 OK`**: Dinh dang text/plain Prometheus exporter.

---

## 3. Nhom Endpoint Xac Thuc & Nguoi Dung (Authentication — GAP-02)

### 3.1. Dang Nhap Demo 1-Click
- **Endpoint**: `POST /api/v1/auth/demo-login`
- **Header**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "role": "user"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "c1f7a0b3-4d2e-48f1-9b7a-8f6a3b2c1d0e",
      "email": "demo-user@dealhunter.vn",
      "name": "Demo User",
      "auth_provider": "demo"
    }
  }
  ```

### 3.2. Dang Nhap Google OAuth
- **Endpoint**: `POST /api/v1/auth/google`
- **Header**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "id_token": "google-id-token-string-from-client-sdk"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "e4b2d1c0-5a3f-42e1-8c9a-1b2c3d4e5f6a",
      "email": "user@gmail.com",
      "name": "Nguyen Van A",
      "avatar_url": "https://lh3.googleusercontent.com/...",
      "auth_provider": "google"
    }
  }
  ```

### 3.3. Di Tru Du Lieu Khach Vang Lai (Guest Migration)
- **Endpoint**: `POST /api/v1/auth/migrate`
- **Header**: `Authorization: Bearer <jwt_token>`, `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "guest_id": "00000000-0000-0000-0000-000000000001"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "status": "success",
    "migrated_trackings_count": 5,
    "migrated_alerts_count": 3
  }
  ```

### 3.4. Lay Thong Tin Nguoi Dung Hien Tai
- **Endpoint**: `GET /api/v1/auth/me` hoac `GET /api/v1/users/me`
- **Header**: `Authorization: Bearer <jwt_token>` (hoac `X-User-ID: <uuid>`)
- **Response `200 OK`**:
  ```json
  {
    "id": "e4b2d1c0-5a3f-42e1-8c9a-1b2c3d4e5f6a",
    "email": "user@gmail.com",
    "name": "Nguyen Van A",
    "zalo_user_id": "zalo-id-123456",
    "zalo_connected": true
  }
  ```

---

## 4. Nhom Endpoint Theo Doi San Pham (Core Tracking)

### 4.1. Dang Ky Theo Doi URL San Pham Moi
- **Endpoint**: `POST /api/v1/tracked-products`
- **Header**: `Content-Type: application/json`, `X-User-ID: <uuid>` (hoac Bearer)
- **Request Body**:
  ```json
  {
    "url": "https://shopee.vn/product/12345678/87654321"
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "id": "b3e2d1c0-4a3f-41e1-9c9a-2b3c4d5e6f7a",
    "product_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "product_source_id": "f5e4d3c2-b1a0-49e8-8d7c-6b5a4f3e2d1c",
    "title": "Tai nghe Sony WH-1000XM5 Chinh Hang",
    "platform": "shopee",
    "canonical_url": "https://shopee.vn/product/12345678/87654321",
    "affiliate_url": "https://s.shopee.vn/universal-link?url=...&sub_id=u_..._p_...",
    "status": "active",
    "poll_interval_seconds": 1800,
    "created_at": "2026-10-01T10:00:00Z"
  }
  ```

### 4.2. Danh Sach San Pham Dang Theo Doi
- **Endpoint**: `GET /api/v1/tracked-products`
- **Header**: `X-User-ID: <uuid>` (hoac Bearer)
- **Response `200 OK`**: Danh sach cac ban ghi theo doi kem thong tin gia moi nhat, Best Deal, va huy hieu da san.

### 4.3. Chi Tiet San Pham Theo Doi
- **Endpoint**: `GET /api/v1/tracked-products/{id}`
- **Header**: `X-User-ID: <uuid>` (hoac Bearer)
- **Response `200 OK`**: Thong tin chi tiet san pham, cac nguon lien ket va thong so thoi gian quet.

### 4.4. Lich Su Bien Dong Gia (Price History)
- **Endpoint**: `GET /api/v1/tracked-products/{id}/prices`
- **Response `200 OK`**:
  ```json
  [
    {
      "id": "snapshot-uuid-1",
      "listed_price": 6290000,
      "effective_price": 5450000,
      "shipping_fee": 0,
      "shop_discount": 300000,
      "platform_coupon": 540000,
      "captured_at": "2026-10-01T10:00:00Z"
    }
  ]
  ```

### 4.5. Tam Dung / Bat Lai Theo Doi
- **Endpoint**: `POST /api/v1/tracked-products/{id}/pause`
- **Endpoint**: `POST /api/v1/tracked-products/{id}/resume`
- **Response `200 OK`**: `{"status": "paused"}` hoac `{"status": "active"}`.

---

## 5. Nhom Endpoint Canh Bao & Thong Bao (Alerts & Notifications)

### 5.1. Tao Quy Tac Canh Bao Gia
- **Endpoint**: `POST /api/v1/tracked-products/{id}/alerts`
- **Request Body**:
  ```json
  {
    "rule_type": "drop_percent",
    "threshold_value": 15,
    "expires_in_days": 30
  }
  ```
- **Cac loai `rule_type` ho tro**:
  - `drop_percent`: Giam it nhat X phan tram so voi gia luc tao.
  - `target_price`: Gia thap hon hoac bang gia muc tieu VND cu the.
  - `lowest_n_days`: Gia thap nhat trong vong N ngay qua.

### 5.2. Danh Sach Quy Tac Canh Bao Cua San Pham
- **Endpoint**: `GET /api/v1/tracked-products/{id}/alerts`
- **Response `200 OK`**: Danh sach cac rule dang kich hoat.

### 5.3. Huy Bo Quy Tac Canh Bao
- **Endpoint**: `DELETE /api/v1/alerts/{alert_id}`
- **Response `204 No Content`**

### 5.4. Feed Thong Bao Bien Dong Gia
- **Endpoint**: `GET /api/v1/notifications?limit=20`
- **Header**: `X-User-ID: <uuid>` (hoac Bearer)
- **Response `200 OK`**: Danh sach tin thong bao, kenh gui (zalo/in_app), trang thai doc.

### 5.5. Danh Dau Thong Bao Da Doc
- **Endpoint**: `POST /api/v1/notifications/{id}/read`
- **Response `200 OK`**: `{"status": "read"}`

---

## 6. Nhom Endpoint So Sanh Gia Da San (Cross-Platform Comparison)

### 6.1. Lay Bang So Sanh Gia & Best Deal
- **Endpoint**: `GET /api/v1/tracked-products/{id}/comparison`
- **Endpoint**: `GET /api/v1/products/{product_id}/comparison`
- **Response `200 OK`**:
  ```json
  {
    "product_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "best_deal": {
      "product_source_id": "f5e4d3c2-b1a0-49e8-8d7c-6b5a4f3e2d1c",
      "platform": "tiktok",
      "effective_price": 94000,
      "savings_amount": 26000,
      "savings_percent": 21.6
    },
    "sources": [
      {
        "id": "f5e4d3c2-b1a0-49e8-8d7c-6b5a4f3e2d1c",
        "platform": "tiktok",
        "listed_price": 99000,
        "effective_price": 94000,
        "affiliate_url": "https://vt.tiktok.com/xxxx?sub_id=...",
        "is_best_deal": true
      },
      {
        "id": "d1e2f3a4-b5c6-7a8b-9c0d-1e2f3a4b5c6d",
        "platform": "shopee",
        "listed_price": 120000,
        "effective_price": 120000,
        "affiliate_url": "https://s.shopee.vn/universal-link?...",
        "is_best_deal": false
      }
    ]
  }
  ```

### 6.2. Thu Cong Lien Ket Nguon San Moi Vao Nhom San Pham
- **Endpoint**: `POST /api/v1/products/{product_id}/link-source`
- **Request Body**:
  ```json
  {
    "url": "https://tiktok.com/@shop/product/123456"
  }
  ```
- **Response**: `201 Created` (hoac `409 Conflict` neu da ton tai).

### 6.3. Danh Sach Nhom San Pham Da San
- **Endpoint**: `GET /api/v1/product-groups`
- **Header**: `X-User-ID: <uuid>` (hoac Bearer)
- **Response `200 OK`**: Danh sach cac nhom san pham co tu 2 nguon san tro len.

---

## 7. Nhom Endpoint Tu Dong So Khop (Auto-Matching — GAP-03)

### 7.1. Kich Hoat Quet So Khop Tu Dong
- **Endpoint**: `POST /api/v1/products/{product_id}/auto-match`
- **Endpoint**: `POST /api/v1/tracked-products/{id}/auto-match`
- **Response `200 OK`**: Kich hoat job tim kiem ung vien da san ngam.

### 7.2. Lay Danh Sach Goi Y So Khop (Suggestions)
- **Endpoint**: `GET /api/v1/products/{product_id}/match-suggestions`
- **Endpoint**: `GET /api/v1/tracked-products/{id}/match-suggestions`
- **Response `200 OK`**:
  ```json
  [
    {
      "id": "sug-uuid-1",
      "platform": "lazada",
      "title": "Tai nghe Sony WH-1000XM5 Flagship Store",
      "price": 5490000,
      "confidence_score": 0.88,
      "canonical_url": "https://lazada.vn/products/...",
      "status": "pending"
    }
  ]
  ```

### 7.3. Chap Nhan Hoac Bo Qua Goi Y So Khop
- **Endpoint**: `POST /api/v1/products/{product_id}/match-suggestions/{id}/accept`
- **Endpoint**: `POST /api/v1/products/{product_id}/match-suggestions/{id}/dismiss`
- **Response `200 OK`**

---

## 8. Nhom Endpoint Quan Ly Voucher (Phase 3.5)

### 8.1. Lay Danh Sach Voucher Kha Dung Cho San Pham
- **Endpoint**: `GET /api/v1/tracked-products/{id}/vouchers`
- **Response `200 OK`**:
  ```json
  [
    {
      "id": "voucher-uuid-1",
      "voucher_type": "shop_voucher",
      "voucher_code": "SONY10OFF",
      "title": "Giam 10% toi da 300k don tu 3tr",
      "discount_amount": 300000,
      "discount_percent": 10,
      "min_order_value": 3000000,
      "collect_url": "https://s.shopee.vn/universal-link?...",
      "expires_at": "2026-10-31T23:59:59Z"
    }
  ]
  ```

### 8.2. Them Voucher Moi
- **Endpoint**: `POST /api/v1/tracked-products/{id}/vouchers`
- **Request Body**:
  ```json
  {
    "voucher_type": "shop_voucher",
    "title": "Mã giảm 50k",
    "discount_amount": 50000,
    "min_order_value": 500000,
    "collect_url": "https://shopee.vn/voucher/..."
  }
  ```
- **Response `201 Created`**

---

## 9. Nhom Endpoint Webhook Zalo (Production Connector)

### 9.1. Tiếp Nhận Callback Trạng Thái Gửi Tin Zalo
- **Endpoint**: `POST /api/v1/webhooks/zalo` hoac `POST /api/v1/notifications/webhook/zalo`
- **Header Xác Thực**:
  - `X-ZEvent-Signature` / `X-Zalo-Signature`: Chữ ký HMAC-SHA256 tính từ secret key `ZALO_WEBHOOK_SECRET`.
  - Hoặc header bí mật `X-DealHunter-Secret`.
- **Sự kiện tiếp nhận**:
  - `user_received_message` $\to$ Cập nhật `notification_logs.status = 'delivered'`.
  - `user_read_message` $\to$ Cập nhật `notification_logs.status = 'read'`.
- **Response `200 OK`**: `{"status": "ok"}`
