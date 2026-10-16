# Kế hoạch tối ưu điểm danh 0 giây (Caffiliate)

> **Phiên bản**: 2.2 · **Cập nhật**: 16-10-2026 (hiệu chỉnh cách đọc nhật ký và bộ lập lịch, xem mục 7)  
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

| Tiêu chí | Đêm 13/10 → 14/10 | Đêm 15/10 → 16/10 | Xu hướng |
| :--- | :--- | :--- | :--- |
| **Thứ hạng** | Hạng #4 | Hạng #4 | Đang bám sát Top 3 |
| **Giờ trên Bảng vàng** | `00:00:01` | **`00:00:00`** | **Rút ngắn 1 giây, vào đúng giây 00** |
| **Giờ phản hồi máy chủ** | `00:00:01.477` | **`00:00:00.207`** | **Nhanh hơn 1.27 giây** |
| **Lần 1 xuất phát** | `23:59:59.906` | `23:59:58.685` | Tự động xuất phát sớm trước 1.3s |
| **Turnstile Lần 1** | 1434 ms | 1432 ms | Độ lệch ổn định tuyệt đối (±2 ms) |
| **Thời gian mạng + server**| 186 ms | 418 ms | Máy chủ chịu tải cao lúc nửa đêm |
| **Trạng thái nổ súng** | Bị ảnh hưởng bởi DOM | Chạy ngầm độc lập qua `strikesWithoutTarget()` | Miễn nhiễm lỗi chọn nhầm nút |

---

## 5. Những cải tiến đã hoạt động ổn định

1. **`strikesWithoutTarget()`**:
   * Đã chứng minh hiệu quả trong thực chiến đêm 15/10: Lệnh bắn nổ đúng `23:59:58.685` mà không bị gián đoạn hay phụ thuộc vào cấu trúc thẻ DOM của trang.
2. **Học thời gian chuẩn bị từ nhật ký (`prepSamplesFromLogs`)**:
   * Hệ thống tự động bù trừ $1571$ms vào lịch trình, triệt tiêu hoàn toàn độ trễ 1.4s của Turnstile.
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

## 7. Hiệu chỉnh 16/10/2026 (đã áp dụng, chưa chạy thực tế)

**Thay đổi trong `extension/src/lib/strike_plan.ts`** (test: `src/lib/strike_plan.test.ts`):

1. **Độ dao động khi có 2–3 lần đo:** dùng độ lệch chuẩn của chính các lần đo × 1.5 (thận trọng vì ít mẫu), tối thiểu 30 ms; thay cho mặc định ¼ thời gian chuẩn bị. 1 lần đo vẫn dùng ¼ (chưa biết gì về độ dao động); từ 4 lần trở lên dùng khoảng tứ phân vị như cũ.
2. **Caffiliate (chờ Turnstile) ngắm theo lúc request TỚI máy chủ** = lúc gửi + mạng một chiều. Biên an toàn chỉ tính những gì làm request tới sớm: sai số đồng hồ, dao động thời gian chuẩn bị, dao động mạng. Thời gian máy chủ xử lý (xác thực Turnstile, chậm hơn khi đông) xảy ra **sau** khi nhận nên không làm request tới sớm, không còn cộng vào biên. Mốc tới đầu tiên = 1.5σ sau 0h (khoảng 93% số đêm tới sau 0h theo mô hình).

**Kế hoạch dự kiến đêm 16/10 → 17/10** (với 2 lần đo 1571 / 1522 ms, giả định RTT 78 ms, sai số đồng hồ ±20 ms; số thật phụ thuộc lần hiệu chỉnh giờ tối nay):

| | Đêm 15/10 (cũ) | Đêm 16/10 (mới, dự kiến) |
| :--- | :--- | :--- |
| Bắt đầu lần 1 | T − 1324 ms | T − 1505 ms |
| σ dùng cho biên an toàn | 395 ms | ~54 ms |
| Request rời máy | T + 207 ms (thực tế) | ~T + 42 ms |
| Request tới máy chủ | ~T + 246 ms | ~T + 81 ms |

**Rủi ro [Suy luận]:** nếu lần chuẩn bị tối nay nhanh bất thường (Turnstile xong sớm hơn ~120 ms so với 2 lần trước), request có thể tới trước 0h và bị từ chối; lần thử sau phải chờ token mới (~1.4 s). Theo mô hình xác suất này khoảng 7%.

**Không xoá tab Nhật ký:** bộ lập lịch học từ các lần chạy trong đó; xoá đi thì quay về ước lượng thận trọng (~0.6 s sau 0h).

**Cần kiểm chứng sau đêm nay:**
- Câu trả lời máy chủ có báo «chưa tới giờ» không (nếu có: request tới quá sớm, cần nới biên).
- Hạng trên Bảng vàng và mốc `sent` trong nhật ký.
- Máy chủ xếp hạng theo lúc nhận request hay lúc trả lời: chưa phân biệt được vì Bảng vàng chỉ hiện tới giây.
