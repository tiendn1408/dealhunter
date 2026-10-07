# DealHunter Assistant — Hướng Dẫn Sử Dụng

> Tiện ích Chrome giúp **tự động bấm "Lưu" voucher Shopee đúng giờ mở mã** (0h, 9h, 12h, 15h, 18h, 21h — giờ Việt Nam), chạy ngay trên trình duyệt và tài khoản Shopee của bạn.
>
> Cập nhật: 2026-10-07 · Áp dụng cho bản build trong `extension/dist`.

---

## Mục lục

1. [Tiện ích làm được gì (và không làm gì)](#1-tiện-ích-làm-được-gì-và-không-làm-gì)
2. [Cài đặt](#2-cài-đặt)
3. [Chuẩn bị trước mỗi khung giờ săn](#3-chuẩn-bị-trước-mỗi-khung-giờ-săn)
4. [Đồng bộ đồng hồ Shopee](#4-đồng-bộ-đồng-hồ-shopee)
5. [Chế độ 1 — Bán tự động (ngồi trước máy)](#5-chế-độ-1--bán-tự-động-ngồi-trước-máy)
6. [Chế độ 2 — Tự động 100% (hẹn giờ trước)](#6-chế-độ-2--tự-động-100-hẹn-giờ-trước)
7. [Tiện ích chọn voucher nào để bấm?](#7-tiện-ích-chọn-voucher-nào-để-bấm)
8. [Đọc kết quả](#8-đọc-kết-quả)
9. [Kịch bản mẫu: săn 21:00 và 00:00 trong cùng một tối](#9-kịch-bản-mẫu-săn-2100-và-0000-trong-cùng-một-tối)
10. [Xử lý sự cố](#10-xử-lý-sự-cố)
11. [Giới hạn và rủi ro](#11-giới-hạn-và-rủi-ro)
12. [Dành cho nhà phát triển](#12-dành-cho-nhà-phát-triển)

---

## 1. Tiện ích làm được gì (và không làm gì)

**Làm được**
- Đo độ lệch giữa đồng hồ máy bạn và đồng hồ máy chủ Shopee, chính xác tới vài chục mili-giây.
- Bấm nút "Lưu" của voucher bạn chọn **bắt đầu 150ms trước giờ G**, mỗi 35ms, trong tối đa 3 giây sau giờ G — nhanh hơn bấm tay.
- Hẹn giờ trước: tự mở tab Shopee 60 giây trước giờ G và tự bấm, không cần ngồi canh.
- Báo kết quả **đúng như trang Shopee hiển thị**: đã lưu, hết lượt, không thấy nút, hoặc chưa xác nhận được.

**Không làm**
- Không đăng nhập Shopee hộ bạn, không vượt captcha hộ bạn.
- Không đảm bảo giật được mã: voucher hot có thể hết trong chưa tới 1 giây, và Shopee có thể từ chối lượt lưu.
- Không bao giờ tự báo "thành công" khi trang chưa hiện "Đã lưu".
- Hiện **chưa** gửi dữ liệu voucher về DealHunter và **chưa** hiển thị huy hiệu so sánh giá trên trang sản phẩm (đang phát triển — xem [mục 11](#11-giới-hạn-và-rủi-ro)).

---

## 2. Cài đặt

### 2.1. Build (chỉ cần khi có bản cập nhật mã nguồn)
```bash
cd /Users/tien.dang/Workplace/reference/dealhunter/extension
npm install
npm run build
```
Kết quả nằm trong thư mục `extension/dist`.

### 2.2. Nạp vào Chrome (Chrome / Edge / Cốc Cốc / Brave)
1. Mở `chrome://extensions` (Edge: `edge://extensions`, Cốc Cốc: `coccoc://extensions`).
2. Bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked** → chọn thư mục `.../dealhunter/extension/dist`.
4. Bấm biểu tượng mảnh ghép trên thanh công cụ → **ghim (pin)** "DealHunter Assistant" để mở popup nhanh.

### 2.3. Sau mỗi lần build lại
Vào `chrome://extensions` → bấm nút **Reload** (mũi tên vòng) trên thẻ DealHunter Assistant, rồi **tải lại các tab Shopee đang mở** (F5). Tab mở trước khi reload vẫn chạy bản cũ.

---

## 3. Chuẩn bị trước mỗi khung giờ săn

Làm trước giờ G ít nhất **5–10 phút**:

| | Việc cần làm | Vì sao |
|---|---|---|
| ☐ | **Đăng nhập Shopee** trên chính trình duyệt có cài tiện ích | Chưa đăng nhập thì không lưu được voucher |
| ☐ | Mở thử `https://shopee.vn/m/ma-giam-gia` một lần; nếu Shopee hỏi captcha/xác minh thì làm xong | Ở chế độ tự động, nếu Shopee đẩy sang trang xác minh thì tiện ích chỉ báo lỗi, không vượt được |
| ☐ | Kiểm tra **đồng bộ đồng hồ** hiện `+…ms ±…ms` (xem [mục 4](#4-đồng-bộ-đồng-hồ-shopee)) | Sai lệch đồng hồ làm bấm sớm/muộn |
| ☐ | **Tắt chế độ ngủ** của máy, cắm sạc; để Chrome mở | Máy ngủ thì hẹn giờ không chạy |
| ☐ | Mạng ổn định (ưu tiên mạng dây / Wi-Fi mạnh) | Click gửi đi trễ = mất lượt |
| ☐ | **Chạy thử một lần với "Phut Toi"** (xem [mục 5](#5-chế-độ-1--bán-tự-động-ngồi-trước-máy)) | Xác nhận tiện ích nhận đúng nút trên trang thật |

---

## 4. Đồng bộ đồng hồ Shopee

Đồng hồ máy tính thường lệch vài trăm mili-giây so với giờ chuẩn (máy thử nghiệm của dự án lệch ~0,37 giây). Tiện ích đo độ lệch bằng cách bắt đúng khoảnh khắc đồng hồ máy chủ Shopee nhảy sang giây mới, rồi dùng **giờ Shopee** để tính giờ G.

Bạn xem kết quả ở hai nơi:
- **Popup** (bấm biểu tượng tiện ích) → thẻ **"Dong Bo Gio Shopee"**: *Do lech dong ho* và *Do tre mang (RTT)*. Nút **"Do lai"** để đo lại.
- **HUD** trên trang Shopee → dòng **"Gio Shopee Server"**; bấm vào dòng độ lệch để đo lại.

| Hiển thị | Ý nghĩa | Làm gì |
|---|---|---|
| `+365ms ±40ms` | Đồng hồ Shopee nhanh hơn máy bạn 365ms, sai số khoảng ±40ms | Bình thường, có thể săn |
| Sai số lớn (vd. `±200ms` trở lên) | Mạng chậm/không ổn định | Đổi mạng tốt hơn rồi đo lại |
| **Chua dong bo** / **CHUA DONG BO** | Chưa đo được (mất mạng, Shopee chặn tạm thời) | Bấm đo lại; nếu vẫn lỗi, kiểm tra đã mở được shopee.vn chưa |

Tiện ích tự đo lại khi kết quả cũ quá 10 phút, và đo lại ngay trước giờ G ở chế độ tự động.

> **Giờ G luôn là giờ Việt Nam (GMT+7)**, kể cả khi máy bạn đặt múi giờ khác.

---

## 5. Chế độ 1 — Bán tự động (ngồi trước máy)

Dùng khi bạn ngồi trước máy lúc giờ G và muốn tự chọn đúng voucher.

### Bước 1 — Mở trang voucher
Mở trang Shopee có voucher cần săn, ví dụ:
- Hub mã giảm giá: `https://shopee.vn/m/ma-giam-gia`
- Trang chiến dịch: `https://shopee.vn/m/10-10`, `https://shopee.vn/m/11-11`, ...
- Giỏ hàng: `https://shopee.vn/cart`

Bảng điều khiển **DealHunter Assistant (HUD)** hiện ở **góc dưới bên phải** trên mọi trang `shopee.vn/m/...` và `shopee.vn/cart`. Có thể thu nhỏ (chỉ còn đồng hồ) hoặc đóng.

### Bước 2 — Chọn giờ G
- **"Gio Vang"**: khung giờ vàng kế tiếp (0h, 9h, 12h, 15h, 18h, 21h).
- **"Phut Toi"**: đầu phút kế tiếp — dùng để **chạy thử** trước giờ thật.

Dòng **"Muc tieu"** cho biết giờ G, **"Dem nguoc"** cho biết còn bao lâu.

### Bước 3 — Chọn voucher
- **"Tro Chon Nut"** (khuyên dùng): bấm nút này, rê chuột lên nút **"Lưu"** của voucher muốn săn (viền xanh sáng lên) rồi **bấm vào nút "Lưu"** đó. Khóa được cả khi nút đang mờ/chưa bấm được trước giờ G; lần bấm này **không** lưu voucher. Dòng trạng thái báo *"Da khoa nut muc tieu"*.
- **"Tu Tim Nut"**: tiện ích tự khóa nút "Lưu" **đầu tiên đang bấm được** trên trang. Kiểm tra lại viền xanh có nằm đúng voucher bạn muốn không — nếu không, dùng "Tro Chon Nut".

### Bước 4 — Bật săn
Bấm **"BAT SAN MA (SEMI-AUTO)"**. Nút đổi thành **"TAT SAN MA (DANG SAN SANG)"** và dòng trạng thái đếm *"Cho gio G: con …s"*. Cứ để nguyên tab (có thể chuyển sang tab/cửa sổ khác — bộ đếm vẫn chạy).

Đúng giờ G tiện ích tự bấm; dòng trạng thái hiện *"Dang luu ma... N click"* rồi kết quả cuối (xem [mục 8](#8-đọc-kết-quả)).

Muốn hủy trước giờ G: bấm **"TAT SAN MA"**.

### Nút "Click thu nghiem 1 cham"
Gửi **một click thật** vào nút đã khóa (hoặc tự tìm nút nếu chưa khóa) — để kiểm tra tiện ích bấm được nút. Lưu ý: nếu voucher đang mở, click này **lưu voucher thật**.

### Chạy thử trước giờ thật (khuyên làm)
1. Mở trang voucher, chọn **"Phut Toi"**.
2. Khóa một voucher bất kỳ đang mở bằng **"Tro Chon Nut"**, bấm **"BAT SAN MA"**.
3. Đầu phút kế tiếp tiện ích bấm voucher đó; kết quả phải là **"DA LUU MA (trang xac nhan)"** (hoặc "het luot" nếu voucher hết). Nếu báo khác, xem [mục 10](#10-xử-lý-sự-cố).

---

## 6. Chế độ 2 — Tự động 100% (hẹn giờ trước)

Dùng khi bạn không ngồi canh được (ví dụ đi ngủ trước 0h).

### Đặt lịch
1. Bấm biểu tượng tiện ích → mục **"Hen Gio San Voucher"** (nhãn **"Tu dong 100%"**).
2. **"Khung gio san ma"**: chọn 0h, 9h, 12h, 15h, 18h hoặc 21h. Lịch chạy ở **lần kế tiếp** của khung giờ đó (giờ Việt Nam); nếu giờ đó hôm nay đã qua thì là ngày mai.
3. **"Trang Shopee muc tieu"**: chọn một trong ba trang có sẵn — Hub Mã Giảm Giá (`shopee.vn/m/ma-giam-gia`), Siêu Sale 10/10 (`shopee.vn/m/10-10`) hoặc Giỏ Hàng (`shopee.vn/cart`). Voucher ở trang khác thì dùng chế độ bán tự động (mục 5).
4. **"Tu khoa voucher"** (rất nên điền): một đoạn chữ nằm trên thẻ voucher cần săn, ví dụ `500k`, `15%`, `freeship`. Tiện ích chỉ bấm voucher có thẻ chứa từ khóa này.
5. Bấm **"Dat Lich San Ma …h00"**. Lịch xuất hiện trong danh sách bên dưới với trạng thái **"Cho den gio"**.

### Điều gì xảy ra lúc chạy
1. **Trước giờ G 60 giây**: tiện ích đo lại đồng hồ Shopee, mở tab mới tới trang mục tiêu (trạng thái **"Dang san"**).
2. Tab tải xong: tiện ích tìm voucher theo từ khóa và chờ.
3. **Giờ G**: bấm như chế độ bán tự động, rồi ghi kết quả vào lịch.

### Theo dõi kết quả
Mở lại popup. Mỗi lịch hiện trạng thái và lý do:

| Trạng thái | Ý nghĩa |
|---|---|
| **Cho den gio** | Chưa tới giờ |
| **Dang san** | Đã mở tab, đang chờ/bấm |
| **Da luu ma** | Trang Shopee đã hiện voucher được lưu |
| **Khong luu duoc** | Không lưu được; dòng bên dưới ghi lý do (hết lượt, không thấy nút, Shopee yêu cầu xác minh, chưa đăng nhập, ...) và số click đã gửi |
| **Da huy** | Bạn đã xóa lịch |

- Mỗi lịch **chạy một lần**. Muốn săn khung giờ khác, tạo lịch mới.
- Bấm biểu tượng thùng rác để **xóa** lịch (cũng hủy hẹn giờ nếu chưa chạy).

---

## 7. Tiện ích chọn voucher nào để bấm?

Quy tắc áp dụng cho cả hai chế độ:

| Bạn đã... | Tiện ích bấm |
|---|---|
| **Khóa một voucher** ("Tro Chon Nut" / "Tu Tim Nut") | **Chỉ** voucher đó. Nếu lúc mở mã Shopee vẽ lại thẻ (nút mới), tiện ích vẫn nhận ra đúng thẻ nhờ các con số trên thẻ (50k, 500k, 15%...). Nếu thẻ biến mất thì **không bấm gì** và báo không tìm thấy — **không bao giờ chuyển sang bấm voucher khác**. |
| **Điền từ khóa** (chế độ tự động) | Voucher đầu tiên có thẻ chứa từ khóa và đang bấm được. |
| **Không khóa, không từ khóa** | Chỉ voucher **mở ra đúng giờ G**; bỏ qua mọi voucher đã bấm được từ trước. |

Giới hạn an toàn: bắt đầu 150ms trước giờ G, mỗi 35ms một click, tối đa 80 click, dừng ngay khi trang hiện "Đã lưu", "Dùng ngay", "Hết lượt", "Đã hết"..., và dừng hẳn sau 3 giây kể từ giờ G.

---

## 8. Đọc kết quả

Kết quả luôn dựa trên chữ hiển thị trên nút/thẻ voucher của Shopee:

| Kết quả hiển thị | Nghĩa | Nên làm |
|---|---|---|
| **DA LUU MA (trang xac nhan)** | Nút đã chuyển sang "Đã lưu" / "Dùng ngay" / "Đã nhận" | Vào ví voucher dùng mã |
| **Voucher da het luot** | Trang hiện "Hết lượt" / "Đã hết" / "Hết mã" | Thử khung giờ sau |
| **Khong thay nut voucher trong khung gio** | Không có nút "Lưu" phù hợp trong 3 giây sau giờ G | Kiểm tra trang mục tiêu, từ khóa; voucher có thể nằm ở trang khác |
| **Da click nhung trang chua xac nhan da luu** | Đã bấm nhưng nút không đổi trạng thái | **Mở ví voucher để kiểm tra** — có thể đã lưu nhưng trang hiển thị khác, hoặc Shopee từ chối |
| **Shopee chuyen sang trang xac minh (captcha)** | (Tự động) Tab bị đưa sang trang xác minh | Lần sau xác minh trước giờ G (mục 3) |
| **Chua dang nhap Shopee tren trinh duyet nay** | (Tự động) Tab bị đưa sang trang đăng nhập | Đăng nhập rồi đặt lịch lại |
| **Da tam dung** | Bạn đã tắt săn | — |

Số trong ngoặc là số click đã gửi.

---

## 9. Kịch bản mẫu: săn 21:00 và 00:00 trong cùng một tối

1. **20:45** — Đăng nhập Shopee, mở `shopee.vn/m/ma-giam-gia`, vượt xác minh nếu có. Kiểm tra đồng bộ đồng hồ có `±` nhỏ.
2. **20:50** — Chạy thử với **"Phut Toi"** trên một voucher bất kỳ (mục 5). Phải ra "DA LUU MA".
3. **20:55** — Chọn **"Gio Vang"** (giờ G hiện 21:00:00), **"Tro Chon Nut"** vào voucher muốn săn, bấm **"BAT SAN MA"**.
4. **21:00** — Xem kết quả trên HUD.
5. **Trước khi ngủ** — Mở popup, đặt lịch **0h** với trang mục tiêu và **từ khóa** của voucher muốn săn. Nếu muốn săn nhiều voucher, tạo nhiều lịch với từ khóa khác nhau. Để máy không ngủ, Chrome mở.
6. **Sáng hôm sau** — Mở popup xem trạng thái lịch 0h và lý do nếu không lưu được.

---

## 10. Xử lý sự cố

**HUD không hiện trên trang Shopee**
- HUD chỉ hiện trên trang `shopee.vn/m/...` và `shopee.vn/cart`.
- Vừa cài/reload tiện ích? Tải lại tab (F5).
- Kiểm tra tiện ích đang bật ở `chrome://extensions`.

**Đồng hồ báo "Chua dong bo"**
- Bấm đo lại. Nếu vẫn lỗi: mở `https://shopee.vn` xem có vào được không (mất mạng, VPN, Shopee chặn tạm thời).

**"Tu Tim Nut" báo không tìm thấy nút**
- Trang chưa có voucher bấm được (chưa tới giờ, đã lưu hết) hoặc Shopee dùng chữ khác "Lưu"/"Thu thập"/"Nhận". Dùng "Tro Chon Nut" để chọn tay; nếu vẫn không được, ghi lại chữ trên nút và báo cho nhóm phát triển.

**Kết quả "Khong thay nut voucher" ở chế độ tự động**
- Từ khóa không khớp chữ trên thẻ (thử từ khóa ngắn hơn, ví dụ `500k` thay vì `Giảm 500k`).
- Voucher nằm ở trang khác trang mục tiêu.

**Tab tự động mở ra trang xác minh / đăng nhập**
- Làm bước chuẩn bị ở mục 3 trước giờ G.

**Lịch tự động không chạy**
- Máy ngủ hoặc Chrome đóng lúc tới giờ. Chrome chỉ chạy hẹn giờ khi đang mở.
- Mở popup kiểm tra lịch còn trong danh sách và trạng thái.

**Máy đặt múi giờ khác Việt Nam**
- Không sao: giờ G luôn tính theo giờ Việt Nam.

---

## 11. Giới hạn và rủi ro

- **Điều khoản Shopee**: tự động bấm có thể bị Shopee xem là vi phạm điều khoản sử dụng; tài khoản có thể bị hạn chế. Bạn tự cân nhắc khi sử dụng.
- **Đã kiểm thử** trên Chrome thật với trang voucher mô phỏng (bấm trúng sau 23–30ms kể từ khi mã mở, theo đúng nút bị vẽ lại, không bấm nhầm voucher khác) và đo đồng hồ với máy chủ Shopee thật; **chưa** kiểm thử trên trang Shopee thật khi đã đăng nhập. Hãy chạy thử với "Phut Toi" trước mỗi đợt săn quan trọng.
- Tiện ích nhận nút theo chữ hiển thị ("Lưu", "Lưu mã", "Thu thập", "Nhận", "Áp dụng"...). Nếu Shopee đổi chữ, cần cập nhật tiện ích.
- **Đang phát triển**: đọc voucher thật trên trang sản phẩm và gửi về DealHunter; huy hiệu lịch sử giá/so sánh giá trên trang sản phẩm (cần kết nối tiện ích với tài khoản DealHunter).

---

## 12. Dành cho nhà phát triển

- Mã nguồn: `extension/src` (README kỹ thuật: `extension/README.md`; thiết kế: `docs/plans/chrome-extension-assistant-and-fast-clicker.md`).
- Kiểm thử đơn vị: `cd extension && npm test` (đồng hồ, máy săn mã, nhận diện nút, giờ Việt Nam).
- Kiểm thử E2E trên Chrome thật với tiện ích đã build: `extension/e2e/README.md`.
