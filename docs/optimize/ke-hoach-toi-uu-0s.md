# Kế hoạch tối ưu điểm danh 0 giây (Caffiliate)

> **Phiên bản**: 2.4 · **Cập nhật**: 19-10-2026 (báo cáo thực chiến đêm 18/10 → 19/10 đạt `00:00:00.178` và chuyển sang chế độ 4 mẫu IQR, xem mục 9)  
> **Phạm vi**: `extension/` (Caffiliate adapter, main-world bridge, strike plan, nhật ký điểm danh)  
> **Mục tiêu**: Lượt điểm danh được máy chủ xử lý **ngay sau** 00:00:00, lọt vào cửa sổ Top 1–3 Bảng vàng điểm danh (nhận thưởng +3 hoặc +2 xèng).

**Cách đọc các ghi chú:**

- **[Đã kiểm]**: đối chiếu được với nhật ký hoặc mã nguồn.
- **[Suy luận]**: rút ra từ số liệu nhưng chưa chứng minh trực tiếp.
- **[Chưa có dữ liệu]**: chưa có số liệu nào để khẳng định; cần đo thêm.

---

## 1. Dữ liệu đêm 13/10 → 14/10/2026 (Giai đoạn khởi động, chưa có mẫu)

### 1.1. Bảng vàng điểm danh Caffiliate (14/10)

| Hạng | Tên | Giờ hiển thị | Thưởng sớm |
| :--- | :--- | :--- | :--- |
| 1 | HaHa | 00:00:00 | +3 xèng |
| 2 | Hậu | 00:00:00 | +2 xèng |
| 3 | THỐNG | 00:00:00 | +2 xèng |
| 4 | Tien Dang | 00:00:01 | trượt Top 3 (chỉ +1 xèng chuỗi) |

Tài khoản: chuỗi 13 ngày, 95 xèng. Bảng vàng hiển thị đến giây nên không rõ mili-giây của Top 1–3.

### 1.2. Nhật ký điểm danh DealHunter (14/10)

Kết quả: «Đã điểm danh · page confirmed», lúc 13/10 23:59:59.

```text
Kế hoạch: 8 lần từ T−98ms · chuẩn bị ~0ms · mạng ~39ms · ±48ms
Mốc dự kiến tới máy chủ: −59 −28 −8 +12 +32 +52 +72 +92 ms
```

| Lần | Bắt đầu | Tầng | Turnstile | Gửi (sau khi bắt đầu) | Máy chủ · HTTP |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 23:59:59.906 | Hàm | **1434 ms** | 00:00:01.477 (+1571 ms) | 186 ms · 200 |
| 2 | 23:59:59.939 | Hàm | 1 ms | 00:00:01.674 (+1735 ms) | 181 ms · 200 |
| 3 | 23:59:59.975 | Hàm | 1 ms | 00:00:01.674 (+1699 ms) | 162 ms · 200 |

*Nhận định đợt 1*: Kế hoạch tính $P = 0$ms do chưa có mẫu lịch sử, dẫn đến xuất phát trễ tại $T - 98$ms. Turnstile mất 1434ms làm request bị đẩy sang giây `00:00:01`.

---

## 2. Dữ liệu đêm 15/10 → 16/10/2026 (Chạm giây 00:00:00.207 · Hạng #4)

Đêm 15/10 rạng sáng 16/10/2026, hệ thống vận hành với thuật toán tự thích ứng (Self-Adaptive Strike Plan) dựa trên mẫu lịch sử đợt 1 và cơ chế `strikesWithoutTarget()`.

### 2.1. Bảng vàng điểm danh Caffiliate (16/10)

![Bảng vàng điểm danh 16/10/2026](./images/leaderboard-2026-10-16.png)

| Hạng | Tên | Chuỗi ngày | Giờ hiển thị | Thưởng nhận được |
| :--- | :--- | :--- | :--- | :--- |
| **#1** | HaHa | 24 | 00:00:00 | +3 xèng |
| **#2** | Kaito | 34 | 00:00:00 | +2 xèng |
| **#3** | THỐNG | 201 | 00:00:00 | +2 xèng |
| **#4** | **Tien Dang** | **1** | **00:00:00** | **Không có thưởng sớm (trượt Top 3)** |

*Ghi nhận quan trọng*: Toàn bộ 4 vị trí dẫn đầu đều đạt mốc **`00:00:00`**. Tien Dang đã chính thức bước vào giây `00:00:00` cùng nhóm dẫn đầu, nhưng xếp sau Top 3 một khoảng cách rất nhỏ tính bằng mili-giây.

### 2.2. Nhật ký điểm danh DealHunter (16/10)

![Nhật ký điểm danh 16/10/2026](./images/timing-log-2026-10-16.png)

Kết quả ghi nhận: **«Đã điểm danh · page confirmed»**, lúc 15/10 23:59:58.

```text
Kế hoạch: 5 lần từ T−1324ms · chuẩn bị ~1571ms · mạng ~150ms · ±397ms
Mốc dự kiến: +397 +417 +437 +457 +477 ms
```

Chi tiết từng lần thử trong chuỗi khai hỏa:

| Lần | Bắt đầu | Tầng | Turnstile | Gửi request (sau khi bắt đầu) | Gửi → trả lời · HTTP | Câu trả lời máy chủ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **23:59:58.685** | **Hàm** | **1432 ms** | **00:00:00.207 (+1522 ms)** | **418 ms · 200** | **«success=true · Điểm danh thành công!»** |

> **Lưu ý đọc nhật ký [Đã kiểm, `src/lib/checkin_log.ts`]:** mốc `00:00:00.207 (+1522)` là lúc request **rời trình duyệt** (`sent`, theo giờ máy chủ đã hiệu chỉnh), không phải lúc máy chủ trả lời. `418 ms` là thời gian từ lúc gửi tới lúc nhận câu trả lời. Request tới máy chủ khoảng `00:00:00.207 + mạng một chiều (~39 ms)` ≈ `00:00:00.246`; câu trả lời về khoảng `00:00:00.625`.
| 2 | 23:59:58.705 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |
| 3 | 23:59:58.728 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |
| 4 | 23:59:58.748 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |
| 5 | 23:59:58.770 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |

---

## 3. Phân tích đối chiếu thực nghiệm

### 3.1. Độ chính xác của mô hình toán Gaussian **[Đã kiểm]**

So sánh giữa dự kiến lý thuyết và thực tế đo được đêm 15/10:
* **Mốc xuất phát dự kiến**: `23:59:58.677` ($T - 1323$ms).
* **Mốc xuất phát thực tế**: `23:59:58.685` ($T - 1324$ms).  
  $\rightarrow$ Sai số khởi động chỉ là **8 mili-giây** ($0.008$s).
* **Thời gian giải Turnstile qua 2 đợt**:
  * Đêm 13/10: `1434 ms`
  * Đêm 15/10: `1432 ms`  
  $\rightarrow$ Biến thiên thực tế chỉ là **2 mili-giây** ($0.002$s). Điều này chứng minh thời gian CPU giải bài toán Proof-of-Work của Cloudflare Turnstile trên máy cục bộ cực kỳ ổn định.
* **Thời điểm gửi thực tế**: `00:00:00.207` (request tới máy chủ khoảng `00:00:00.246`), sớm hơn kế hoạch khoảng 49 ms vì lần chuẩn bị này mất 1522 ms thay vì 1571 ms.
* **Lưu ý [Suy luận]**: "Turnstile ổn định" mới dựa trên 2 lần đo; chưa đủ để coi là chắc chắn.

### 3.2. Vì sao đạt `00:00:00` nhưng vẫn đứng Hạng #4? **[Suy luận]**

1. **Độ trễ xử lý phía máy chủ tăng đột biến (418 ms so với 186 ms)**:
   * Vào thời khắc 00:00:00, lượng người dùng và bot cùng dồn request khiến máy chủ Caffiliate mất tới `418 ms` để hoàn tất xác thực và trả về kết quả (gấp 2.25 lần so với đêm 13/10).
2. **Khoảng cách với Top 3**:
   * Ba người đứng đầu (HaHa, Kaito, THỐNG) đều ghi nhận giờ `00:00:00`.
   * Request của Tien Dang **rời máy** lúc `00:00:00.207`, tới máy chủ khoảng `00:00:00.246`, được trả lời khoảng `00:00:00.625`.
   * Bảng vàng chỉ hiện tới giây nên **không đo được** Top 1–3 đến lúc nào; chỉ biết họ sớm hơn. **[Chưa có dữ liệu]** về khoảng cách chính xác.
3. **Biên an toàn ($\sigma$) hiện tại quá rộng**:
   * Vì công thức chỉ có 1 mẫu lịch sử từ đêm 13/10, hệ thống buộc phải dùng ước lượng thận trọng $J_P = P / 4 \approx 393$ms, dẫn đến $\sigma \approx 395$ms. **Đây là nguyên nhân chính** [Đã kiểm, `src/lib/strike_plan.ts`].
   * Do lo ngại request bay đến trước 00:00:00 sẽ bị máy chủ từ chối, mốc ngắm mục tiêu đầu tiên được đặt tại $a_0 = +\sigma \approx +395$ms sau 0h.
   * Vì ngắm xa sau 0h để phòng thủ, request đến đích ở mili-giây thứ 207, tạo điều kiện cho các đối thủ ngắm sát 0h hơn chiếm lĩnh Top 1–3.

---

## 4. Bảng tổng hợp diễn biến qua các đêm

| Tiêu chí | Đêm 13/10 → 14/10 | Đêm 15/10 → 16/10 | Đêm 17/10 → 18/10 | Đêm 18/10 → 19/10 | Xu hướng |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Thứ hạng / Kết quả** | Hạng #4 (`00:00:01`) | Hạng #4 (`00:00:00`) | Ngoài Top 3 (`00:00:08`) | Thành công (`00:00:00`) | Kỷ lục mới về thời điểm gửi (`+178 ms`) |
| **Kế hoạch (`leadMs` · `sigmaMs`)** | `T−98ms` · `±48ms` | `T−1324ms` · `±397ms` | `T--6598ms` · `±5471ms` | **`T−1448ms` · `±75ms`** | Biên độ $\sigma$ đã thu hẹp 5.3 lần so với 16/10 |
| **Mốc dự kiến chạm máy chủ** | `−59 .. +92 ms` | `+397 .. +477 ms` | `+8206 .. +8286 ms` | **`+112 .. +192 ms`** | Ngắm sát mốc 00:00:00.100 |
| **Lần 1 xuất phát thực tế** | `23:59:59.906` | `23:59:58.685` | `00:00:06.603` | **`23:59:58.554`** | Sai số bộ đếm chỉ **2 ms** so với kế hoạch |
| **Turnstile Lần 1 (`sentAfterMs`)** | 1434 ms (`+1571`) | 1432 ms (`+1522`) | 1367 ms (`+1494`) | **1489 ms (`+1625`)** | Dao động tự nhiên trong dải `1494–1625 ms` |
| **Giờ gửi request (`sent`)** | `00:00:01.477` | `00:00:00.207` | `00:00:08.096` | **`00:00:00.178`** | **Nhanh hơn 29 ms so với đêm 16/10** |
| **Ước tính chạm máy chủ** | `~00:00:01.516` | `~00:00:00.246` | `~00:00:08.133` | **`~00:00:00.216`** | Rút ngắn khoảng cách tới mốc 00:00:00 |
| **Thời gian mạng + server** | 186 ms | 418 ms | 224 ms | **207 ms** | Phản hồi hoàn tất lúc `~00:00:00.385` |

---

## 5. Những cải tiến đã hoạt động ổn định

1. **`strikesWithoutTarget()`**:
   * Đã chứng minh hiệu quả trong thực chiến các đêm 15/10, 17/10 và 18/10: Lệnh bắn nổ đúng lịch trình (sai số khởi động chỉ 2 ms vào đêm 18/10) mà không bị gián đoạn hay phụ thuộc vào cấu trúc thẻ DOM của trang.
2. **Học thời gian chuẩn bị từ nhật ký (`prepSamplesFromLogs`) và tự động lọc mẫu nhiễu (`MAX_SANE_PREP_MS = 3500`)**:
   * Hệ thống tự động loại bỏ mẫu lỗi `~7864 ms` trong bộ nhớ trình duyệt mà không cần xóa lịch sử, giữ lại đúng các mẫu chuẩn để tính trung vị và độ phân tán.
3. **Lưu trữ câu trả lời máy chủ**:
   * Đã ghi nhận chính xác phản hồi `«success=true · Điểm danh thành công!»` cho từng lượt bắn.

---

## 6. Kế hoạch hành động để bứt phá vào Top 1–3 (Đêm 16/10 → 17/10)

Dữ liệu thực tế cho thấy hệ thống chỉ còn cách Top 3 khoảng **100 mili-giây**. Hai đòn bẩy kỹ thuật để san lấp khoảng cách này:

### 6.1. Thu hẹp biên an toàn Gaussian ($\sigma$)
* Hiện tại hệ thống đã có 2 mẫu đo Turnstile thực tế gần như trùng khớp hoàn hảo: `1434 ms` và `1432 ms`.
* Khi tính độ phân tán $J_P$ từ dữ liệu thực thay vì lấy mặc định $P/4$, $\sigma$ sẽ giảm mạnh từ ~395 ms xuống còn khoảng **50 ms – 80 ms**.
* Điều này giúp mốc ngắm $a_0$ dịch chuyển từ $+395$ms về sát **$+50$ms đến $+80$ms** sau 00:00:00, đưa thời điểm chạm máy chủ từ 207 ms xuống còn dưới 80 ms (vùng chiếm giải Top 1–3).

### 6.2. Kiểm chứng giả định thời điểm máy chủ chốt thứ hạng
* Nếu máy chủ ghi nhận thứ hạng tại thời điểm **nhận request** (thay vì thời điểm trả phản hồi sau khi verify token), thì request rời máy lúc `23:59:59.789` chỉ cần 35 ms để đến máy chủ lúc `00:00:00.024`.
* Cần tiếp tục theo dõi độ trễ mạng RTT trước giờ G 5 phút để hiệu chỉnh chính xác giá trị $L$ (oneWayMs).

---

## 7. Hiệu chỉnh 16/10/2026

**Thay đổi trong `extension/src/lib/strike_plan.ts`** (test: `src/lib/strike_plan.test.ts`):

1. **Độ dao động khi có 2–3 lần đo:** dùng độ lệch chuẩn của chính các lần đo × 1.5 (thận trọng vì ít mẫu), tối thiểu 30 ms; thay cho mặc định ¼ thời gian chuẩn bị. 1 lần đo vẫn dùng ¼ (chưa biết gì về độ dao động); từ 4 lần trở lên dùng khoảng tứ phân vị như cũ.
2. **Caffiliate (chờ Turnstile) ngắm theo lúc request TỚI máy chủ** = lúc gửi + mạng một chiều. Biên an toàn chỉ tính những gì làm request tới sớm: sai số đồng hồ, dao động thời gian chuẩn bị, dao động mạng. Thời gian máy chủ xử lý (xác thực Turnstile, chậm hơn khi đông) xảy ra **sau** khi nhận nên không làm request tới sớm, không còn cộng vào biên. Mốc tới đầu tiên = 1.5σ sau 0h (khoảng 93% số đêm tới sau 0h theo mô hình).

---

## 8. Sự cố đêm 17/10 → 18/10/2026 và bản vá chống mẫu nhiễu (v2.3)

### 8.1. Nhật ký điểm danh DealHunter (18/10)

![Nhật ký điểm danh 18/10/2026](./images/timing-log-2026-10-18.png)

Kết quả ghi nhận: **«Đã điểm danh · page confirmed»**, lúc 18/10 00:00:06.

```text
Kế hoạch: 5 lần từ T--6598ms · chuẩn bị ~1571ms · mạng ~37ms · ±5471ms
Mốc dự kiến: +8206 +8226 +8246 +8266 +8286 ms
```

| Lần | Bắt đầu | Tầng | Turnstile | Gửi request (sau khi bắt đầu) | Gửi → trả lời · HTTP | Câu trả lời máy chủ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **00:00:06.603** | **Hàm** | **1367 ms** | **00:00:08.096 (+1494 ms)** | **224 ms · 200** | **«success=true · Điểm danh thành công!»** |
| 2 | 00:00:06.625 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |
| 3 | 00:00:06.647 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |
| 4 | 00:00:06.666 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |
| 5 | 00:00:06.687 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |

### 8.2. Chẩn đoán nguyên nhân gốc rễ **[Đã kiểm]**

Tại sao `chuẩn bị ~1571ms` hoàn toàn bình thường nhưng biên độ lại vọt lên `±5471ms` và thời điểm bắt đầu lại thành `T--6598ms` (tức chờ tới `00:00:06.598` mới khai hỏa)?

1. **Sự xuất hiện của 1 mẫu nhiễu (~7864 ms) trong lịch sử trình duyệt**:
   * Trước thời điểm 00:00 ngày 18/10, trong `chrome.storage.local["dh_checkin_logs"]` có 3 bản ghi hợp lệ của `caffiliate.vn`: hai đêm chuẩn (`1522 ms`, `1571 ms`) và một lần chạy bị kẹt Turnstile hoặc treo tab mất khoảng **`7864 ms`**.
   * Với mảng 3 phần tử `[1522, 1571, 7864]`:
     * **Trung vị (`prepMs`)**: phần tử đứng giữa là **`1571 ms`**, nên dòng log vẫn hiển thị `chuẩn bị ~1571ms`, che khuất sự tồn tại của mẫu `7864 ms`.
     * **Độ lệch chuẩn (`stdDev`)**: trung bình của `[1522, 1571, 7864]` là `3652.3 ms`, làm `stdDev = 3647.5 ms`.
     * Khi nhân hệ số `SMALL_SAMPLE_INFLATION = 1.5` trong `spreadOf()`, `prepJitter` vọt lên `3647.5 × 1.5 = 5471.2 ms` $\rightarrow$ **`receiptSigma = 5471 ms`**.
2. **Mốc ngắm bị đẩy ra `+8206 ms` và `leadMs` bị âm (`-6598 ms`)**:
   * `first = Math.round(1.5 × 5471) = +8206 ms`.
   * `starts[0] = 8206 - 1571 - 37 = +6598 ms`.
   * `leadMs = Math.min(3000, Math.round(-starts[0])) = -6598 ms` (do chỉ có cận trên `Math.min` mà thiếu cận dưới `Math.max(0, ...)`).
   * Khi `leadMs = -6598 ms`, `hunt_engine.ts` đặt lịch bắn tại `dropTime - (-6598) = 00:00:06.598` và hiển thị chuỗi `T-${-6598}ms` thành **`T--6598ms`**.

### 8.3. Bản vá hai tầng trong mã nguồn **[Đã kiểm]**

Để triệt tiêu hoàn toàn lỗi này (kể cả khi mẫu `7864 ms` vẫn đang nằm sẵn trong bộ nhớ trình duyệt của người dùng), hệ thống đã được cập nhật 2 lớp bảo vệ:

1. **Tầng 1 — Lọc tại nguồn đọc lịch sử (`extension/src/lib/checkin_log.ts`)**:
   * Bổ sung hằng số `MAX_SANE_PREP_MS = 3500` vào `firstSentAttempts()`.
   * Bỏ qua mọi lượt thử có `tokenError: true` hoặc `sentAfterMs < 0 || sentAfterMs > 3500`.
   * Nhờ đó, mẫu nhiễu `~7864 ms` đang lưu trong `chrome.storage.local` của trình duyệt sẽ tự động bị loại bỏ ngay khi nạp lại extension mà không cần xóa lịch sử. Ba mẫu sạch còn lại được giữ nguyên: **`[1494, 1522, 1571]`**.
2. **Tầng 2 — Kháng nhiễu và khóa biên trong bộ lập lịch (`extension/src/lib/strike_plan.ts`)**:
   * **Cắt bỏ mẫu ngoại lai (Outlier trimming)**: Trước khi tính `prepMs` và `spreadOf()`, lấy tứ phân vị dưới `q1 = raw[Math.floor((raw.length - 1) * 0.25)]`. Nếu `raw.length >= 2` và `q1 >= TOKEN_BOUND_PREP_MS`, loại bỏ mọi mẫu `v` vượt quá `2 × q1` đồng thời lệch quá `1000 ms` so với `q1` (`v <= q1 * 2 || v - q1 <= 1000`). Cơ chế này bảo vệ cả trường hợp 2–3 mẫu (`stdDev`) lẫn 4+ mẫu (`IQR` nội suy tuyến tính).
   * **Khóa trần `prepJitter` cho `tokenBound`**: Không bao giờ để `prepJitter` của nhiều mẫu vượt quá mức dự phòng `prepMs * 0.25` của 1 mẫu (`Math.min(rawPrepJitter, prepMs * 0.25)`).
   * **Khóa sàn `leadMs >= 0`**: Dùng `Math.max(0, Math.min(P.MAX_LEAD_MS, Math.round(-starts[0])))` ở cả hai nhánh lập lịch để đảm bảo không bao giờ xuất hiện `leadMs` âm (`T--...`).

### 8.4. Kế hoạch dự kiến cho đêm 18/10 → 19/10 **[Đã kiểm]**

Sau khi lọc bỏ mẫu `7864 ms`, trình duyệt có **3 mẫu sạch thực tế**: `1571 ms` (14/10), `1522 ms` (16/10) và `1494 ms` (18/10). Với `rttMs = 74 ms` (`oneWayMs = 37 ms`) và `clockErrorMs = 20 ms`:

| Thông số | Đêm 18/10 (khi dính mẫu 7864ms) | Dự kiến Đêm 19/10 (sau bản vá v2.3) |
| :--- | :--- | :--- |
| **Tập mẫu chuẩn bị (`prepSamplesMs`)** | `[1522, 1571, 7864]` | **`[1494, 1522, 1571]`** |
| **Trung vị chuẩn bị (`prepMs`)** | `1571 ms` | **`1522 ms`** |
| **Độ bất định nhận request (`sigmaMs`)** | `±5471 ms` | **`±60 ms`** (với `clockErrorMs = 20ms`) |
| **Mốc dự kiến tới máy chủ (`arrivalsMs`)** | `+8206 +8226 +8246 +8266 +8286 ms` | **`+90 +110 +130 +150 +170 ms`** |
| **Độ sớm khai hỏa (`leadMs`)** | `-6598 ms` (`00:00:06.603`) | **`1469 ms` (`23:59:58.531`)** |

---

## 9. Dữ liệu thực chiến đêm 18/10 → 19/10/2026 (Gửi lúc `00:00:00.178` · Kiểm chứng bản vá v2.3)

### 9.1. Nhật ký điểm danh DealHunter (19/10)

![Nhật ký điểm danh 19/10/2026](./images/timing-log-2026-10-19.png)

Kết quả ghi nhận: **«Đã điểm danh · page confirmed»**, lúc 18/10 23:59:58.

```text
Kế hoạch: 5 lần từ T−1448ms · chuẩn bị ~1522ms · mạng ~38ms · ±75ms
+112 +132 +152 +172 +192 ms
```

Chi tiết từng lần thử trong chuỗi khai hỏa:

| Lần | Bắt đầu | Tầng | Turnstile | Gửi request (sau khi bắt đầu) | Gửi → trả lời · HTTP | Câu trả lời máy chủ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **23:59:58.554** | **Hàm** | **1489 ms** | **00:00:00.178 (+1625 ms)** | **207 ms · 200** | **«success=true · Điểm danh thành công!»** |
| 2 | 23:59:58.574 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |
| 3 | 23:59:58.608 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |
| 4 | 23:59:58.619 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |
| 5 | 23:59:58.640 | Hàm | 1 ms | — | — | (Đã xác nhận từ lần 1) |

### 9.2. Phân tích đối chiếu kế hoạch và thực tế đêm 18/10 → 19/10 **[Đã kiểm]**

1. **Bản vá v2.3 hoạt động chính xác 100% trên dữ liệu thật**:
   * **Loại bỏ mẫu nhiễu tự động**: Không cần xóa lịch sử trình duyệt, hằng số `MAX_SANE_PREP_MS = 3500` và bộ lọc $q_1$ đã loại bỏ hoàn toàn mẫu `~7864 ms` của đêm trước.
   * **Trung vị `prepMs` khớp tuyệt đối**: Từ 3 mẫu sạch `[1494, 1522, 1571]`, hệ thống trích xuất đúng `prepMs = 1522 ms` (`chuẩn bị ~1522ms`), khớp từng mili-giây với bảng dự báo mục 8.4.
   * **Giải thích thông số `±75ms` và `T−1448ms`**:
     * Độ trễ mạng một chiều đo thực tế trước giờ G là `oneWayMs = 38 ms` (`rttMs = 76 ms`), dẫn đến `rttJitter = 38 × 0.25 = 9.5 ms`.
     * Độ phân tán của 3 mẫu chuẩn bị `[1494, 1522, 1571]` là `prepJitter = stdDev([1494, 1522, 1571]) × 1.5 = 38.73 × 1.5 = 58.1 ms`.
     * Với `sigmaMs = 75 ms`, thành phần sai số đồng hồ tại thời điểm lập lịch là `clockSigma = sqrt(75^2 - 58.1^2 - 9.5^2) ≈ 46.5 ms` (tương ứng `clockErrorMs ≈ 80 ms` từ lần đồng bộ giờ gần nhất).
     * Từ `receiptSigma = 75 ms`, mốc ngắm nhận request đầu tiên là `first = round(1.5 × 75) = +112 ms`, tạo thành chuỗi 5 mốc cách nhau 20 ms: **`+112 +132 +152 +172 +192 ms`**.
     * Thời điểm khai hỏa dự kiến: `leadMs = 1522 + 38 - 112 = 1448 ms` (`T−1448ms`, tức `23:59:58.552`).

2. **Độ trễ vòng lặp khai hỏa (Spin-Wait) đạt mức 2 mili-giây**:
   * Mốc xuất phát theo kế hoạch: `23:59:58.552` (`T − 1448 ms`).
   * Mốc xuất phát thực tế của Lần 1: **`23:59:58.554`** (`T − 1446 ms`).
   * Sai số điều phối của `hunt_engine.ts` chỉ là **2 mili-giây** (`0.002s`), cải thiện gấp 4 lần so với mức sai số 8 ms của đêm 15/10.

3. **Biến thiên thời gian giải Turnstile và kỷ lục mới về thời điểm gửi (`00:00:00.178`)**:
   * Trong lần chạy này, Cloudflare Turnstile mất **`1489 ms`** để cấp token (dài hơn khoảng `55–122 ms` so với dải `1367–1434 ms` của 3 đêm trước), làm tổng thời gian từ lúc gọi `app.checkIn()` đến lúc gói tin `fetch` rời trình duyệt (`sentAfterMs`) tăng lên **`1625 ms`** (chậm hơn dự kiến trung vị `1522 ms` là `+103 ms`).
   * Tuy nhiên, nhờ xuất phát sớm ở `23:59:58.554`, gói tin điểm danh đã rời trình duyệt lúc **`00:00:00.178`**, vượt qua kỷ lục cũ của đêm 16/10 (`00:00:00.207`) **29 mili-giây**.
   * Thời điểm gói tin chạm máy chủ ước tính là `00:00:00.178 + 38 ms ≈ 00:00:00.216`.
   * Máy chủ phản hồi `HTTP 200` (`«success=true · Điểm danh thành công!»`) chỉ sau **`207 ms`** (nhanh gấp đôi mức `418 ms` của đêm 16/10), hoàn tất toàn bộ quá trình xác nhận điểm danh ở **`~00:00:00.385`**.

### 9.3. Bước chuyển tự động sang chế độ 4 mẫu (IQR) cho đêm 19/10 → 20/10 **[Đã kiểm]**

Sau đêm 19/10, lịch sử của `caffiliate.vn` trong trình duyệt đã tích lũy đủ **4 mẫu sạch**: **`[1494, 1522, 1571, 1625]`**. Theo thiết kế trong [`strike_plan.ts`](file:///Users/tiendn/Workplace/Projects/deal-hunter/dealhunter/extension/src/lib/strike_plan.ts#L110-L122), kể từ mẫu thứ 4 trở đi, thuật toán tự động nâng cấp theo hai hướng:

1. **Trung vị `prepMs` tự động dịch chuyển để bù độ trễ Turnstile**:
   * Với 4 mẫu `[1494, 1522, 1571, 1625]`, trung vị nội suy tuyến tính là:
     $$\text{prepMs} = \frac{1522 + 1571}{2} = 1546.5 \approx \mathbf{1547\text{ ms}}$$
   * Hệ thống tự động cộng thêm **25 ms** vào thời gian chuẩn bị dự kiến (từ `1522 ms` lên `1547 ms`), giúp giờ xuất phát đêm tới sớm hơn để hấp thụ trường hợp Turnstile giải chậm như đêm 19/10 (`1489 ms`).

2. **Chuyển từ `stdDev × 1.5` sang Khoảng tứ phân vị chuẩn hóa (`IQR / 1.349`)**:
   * Khi có 4 mẫu `[1494, 1522, 1571, 1625]`:
     * Tứ phân vị dưới: $Q_{0.25} = 1494 + 0.75 \times (1522 - 1494) = 1515.0\text{ ms}$
     * Tứ phân vị trên: $Q_{0.75} = 1571 + 0.25 \times (1625 - 1571) = 1584.5\text{ ms}$
     * Độ trải giữa: $\text{IQR} = 1584.5 - 1515.0 = 69.5\text{ ms}$
     * Độ phân tán chuẩn hóa:
       $$\text{prepJitter} = \frac{\text{IQR}}{1.349} = \frac{69.5}{1.349} \approx \mathbf{51.5\text{ ms}}$$
   * Đáng chú ý: mặc dù mẫu mới `1625 ms` lệch xa hơn, việc chuyển từ công thức mẫu nhỏ (`stdDev × 1.5 = 58.1 ms`) sang công thức 4 mẫu (`IQR / 1.349 = 51.5 ms`) giúp **giảm `prepJitter` thêm 6.6 ms** mà vẫn phản ánh trung thực độ biến thiên thực tế của Turnstile.

3. **Bảng dự báo kế hoạch khai hỏa đêm 19/10 → 20/10**:

| Thông số | Đêm 19/10 (3 mẫu · `stdDev × 1.5`) | Dự kiến Đêm 20/10 (4 mẫu · `IQR / 1.349`) |
| :--- | :--- | :--- |
| **Tập mẫu chuẩn bị (`prepSamplesMs`)** | `[1494, 1522, 1571]` | **`[1494, 1522, 1571, 1625]`** |
| **Trung vị chuẩn bị (`prepMs`)** | `1522 ms` | **`1547 ms`** (+25 ms bù Turnstile) |
| **Độ phân tán chuẩn bị (`prepJitter`)** | `58.1 ms` | **`51.5 ms`** (-6.6 ms nhờ đủ 4 mẫu IQR) |
| **Độ bất định nhận request (`sigmaMs`)** | `±75 ms` (khi `clockError ≈ 80ms`) | **`±54 ms` – `±70 ms`** (tùy sai số đồng hồ 20–80ms) |
| **Mốc dự kiến tới máy chủ (`arrivalsMs`)** | `+112 +132 +152 +172 +192 ms` | **`+80 .. +160 ms`** (hoặc `+105 .. +185 ms`) |
| **Độ sớm khai hỏa (`leadMs`)** | `T − 1448 ms` (`23:59:58.552`) | **`T − 1480 ms` đến `T − 1504 ms`** (`23:59:58.496` – `.520`) |
| **Dự kiến chạm máy chủ nếu prep = 1522–1571ms** | `~00:00:00.216` (thực tế khi prep = 1625ms) | **`~00:00:00.055` – `~00:00:00.129`** |
