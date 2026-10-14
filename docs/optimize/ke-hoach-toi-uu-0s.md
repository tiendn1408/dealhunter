# Kế hoạch tối ưu điểm danh 0 giây (Caffiliate)

> **Phiên bản**: 2.0 · **Cập nhật**: 14-10-2026
> **Phạm vi**: `extension/` (Caffiliate adapter, main-world bridge, strike plan, nhật ký điểm danh)
> **Mục tiêu**: lượt điểm danh được máy chủ xử lý **ngay sau** 00:00:00, càng sát 0h càng tốt, và không tới trước 0h.
>
> Bản 1.0 (cùng ngày) đề xuất lấy trước và giữ token Turnstile. Đề xuất đó **không được triển khai** (xem mục 6). Bản này mô tả những gì đã làm thật trong code.

**Cách đọc các ghi chú:**

- **[Đã kiểm]**: đối chiếu được với nhật ký hoặc mã nguồn.
- **[Suy luận]**: rút ra từ số liệu nhưng chưa chứng minh trực tiếp.
- **[Chưa có dữ liệu]**: chưa có số liệu nào để khẳng định; cần đo thêm.

---

## 1. Dữ liệu đêm 13/10 → 14/10/2026

Ảnh chụp gốc (nhật ký và bảng vàng) đã được chép thành chữ dưới đây rồi xoá khỏi thư mục.

### 1.1. Bảng vàng điểm danh Caffiliate (14/10)

| Hạng | Tên | Giờ hiển thị | Thưởng sớm |
| :--- | :--- | :--- | :--- |
| 1 | HaHa | 00:00:00 | +3 xèng |
| 2 | Hậu | 00:00:00 | +2 xèng |
| 3 | THỐNG | 00:00:00 | +2 xèng |
| 4 | Tien Dang | 00:00:01 | trượt Top 3 (chỉ +1 xèng chuỗi) |

Tài khoản: chuỗi 13 ngày, 95 xèng. Bảng vàng chỉ hiển thị **đến giây**, nên không biết Top 1–3 tới máy chủ ở mili-giây nào.

### 1.2. Nhật ký điểm danh DealHunter (Cài đặt → Nhật ký điểm danh)

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
| 4 | 23:59:59.983 | Hàm | 1 ms | — | — |
| 5 | 00:00:00.000 | Hàm | 1 ms | — | — |
| 6 | 00:00:00.023 | Hàm | 1 ms | — | — |
| 7 | 00:00:00.045 | Hàm | 1 ms | — | — |
| 8 | 00:00:00.057 | Hàm | 1 ms | — | — |

Phản hồi của lần 1 về lúc khoảng 00:00:01.663 (01.477 + 186 ms).

---

## 2. Phân tích

### 2.1. Bắt đầu quá muộn vì chưa có số đo **[Đã kiểm]**

- Kế hoạch tính thời gian chuẩn bị $P = 0$ vì nhật ký chưa có mẫu nào (đêm đầu tiên có nhật ký), nên lần 1 chỉ bắt đầu ở T − 98 ms.
- Thực tế lần 1 chờ Turnstile 1434 ms, rồi thêm khoảng 137 ms (ký request…), nên request rời máy lúc 00:00:01.477.
- Đây không phải lỗi công thức. Công thức đúng, nhưng thiếu dữ liệu đầu vào.

### 2.2. Trang chỉ giải một thử thách Turnstile mỗi lúc **[Suy luận]**

- Lần 2–8 có «Turnstile 1 ms» nhưng không lần nào gửi request trong lúc lần 1 còn chờ token.
- Vậy rải 8 lần quanh 0h không giúp được gì khi thời gian nằm ở Turnstile: giờ tới máy chủ do lần 1 quyết định.
- **Cần kiểm chứng:** chưa xem được mã nguồn trang Caffiliate (`CheckInTurnstile.getToken`, `app.checkIn`). Kết luận chỉ dựa trên nhật ký của một đêm.

### 2.3. «Lần 2» và «Lần 3» là ghi nhầm **[Suy luận]**

- Cả hai cùng «gửi» lúc 00:00:01.674, chỉ 11 ms sau khi lần 1 có phản hồi (01.663).
- Rất có thể đó là các request GET trạng thái / bảng vàng mà trang tự gọi sau khi điểm danh xong. Bridge cũ gán *mọi* URL có chữ `check-in` cho các lần thử theo thứ tự.
- **Chưa chứng minh được:** bản cũ không ghi phương thức (GET/POST) nên không kiểm lại được đêm 13/10. Từ 14/10 bridge chỉ gán request POST (mục 4), nên nhật ký mới sẽ cho thấy rõ.

### 2.4. Thời gian máy chủ lớn hơn RTT/2 nhiều **[Suy luận]**

- Kế hoạch giả định 39 ms một chiều (RTT 78 ms đo lúc canh giờ), trong khi máy chủ mất 186 ms mới trả lời.
- Giả định hiện tại là máy chủ còn gọi Cloudflare `siteverify` để kiểm token trước khi ghi nhận, nên thời gian hiệu dụng từ lúc gửi tới lúc được ghi nhận ≈ 186 − 39 = 147 ms.
- **[Chưa có dữ liệu]:** không tách được bao nhiêu là mạng, bao nhiêu là xử lý của máy chủ.

### 2.5. Máy chủ lấy giờ điểm danh vào lúc nào? **[Chưa có dữ liệu]**

- Có thể máy chủ lấy giờ lúc nhận request, hoặc sau khi kiểm token xong.
- Kế hoạch đang giả định *sau khi kiểm token* (gần lúc trả lời). Nếu thực tế là lúc nhận request, kế hoạch đang bắt đầu sớm hơn cần khoảng 100 ms. Như vậy lượt điểm danh sẽ tới sát 0h hơn, đồng thời rủi ro tới trước 0h cũng cao hơn một chút.

### 2.6. Request tới trước 0h bị xử lý thế nào? **[Chưa có dữ liệu]**

- Giả định hiện tại: bị từ chối (tính là hôm qua, đã điểm danh rồi), và token Turnstile đã bị tiêu, nên lần kế phải giải thử thách mới (~1 giây).
- Chưa có đêm nào ghi lại phản hồi của một request tới trước 0h.
- Từ 14/10 nhật ký đã lưu **câu trả lời của máy chủ** (mục 7), nên khi xảy ra sẽ đọc được lý do.

### 2.7. Top 1–3 làm cách nào? **[Chưa có dữ liệu]**

- Bản 1.0 khẳng định họ «bắt buộc phải lấy trước token». Không có dữ liệu nào cho thấy điều đó.
- Một người bấm sớm khoảng 1,5 giây cũng được token và tới máy chủ ngay sau 0h.
- Bảng vàng chỉ hiển thị đến giây nên không so được mili-giây.

---

## 3. Mục tiêu và chỉ số

| Chỉ số | Đêm 13/10 | Mục tiêu | Ghi chú |
| :--- | :--- | :--- | :--- |
| Lúc request rời máy | 00:00:01.477 | khoảng 0h − thời gian máy chủ | |
| Lúc được máy chủ xử lý | ~00:00:01.6 | trong giây 00:00:00 | Đêm 14/10 dự kiến 00:00:00.395 ± 395 ms |
| Tỉ lệ lần 1 tới trước 0h | — | ≤ ~16% | 1σ an toàn; giảm khi số đo ổn định hơn |
| Thứ hạng | #4 | Top 3 | **Không đảm bảo**: phụ thuộc đối thủ, mục 2.7 |

---

## 4. Đã triển khai (14-10-2026)

| Thay đổi | Tệp |
| :--- | :--- |
| Chỉ gán request **POST** tới URL điểm danh cho lần thử, bỏ các GET trang tự gọi | `extension/public/caffiliate_bridge.js` |
| Mẫu «chuẩn bị» và «phản hồi» chỉ lấy từ **lần thử có request đi đầu tiên** của mỗi lần chạy (các lần sau đứng chờ sau token của nó) | `extension/src/lib/checkin_log.ts` (`prepSamplesFromLogs`, `serverSamplesFromLogs`) |
| Thời gian máy chủ $L$ học từ nhật ký: trung vị phản hồi 2xx − RTT/2, giới hạn [RTT/2, 1000 ms] | `extension/src/lib/strike_plan.ts` |
| Chế độ **chờ token** ($P \ge 300$ ms): lần 1 nhắm tới **sau** 0h một khoảng $1\sigma$, 4 lần sau là dự phòng cách nhau 20 ms | `extension/src/lib/strike_plan.ts` |
| Nhật ký lưu **câu trả lời của máy chủ** rút gọn cho mỗi lần thử (chỉ trường kiểu thông báo, ≤ 160 ký tự), hiện trong Cài đặt → Nhật ký điểm danh | `caffiliate_bridge.js`, `checkin_log.ts`, `CheckInLog.tsx` |
| Mẫu chỉ lấy từ nhật ký **của cùng trang** (host): lần chạy thử trên trình mô phỏng không làm lệch kế hoạch Caffiliate | `checkin_log.ts`, `caffiliate_adapter.ts` |
| Sửa báo **«Thành công» sớm**: lúc bắn, nút vẫn còn nhãn hôm qua «Đã điểm danh #N»; adapter giờ ghi lại nhãn đó lúc T − 3.5 s và chỉ tính xong khi nhãn đổi hoặc bridge xác nhận | `caffiliate_adapter.ts` |
| Test: kế hoạch theo số liệu đêm 13/10, lấy mẫu từ nhật ký, chỉ gán request POST, câu trả lời của máy chủ | `strike_plan.test.ts`, `checkin_log.test.ts`, `caffiliate_bridge.test.ts` |

### 4.1. Công thức

Lần thử bắt đầu lúc $s$ được máy chủ xử lý khoảng $s + P + L$:

- $P$: trung vị «bắt đầu → request rời máy» của 10 đêm gần nhất (lần đi đầu mỗi đêm).
- $L$: trung vị «request → phản hồi» trừ $RTT/2$.
- $\sigma = \max(10,\ \sqrt{(E/\sqrt3)^2 + J_P^2 + J_L^2})$, với $E$ là sai số canh giờ. $J_P$, $J_L$ = IQR/1.349 khi có ≥ 4 mẫu, nếu không thì 1/4 trung vị.
- Chờ token ($P \ge 300$ ms): $a_0 = \max(20,\ \sigma)$ sau 0h, $a_i = a_0 + 20i$, 5 lần.
- Không chờ token ($P < 300$ ms): giữ cách rải theo phân vị chuẩn quanh 0h như trước (vài lần ngay trước 0h, các lần sau ngay sau 0h).
- Bắt đầu: $s_i = a_i - P - L$, sớm nhất 3 s trước 0h.

Chi tiết đầy đủ: [`docs/extension/kien-truc-universal-sniper-va-state-machine.md`](../extension/kien-truc-universal-sniper-va-state-machine.md) mục 11.3.

### 4.2. Kế hoạch đêm 14/10 (từ số liệu đêm 13/10)

$P$ = 1571 ms, phản hồi 186 ms, RTT 78 ms → $L$ = 147 ms, $\sigma$ ≈ 395 ms:

```text
Kế hoạch: 5 lần từ T−1323ms · chuẩn bị ~1571ms · mạng ~147ms · ±395ms
Lần 1 bắt đầu 23:59:58.677 → dự kiến được xử lý 00:00:00.395 (±395 ms)
```

- Biên ±395 ms rộng vì mới có **1 mẫu** (độ dao động được ước tính bằng 1/4 trung vị). Từ 4 đêm trở đi, độ dao động tính từ số đo thật và biên sẽ tự hẹp lại.
- **[Chưa có dữ liệu]:** độ dao động thật của thời gian Turnstile giữa các đêm.

---

## 5. Đã có sẵn, không cần làm thêm

- **Chạy được khi tab bị ẩn:** `hunt_engine.ts` chỉ dùng `requestAnimationFrame` khi `!document.hidden`, ngược lại dùng `setTimeout`. `WorkerTimer` là nguồn nhịp chính.
- **Giữ ấm kết nối:** engine gửi `HEAD` cùng origin lúc T − 5 s (`keepalive`), adapter `preconnect` tới `challenges.cloudflare.com` lúc T − 3.5 s. API điểm danh cùng origin với trang nên không cần `OPTIONS`.

---

## 6. Không triển khai: lấy trước / giữ / trả token Turnstile từ bộ đệm

Bản 1.0 đề xuất:

- sinh token lúc T − 3.5 s, giữ trong bộ nhớ;
- bọc `CheckInTurnstile.getToken()` để trả token đó trong 0 ms;
- sự kiện `dh-caffiliate-prewarm`.

**Không làm**, vì:

- Turnstile là lớp chống bot của Caffiliate. Lấy token trước rồi phát lại vào lúc mình chọn là lách đúng thứ mà lớp đó kiểm tra.
- Lập luận «đối thủ bắt buộc phải lấy trước token» không có dữ liệu (mục 2.7).
- Các nhận định kỹ thuật đi kèm cũng **chưa được kiểm chứng**: token sống 300 s, máy chủ không kiểm thời điểm tạo token, các lần sau tự lấy token mới. Không có tài liệu hay số đo nào trong repo cho các điểm này.

Cách đã làm thay thế (mục 4) đạt cùng mục tiêu: bắt đầu lượt điểm danh của trang sớm đúng bằng thời gian Turnstile + máy chủ đã đo. Token vẫn được sinh ngay trong lượt điểm danh đó.

---

## 7. Cần xem / làm tiếp

- [ ] **Đêm 14/10:** chụp nhật ký và bảng vàng. So với dự kiến: lần 1 bắt đầu khoảng 23:59:58.6xx, được xử lý trong giây 00:00:00.
- [ ] **Xác nhận mục 2.2–2.3:** trong nhật ký mới, chỉ lần thử có request POST thật mới có giờ «gửi». Nếu lần 2+ cũng gửi POST thật thì trang không giải Turnstile tuần tự, và chế độ chờ token cần xem lại.
- [x] **Lưu câu trả lời của máy chủ** vào nhật ký (14-10-2026): mỗi lần thử có dòng «Máy chủ: «…»» (đỏ khi HTTP không phải 2xx). JSON chỉ giữ các trường kiểu thông báo (`success`, `message`, `rank`…), không lưu nguyên body; tối đa 160 ký tự. Dùng để trả lời mục 2.6 khi có đêm lần 1 tới trước 0h.
- [ ] **Sau ≥ 4 đêm:** xem $\sigma$ thu hẹp tới đâu và tỉ lệ lần 1 tới trước 0h. Nếu gần 0%, cân nhắc giảm biên an toàn (`SAFE_SIGMAS` trong `strike_plan.ts`); nếu cao, tăng lên.
- [ ] **Mục 2.5:** nếu nhiều đêm liền được xử lý ở 00:00:00.3–0.5 mà vẫn trượt Top 3, thử giả định máy chủ lấy giờ lúc *nhận* request (giảm $L$ về khoảng RTT/2). Chỉ đổi khi có số liệu.

---

## 8. Cách kiểm chứng

1. Reload extension (`chrome://extensions`), F5 tab Caffiliate, để tab mở qua 0h.
2. Sau 00:00:05, mở popup → Cài đặt → **Nhật ký điểm danh**:
   - dòng kế hoạch: `5 lần từ T−…ms · chuẩn bị ~…ms · mạng ~…ms · ±…ms`;
   - lần 1: giờ bắt đầu, thời gian Turnstile, giờ gửi, thời gian máy chủ và dòng «Máy chủ: «…»» (câu trả lời).
3. So với **Bảng vàng điểm danh** trên Caffiliate: giờ hiển thị và thứ hạng.
4. Ghi số liệu của đêm vào mục 1 của tài liệu này (dạng bảng, không cần lưu ảnh).
