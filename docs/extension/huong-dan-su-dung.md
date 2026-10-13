# DealHunter — Hướng dẫn sử dụng

DealHunter là tiện ích (extension) cho trình duyệt Chrome. Bạn chọn một nút trên trang web (ví dụ nút «Lưu» voucher, nút «Điểm danh»), chọn giờ, rồi DealHunter **tự bấm nút đó đúng giờ** giúp bạn.

Bạn không cần biết kỹ thuật. Không có thông số nào phải chỉnh: DealHunter tự đo giờ và tốc độ trang.

**Hai điều cần nhớ:**

- DealHunter **chỉ bấm đúng nút bạn đã chọn**. Nó không tự ý bấm nút khác.
- Đến giờ săn, **máy tính phải bật và Chrome phải mở**.

---

## Mục lục

1. [Cài đặt](#1-cài-đặt)
2. [Săn trong 3 bước](#2-săn-trong-3-bước)
3. [Bảng săn trên trang](#3-bảng-săn-trên-trang)
4. [Hẹn giờ, sửa lịch, lặp mỗi ngày](#4-hẹn-giờ-sửa-lịch-lặp-mỗi-ngày)
5. [Tab «Lịch săn»](#5-tab-lịch-săn)
6. [Cài đặt](#6-cài-đặt)
7. [Điểm danh Caffiliate và «Nhật ký điểm danh»](#7-điểm-danh-caffiliate-và-nhật-ký-điểm-danh)
8. [Mẹo](#8-mẹo)
9. [Xử lý sự cố](#9-xử-lý-sự-cố)

---

## 1. Cài đặt

Hiện tại DealHunter được cài bằng tay từ một thư mục trên máy (chưa có trên Chrome Web Store).

1. Lấy thư mục `dist` của DealHunter (người phụ trách kỹ thuật sẽ gửi cho bạn, hoặc nằm ở `extension/dist` trong bộ mã nguồn).
2. Mở Chrome, gõ vào thanh địa chỉ: `chrome://extensions` rồi nhấn Enter.
3. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
4. Bấm **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục `dist`.
5. Bấm biểu tượng mảnh ghép trên thanh công cụ Chrome, rồi bấm hình ghim cạnh **DealHunter** để biểu tượng luôn hiện.

**Khi có bản mới:** chép đè thư mục `dist` mới, vào lại `chrome://extensions` và bấm nút tải lại (mũi tên vòng tròn) ở thẻ DealHunter. Sau đó tải lại các trang đang săn (xem [mục 9](#9-xử-lý-sự-cố)).

**Bản phát hành và bản dev:**

| Bản | Dùng cho | Cách nhận biết |
| --- | --- | --- |
| Bản phát hành | Người dùng bình thường. Chỉ kết nối với trang DealHunter chính thức. | Phần phiên bản trong Cài đặt không có chữ gì thêm. |
| Bản dev | Người làm kỹ thuật thử nghiệm trên máy. | Phần phiên bản ghi **(bản dev)**. |

Nếu bạn không làm kỹ thuật, hãy dùng bản phát hành.

---

## 2. Săn trong 3 bước

1. **Mở trang muốn săn.** Ví dụ trang voucher Shopee, trang điểm danh. Bấm biểu tượng DealHunter trên thanh công cụ.
2. **Chọn nút cần bấm.** Trong cửa sổ nhỏ của DealHunter, bấm **«Chọn nút»**. Bảng săn hiện ở góc dưới bên phải trang. Rê chuột lên trang: nút nào được viền là nút sẽ được chọn. Bấm vào nút bạn muốn săn.
3. **Chọn giờ và bắt đầu săn.** Trên bảng săn, chọn giờ (mặc định **«0:00»**, tức nửa đêm), rồi bấm **«Bắt đầu săn»**. Giữ trang mở là xong.

Cửa sổ nhỏ (khi bấm biểu tượng DealHunter) có hai tab:

- **«Trang này»**: nói về trang bạn đang mở.
  - Nếu chưa mở trang web nào, bạn thấy «Mở trang bạn muốn săn» và các nút mở nhanh Shopee, Lazada, Tiki, TikTok Shop.
  - Nếu đang ở một trang web, bạn thấy tiến độ 3 bước cho trang đó. Khi xong cả 3 bước, phần này thu gọn thành **«Đã xong 3 bước»**.
  - Dòng **«Nút: «...»»** cho biết nút đã chọn. Bên dưới là **«● Đang săn · còn ...»** (đang săn ngay trên trang) hoặc **«Săn lúc HH:mm · còn ...»** (đã hẹn giờ).
  - Nút chính là **«Chọn nút»** hoặc **«Mở bảng săn»**. Có thêm **«Chọn nút khác»**.
  - Dòng nhỏ **«Đã canh giờ»** hoặc **«Giờ máy tính»** cho biết DealHunter đang dùng giờ nào (xem [mục 3](#3-bảng-săn-trên-trang)).
  - Thẻ **«Lịch săn kế tiếp»** cho biết lần săn sắp tới ở trang khác. Bấm vào để xem tab «Lịch săn».
- **«Lịch săn»**: danh sách các lần săn đã hẹn (xem [mục 5](#5-tab-lịch-săn)).

---

## 3. Bảng săn trên trang

Bảng săn là khung nhỏ nổi ở góc dưới bên phải trang web.

- Bảng **tự hiện** trên trang voucher/deal của các sàn lớn (Shopee, Lazada, Tiki, TikTok, Sendo, AliExpress, Taobao) và trên trang bạn đã chọn nút hoặc đã hẹn giờ.
- Ở trang khác, bảng chỉ hiện khi bạn bấm biểu tượng DealHunter rồi bấm «Chọn nút» hoặc «Mở bảng săn».
- Kéo phần đầu bảng để di chuyển. Bấm nút thu nhỏ để bảng gọn thành một viên nhỏ (khi đang săn, viên này ghi «còn ...»); viên nhỏ cũng kéo đi được, bấm vào để mở lại. Bảng (và viên nhỏ) luôn bám vào góc màn hình gần chỗ bạn thả nhất, và nhớ vị trí đó cho các trang sau. Bấm nút đóng để tắt bảng.
- Bảng giữ nguyên kích thước khi bạn dùng, nên các nút không bị nhảy chỗ dưới chuột.

### Bước 1: «Nút muốn săn»

| Nút | Tác dụng |
| --- | --- |
| **«Chọn nút»** | Bật chế độ chọn. Rê chuột: nút dưới chuột có viền và nhãn. Bấm để chọn. Nhấn **Esc** hoặc chuột phải để thôi. Trong lúc chọn, nút này đổi thành **«Thôi chọn»**. |
| **«Gợi ý giúp tôi»** | DealHunter đoán nút bạn cần và viền **màu cam** để bạn xem. Nó **chưa chọn**. Bạn bấm **«Đúng rồi»** để chọn, **«Nút khác»** để xem gợi ý tiếp, hoặc **«Bỏ qua»**. |
| **«Đổi nút»** | Chọn lại nút khác. |

Sau khi chọn, bảng hiện tên nút trong dấu «» và dòng **«Đã nhớ cho trang này»**. DealHunter tự nhớ nút này, lần sau mở lại trang không cần chọn lại.

### Bước 2: «Giờ săn»

| Nút | Tác dụng |
| --- | --- |
| **«0:00»** | Săn lúc nửa đêm (mặc định). |
| **«Giờ khác»** | Ô giờ hiện ngay trong dòng «Săn lúc …» (bảng không đổi kích thước), giờ cũ được bôi đen sẵn: cứ gõ đè. Gõ kiểu nào cũng hiểu: `20` = 20:00:00, `20h30` hay `2030` = 20:30:00, `203015` = 20:30:15. Nhấn Enter hoặc bấm ra ngoài là xong. |
| **«Thử sau 10 giây»** | Săn thử sau 10 giây để kiểm tra trước. |

Bảng ghi rõ, ví dụ: **«Săn lúc 00:00:00 · còn 9 giờ 34 phút»**.

Dòng giờ bên dưới cho biết DealHunter dùng giờ nào:

- **«Đã canh giờ theo shopee.vn»** (tên trang thay đổi theo trang bạn săn): DealHunter đã đo giờ của chính trang đó. Đây là trường hợp tốt nhất.
- **«Dùng giờ máy tính (trang không báo giờ)»**: trang không cho biết giờ, nên DealHunter dùng đồng hồ máy tính. Bấm **«Thử lại»** để đo lại.

### Bước 3: Bắt đầu

| Nút | Tác dụng |
| --- | --- |
| **«Bắt đầu săn»** | Bắt đầu chờ tới giờ rồi bấm. Chỉ bấm được khi đã chọn nút. Bảng nhắc: «Giữ trang này mở là được.» |
| **«Hẹn giờ»** | Lưu thành lịch săn. Tới giờ DealHunter **tự mở trang** và săn, bạn không cần để trang mở sẵn. |
| **«Mỗi ngày»** | Công tắc đi kèm «Hẹn giờ»: bật lên để săn lại vào giờ này mỗi ngày. |

### Khi đang săn

Bảng hiện **«Đang chờ tới giờ»**, đồng hồ đếm ngược lớn, dòng **«Săn lúc ... · «tên nút»»** và nút **«Dừng săn»**.

Nếu trang tải lại trong lúc chờ, DealHunter vẫn tiếp tục săn.

Kết quả có thể là:

| Thông báo | Nghĩa |
| --- | --- |
| «Thành công, trang đã xác nhận» | Trang đã báo nhận (ví dụ voucher đã lưu). |
| «Đã hết lượt» | Voucher/deal đã hết. |
| «Tới giờ không thấy nút» | Đến giờ mà nút không có trên trang. |
| «Đã bấm, trang chưa xác nhận. Hãy kiểm tra lại.» | Đã bấm nhưng trang không báo gì. Hãy tự xem lại trên trang. |
| «Đã dừng» | Bạn đã dừng săn. |

### «Tuỳ chọn thêm»

Bấm «Tuỳ chọn thêm» để mở một khung nhỏ đè lên bảng. Bấm ra ngoài để đóng.

| Mục | Tác dụng |
| --- | --- |
| **«Tải lại trang trước giờ»** | Bật/tắt. Khi bật, DealHunter tải lại trang ngay trước giờ săn để nút mới nhất hiện ra. Thời điểm tải lại được tự canh theo tốc độ trang (bảng ghi «Tự canh, khoảng ... giây trước»). |
| **«Bấm thử»** | Bấm nút đã chọn **một lần thật** để kiểm tra đúng nút. Sau khi bấm, nút ghi «Đã bấm» kèm dấu tích. Lưu ý: đây là bấm thật trên trang. |
| **«Quên nút»** | Xoá nút đã nhớ cho trang này. |

---

## 4. Hẹn giờ, sửa lịch, lặp mỗi ngày

Hẹn giờ phù hợp khi bạn không muốn ngồi chờ, hoặc muốn săn mỗi ngày.

**Cách 1 — từ bảng săn trên trang:** chọn nút, chọn giờ, bật «Mỗi ngày» nếu cần, rồi bấm **«Hẹn giờ»**.

**Cách 2 — từ cửa sổ DealHunter:** vào tab «Lịch săn», bấm **«+ Hẹn giờ mới»**. Một khung trượt lên từ dưới:

| Mục | Tác dụng |
| --- | --- |
| **«Nút cần săn»** | Thẻ hiện nút đang chọn. Bấm **«Đổi»** để mở trang «Chọn nút cần săn»: chọn một nút đã lưu (mỗi nút gắn với một trang), hoặc ở phần **«Hoặc thêm nút mới»** chọn **«Chọn nút trên trang đang mở»** (khi trang đang mở chưa có nút) hay **«Nút ở trang khác (dán link trang)»** → dán link → **«Mở & chọn»**. DealHunter mở trang ở chế độ chọn nút; chọn xong, bấm «Hẹn giờ» trên bảng săn (hoặc mở lại khung này). Chưa có nút nào thì khung mở thẳng phần thêm nút mới. Đang **sửa** lịch cũng thêm nút mới được: chọn xong trên trang, mở lại lịch đó và chọn nút mới trong danh sách. Nút chỉ có biểu tượng (không chữ) được đặt tên theo nhãn của nút, hoặc «Nút đã chọn». |
| **«Chọn lại trên trang»** | DealHunter mở trang của nút đang chọn và bật chế độ chọn để bạn chọn lại nút. |
| **«Giờ săn»** | Bấm vào ô giờ rồi gõ đè (`20`, `20h30`, `2030`…), hoặc bấm nhanh `00:00`, `12:00`, `20:00`. Bên cạnh ghi «còn ...». |
| **«Lặp lại mỗi ngày»** | Săn lại vào giờ này mỗi ngày. |
| **«Tải lại trang trước giờ»** | Như trong bảng săn: tự canh theo tốc độ tải trang. |
| **«Hẹn săn lúc ...»** | Lưu lịch. Nút này luôn nằm ở đáy khung, không cần cuộn. |

**Sửa lịch:** trong tab «Lịch săn», bấm vào một lịch. Khung hiện ra với tiêu đề «Sửa lịch săn». Đổi xong bấm **«Lưu thay đổi»**.

**Xoá lịch:** bấm biểu tượng thùng rác ở lịch đó.

**Không bị trùng:** nếu bạn hẹn cùng một trang, cùng một giờ lần nữa, DealHunter cập nhật lịch cũ thay vì tạo thêm lịch mới.

**Tới giờ thì sao:** khoảng 1 phút trước giờ săn, DealHunter tự mở (hoặc chuyển sang) trang đó và chuẩn bị. Lỡ đóng trang cũng không sao. Máy tính chỉ cần bật và Chrome đang mở.

**Lặp mỗi ngày:** dù hôm nay thành công, không thành công hay bị lỡ, lịch vẫn tự chuyển sang ngày mai. Bấm «Dừng săn» chỉ bỏ qua hôm nay.

---

## 5. Tab «Lịch săn»

Tab này ghi số lịch, ví dụ «Lịch săn (3)». Lịch sắp tới ở trên, lịch đã xong ở dưới. Mỗi dòng ghi giờ, tên nút, trang, trạng thái, nhãn «Mỗi ngày» (nếu có), thời gian còn lại và kết quả lần trước.

| Trạng thái | Nghĩa |
| --- | --- |
| **Đang chờ** | Chưa tới giờ. DealHunter sẽ tự mở trang và săn. |
| **Đang săn** | Đang chạy trên trang. |
| **Thành công** | Trang đã xác nhận. |
| **Không thành công** | Đã thử nhưng không được (hết lượt, không thấy nút, hoặc trang không xác nhận). Xem dòng «Lần trước:» để biết lý do. |
| **Đã hủy** | Lịch đã bị dừng. |
| **Đã lỡ (máy tắt)** | Đến giờ mà máy tắt, ngủ, hoặc Chrome đóng, nên DealHunter không chạy kịp. |

---

## 6. Cài đặt

Bấm hình bánh răng ở góc trên cửa sổ DealHunter.

| Mục | Nội dung |
| --- | --- |
| **«Ngôn ngữ»** | Tiếng Việt hoặc English. Mặc định theo ngôn ngữ của trình duyệt. |
| **«Tài khoản DealHunter»** | Cho biết bạn đã đăng nhập chưa. Bạn đăng nhập trên trang web DealHunter, tiện ích tự nhận ra. |
| **«Nhật ký điểm danh»** | Xem lại các lần điểm danh Caffiliate (xem [mục 7](#7-điểm-danh-caffiliate-và-nhật-ký-điểm-danh)). |
| **«Dữ liệu trên máy này»** | Giờ và tốc độ tải trang DealHunter đã đo. Bấm **«Xoá số đo»** rồi xác nhận **«Xoá»** nếu muốn xoá. Xoá vẫn an toàn, lần sau DealHunter tự đo lại. |
| Phiên bản | Ví dụ «DealHunter Assistant 1.0.0». Bản dev có thêm «(bản dev)». |

---

## 7. Điểm danh Caffiliate và «Nhật ký điểm danh»

Trên trang Caffiliate (caffiliate.vn), DealHunter có cách săn riêng cho nút điểm danh:

- DealHunter **không tải lại trang** Caffiliate.
- Gần 00:00, DealHunter gửi vài lần thử (ít nhất 5) cách nhau rất ngắn, rải quanh đúng 00:00. Lần nào được trang xác nhận thì dừng ngay.
- Nếu trang hiện ô xác minh «Tôi không phải người máy», bảng săn sẽ nhắc: **«Trang cần xác minh: hãy tick vào ô trên trang.»** Hãy tick vào ô đó.

**«Nhật ký điểm danh»** (trong Cài đặt) ghi lại từng lần điểm danh:

- Kết quả: **«Đã điểm danh»** hoặc **«Chưa xác nhận»**. Lần bạn tự bấm tay được ghi là **«Bấm tay»**.
- Kế hoạch DealHunter đã dùng: thử mấy lần, bắt đầu sớm bao lâu, mạng mất khoảng bao lâu.
- Từng lần thử («Lần 1», «Lần 2»...): đã thử bằng cách nào («Hàm», «API» hoặc «Bấm nút»), gửi lúc nào, trang trả lời lúc nào.

Bạn không cần hiểu hết các con số này. Nhật ký giúp người hỗ trợ kỹ thuật biết chuyện gì đã xảy ra nếu điểm danh không được. DealHunter cũng dùng nhật ký này để tự canh thời gian tốt hơn cho lần sau. Bấm **«Xoá»** để xoá nhật ký.

---

## 8. Mẹo

- **Thử trước:** bấm **«Thử sau 10 giây»** để xem DealHunter bấm đúng nút chưa, trước giờ săn thật.
- **Đăng nhập trước:** đăng nhập vào trang (Shopee, Caffiliate...) trước giờ săn. DealHunter không đăng nhập giúp bạn.
- **Giữ máy thức:** tắt chế độ ngủ của máy trong đêm săn. Máy ngủ thì lịch sẽ thành «Đã lỡ (máy tắt)».
- **Dùng «Hẹn giờ» cho việc lặp lại:** ví dụ điểm danh mỗi ngày lúc 00:00, bật «Mỗi ngày» một lần là xong.
- **Một trang, một nút:** mỗi trang nhớ một nút. Muốn đổi, bấm «Đổi nút».
- **Nút «Mua ngay», «Thanh toán»:** «Gợi ý giúp tôi» không bao giờ gợi ý các nút này. Nếu bạn thật sự muốn săn chúng, hãy tự chọn.

---

## 9. Xử lý sự cố

| Vấn đề | Cách xử lý |
| --- | --- |
| **Bảng săn không hiện** | Bấm biểu tượng DealHunter rồi bấm «Chọn nút» hoặc «Mở bảng săn». Nếu vẫn không hiện, tải lại trang (F5) rồi thử lại. Trang `chrome://` và trang tab mới không dùng được. |
| **Bảng ghi «Dùng giờ máy tính (trang không báo giờ)»** | Trang không cho biết giờ. Bấm «Thử lại». Nếu vẫn vậy, DealHunter vẫn săn bình thường theo đồng hồ máy tính. Hãy đảm bảo giờ máy tính đúng (bật tự động đặt giờ trong cài đặt của máy). |
| **Trang hiện ô xác minh (Cloudflare, «Verify you are human»)** | Tick vào ô xác minh và đăng nhập trước giờ săn. DealHunter không tự vượt qua bước xác minh. |
| **Lịch ghi «Đã lỡ (máy tắt)»** | Đến giờ mà máy tắt, ngủ hoặc Chrome đóng. Lần sau giữ máy bật và Chrome mở. Lịch «Mỗi ngày» tự chuyển sang ngày mai. |
| **«Tới giờ không thấy nút»** | Trang đã đổi giao diện. Mở trang, bấm «Đổi nút» (hoặc «Chọn lại trên trang» trong khung Hẹn giờ) và chọn lại. |
| **Bảng săn biến mất sau khi cập nhật / tải lại DealHunter** | Bình thường: bảng cũ trên các tab đang mở tự đóng. Bấm biểu tượng DealHunter để mở lại, hoặc tải lại trang (F5). Lượt săn đang chờ vẫn tiếp tục sau khi tải lại trang. |
| **«Đã bấm, trang chưa xác nhận»** | Tự xem trên trang đã được chưa (ví dụ trong ví voucher). |
| **«Gợi ý giúp tôi» không gợi ý được** | Hãy tự bấm «Chọn nút» và chọn. |
| **Vừa cập nhật hoặc tải lại DealHunter** | Tải lại (F5) các trang đang mở mà bạn muốn săn. Bảng săn cũ trên trang sẽ được thay bằng bảng mới. Lịch đã hẹn vẫn còn, không cần hẹn lại. |

---

Xem thêm (dành cho người làm kỹ thuật): [README của extension](../../extension/README.md).
