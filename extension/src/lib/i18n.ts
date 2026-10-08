export type Language = "en" | "vi";

export const I18N = {
  en: {
    // Popup Header & General
    appName: "DealHunter Assistant",
    appSubtitle: "Shopee voucher sniper",
    webApp: "Web app",
    accountConnected: (email?: string) =>
      `Connected to DealHunter${email ? `: ${email}` : ""}. Tracked prices appear on Shopee product pages.`,
    accountNotConnected:
      "Not signed in to DealHunter web: deal hunting features still work.",
    signInLink: "Sign in",
    signInSuffix: "to view price tracking directly on Shopee.",
    footerSafety: "Runs in your browser with your own Shopee account.",

    // Tabs & Navigation
    tabLiveSniper: "Live Sniper",
    tabSchedule: "Schedule",
    tabTasks: (count: number) => `My Hunts (${count})`,

    // Live Sniper Tab
    liveSniperBadge: "REAL-TIME READY",
    startOnActiveTab: "START SNIPER ON THIS PAGE",
    openShopeeAndStart: "OPEN SHOPEE & START SNIPER",
    pageActive: (domain: string) => `${domain} active`,
    notOnPage: "No active webpage",
    shopeeTabActive: "Shopee page active",
    notOnShopeeTab: "Shopee not open",
    launchHint: "Opens the in-page Sniper HUD with live millisecond clock & target button picker.",
    nextDropLabel: "Next drop in",
    clockLatency: "Shopee NTP sync",

    // Time Offset Card
    clockSyncTitle: "Clock sync",
    neverSynced: "Never synced",
    syncedJustNow: "Synced just now",
    syncedMinAgo: (min: number) => `Synced ${min} min ago`,
    syncing: "Syncing",
    resync: "Re-sync",
    offsetVsShopee: "Offset vs. Shopee",
    notSynced: "Not synced",
    roundTrip: "Network round trip",

    // Schedule Form
    scheduleTitle: "Schedule a hunt",
    scheduleSubtitle: "Opens target page 60s early and clicks at the drop",
    fullyAutomatic: "Fully automatic",
    dropTimeLabel: "Drop time (Vietnam)",
    today: "Today",
    tomorrow: "Tomorrow",
    targetPageLabel: "Target page / URL",
    voucherHub: "Shopee Hub",
    superSale1010: "10.10 Sale",
    cartPage: "Cart",
    customUrl: "Custom URL",
    customUrlPlaceholder: "https://example.com/target-page",
    useCurrentTabUrl: "Use current page",
    targetMidnight: "Midnight 00:00",
    keywordLabel: "Voucher keyword",
    recommended: "recommended",
    keywordPlaceholder: "Text on the voucher card, e.g. 500k or 15%",
    keywordHint:
      "Without a keyword, only a voucher that opens exactly at the drop is clicked.",
    scheduleButton: (hour: string) => `Schedule ${hour}:00 hunt`,

    // Task List
    scheduledHunts: (count: number) => `Scheduled Hunts (${count})`,
    noTasks: "No scheduled hunts yet.",
    filterPrefix: "Filter:",
    deleteTaskTooltip: "Delete hunt",
    clicksLabel: (count: number) => `${count} click${count !== 1 ? "s" : ""}`,
    status: {
      pending: "Waiting for drop",
      running: "Hunting",
      completed: "Voucher saved",
      failed: "Could not save",
      cancelled: "Cancelled",
    },

    // Floating HUD
    hudSubtitle: (domain?: string) => domain ? `Sniper · ${domain}` : "Voucher Sniper · Shopee",
    shopeeServerTime: "Shopee server time",
    resyncClockTooltip: "Re-sync with Shopee's clock",
    syncingClock: "Syncing with Shopee's clock...",
    syncedClockSuccess: "Clock synced with Shopee.",
    syncedClockFailed: "Could not sync — check your connection.",
    notSyncedRetry: "Not synced · retry",
    nextFlashSale: "Next flash sale",
    nextMinute: "Next minute",
    dropIn: "Drop in",
    targetVoucher: "Target button / voucher",
    locked: "Locked",
    opensAtDrop: "Opens at drop",
    notPickedText:
      "Not picked — only a voucher that opens exactly at the drop will be clicked.",
    pickButton: "Pick button",
    pickingButton: "Click a button...",
    autoDetect: "Auto-detect",
    armSniper: "Arm sniper",
    disarm: "Disarm",
    testClick: "Send one test click",
    testClickTooltip: "Sends one real click — it saves the voucher if it is already open",
    testClickSuccess: "Sent 1 real test click to the locked button.",
    pickInstruction: "Hover any target button on this page and click it to lock.",
    targetLockedInstruction: "Target locked. Arm the sniper when ready.",
    foundButtonsCount: (count: number) =>
      `Found ${count} button(s); locked the first one — check the green outline.`,
    noButtonFound: "No clickable Save button on this page right now.",
    armedWaitingDrop: "Armed — waiting for the drop.",
    initialHUDPrompt: "Pick target button to click at drop time, then arm.",
    outcome: {
      saved: "Voucher saved — confirmed by the page",
      exhausted: "Voucher fully claimed (out of stock)",
      not_found: "No matching voucher button appeared",
      timeout: "Clicked, but the page never confirmed it — check your voucher wallet",
      cancelled: "Hunt cancelled",
    },

    // Price History Badge
    priceBadgeTitle: "DealHunter Intelligence",
    betterDealPrefix: "Better deal on",
    cheaperBy: (percent: number, price: string) =>
      `Cheaper by ${percent}% (Only ${price})`,
    onlyPrice: (price: string) => `Only ${price}`,
    recordedPrice: "DealHunter recorded price:",
    noDataYet: "No price data yet",
    viewHistoryWeb: "View price history on Web",
    notTrackingYet: "You are not tracking this product on DealHunter yet.",
    trackPriceNow: "Track price now",
  },

  vi: {
    // Popup Header & General
    appName: "DealHunter Assistant",
    appSubtitle: "Công cụ săn voucher Shopee",
    webApp: "Web app",
    accountConnected: (email?: string) =>
      `Đã kết nối DealHunter${email ? `: ${email}` : ""}. Giá theo dõi hiển thị trên trang sản phẩm Shopee.`,
    accountNotConnected:
      "Chưa đăng nhập DealHunter web: vẫn sử dụng được các tính năng săn deal.",
    signInLink: "Đăng nhập",
    signInSuffix: "để xem giá theo dõi ngay trên Shopee.",
    footerSafety: "Chạy trực tiếp trên trình duyệt bằng chính tài khoản Shopee của bạn.",

    // Tabs & Navigation
    tabLiveSniper: "Săn trực tiếp",
    tabSchedule: "Đặt lịch",
    tabTasks: (count: number) => `Lịch hẹn (${count})`,

    // Live Sniper Tab
    liveSniperBadge: "TRỰC CHIẾN",
    startOnActiveTab: "BẮT ĐẦU SĂN TRÊN TRANG NÀY",
    openShopeeAndStart: "MỞ SHOPEE & BẮT ĐẦU SĂN",
    pageActive: (domain: string) => `Đang mở ${domain}`,
    notOnPage: "Chưa mở trang web",
    shopeeTabActive: "Đang mở trang Shopee",
    notOnShopeeTab: "Chưa mở trang Shopee",
    launchHint: "Mở bảng Sniper HUD trên trang với đồng hồ mili-giây và con trỏ chọn nút.",
    nextDropLabel: "Đếm ngược giờ G",
    clockLatency: "Đồng bộ giờ Shopee",

    // Time Offset Card
    clockSyncTitle: "Đồng bộ đồng hồ",
    neverSynced: "Chưa đồng bộ",
    syncedJustNow: "Vừa đồng bộ xong",
    syncedMinAgo: (min: number) => `Đã đồng bộ ${min} phút trước`,
    syncing: "Đang đồng bộ",
    resync: "Đồng bộ lại",
    offsetVsShopee: "Độ lệch so với Shopee",
    notSynced: "Chưa đồng bộ",
    roundTrip: "Độ trễ mạng 2 chiều",

    // Schedule Form
    scheduleTitle: "Đặt lịch săn",
    scheduleSubtitle: "Mở trang đích trước 60 giây và tự động click đúng giờ",
    fullyAutomatic: "Hoàn toàn tự động",
    dropTimeLabel: "Khung giờ săn (Việt Nam)",
    today: "Hôm nay",
    tomorrow: "Ngày mai",
    targetPageLabel: "Trang đích / URL",
    voucherHub: "Shopee Hub",
    superSale1010: "Sale 10.10",
    cartPage: "Giỏ hàng",
    customUrl: "URL tùy chọn",
    customUrlPlaceholder: "https://trangweb.com/link-su-kien",
    useCurrentTabUrl: "Dùng link hiện tại",
    targetMidnight: "Nửa đêm 00:00",
    keywordLabel: "Từ khóa voucher",
    recommended: "khuyên dùng",
    keywordPlaceholder: "Chữ trên thẻ voucher, ví dụ: 500k hoặc 15%",
    keywordHint:
      "Nếu không điền từ khóa, hệ thống chỉ bấm voucher mở đúng vào giờ sale.",
    scheduleButton: (hour: string) => `Đặt lịch săn ${hour}:00`,

    // Task List
    scheduledHunts: (count: number) => `Lịch đã hẹn (${count})`,
    noTasks: "Chưa có lịch hẹn săn mã nào.",
    filterPrefix: "Lọc:",
    deleteTaskTooltip: "Xóa lịch hẹn",
    clicksLabel: (count: number) => `${count} lượt click`,
    status: {
      pending: "Chờ đến giờ",
      running: "Đang săn",
      completed: "Đã lưu mã",
      failed: "Không lưu được",
      cancelled: "Đã hủy",
    },

    // Floating HUD
    hudSubtitle: (domain?: string) => domain ? `Bắn tỉa · ${domain}` : "Săn Voucher Shopee",
    shopeeServerTime: "Giờ server Shopee",
    resyncClockTooltip: "Đồng bộ lại với giờ Shopee",
    syncingClock: "Đang đồng bộ với giờ Shopee...",
    syncedClockSuccess: "Đã đồng bộ với giờ Shopee.",
    syncedClockFailed: "Không thể đồng bộ — kiểm tra kết nối mạng.",
    notSyncedRetry: "Chưa đồng bộ · thử lại",
    nextFlashSale: "Flash sale tiếp theo",
    nextMinute: "Phút tiếp theo",
    dropIn: "Đếm ngược giờ G",
    targetVoucher: "Nút / Voucher mục tiêu",
    locked: "Đã khóa",
    opensAtDrop: "Mở vào giờ G",
    notPickedText:
      "Chưa chọn — sẽ bấm voucher mở đúng vào thời điểm diễn ra sale.",
    pickButton: "Chọn nút",
    pickingButton: "Bấm vào nút...",
    autoDetect: "Tự quét nút",
    armSniper: "Kích hoạt săn",
    disarm: "Hủy kích hoạt",
    testClick: "Bấm thử 1 phát click",
    testClickTooltip: "Gửi 1 click thật để kiểm tra — lưu mã nếu mã đã mở",
    testClickSuccess: "Đã gửi 1 lượt click thử nghiệm đến nút đã chọn.",
    pickInstruction: "Rê chuột vào nút cần click trên trang và bấm để khóa mục tiêu.",
    targetLockedInstruction: "Đã khóa mục tiêu. Bấm kích hoạt khi sẵn sàng.",
    foundButtonsCount: (count: number) =>
      `Tìm thấy ${count} nút; đã khóa nút đầu tiên — kiểm tra viền xanh lá.`,
    noButtonFound: "Không tìm thấy nút Lưu nào có thể bấm trên trang này.",
    armedWaitingDrop: "Đã kích hoạt — đang chờ giờ G.",
    initialHUDPrompt: "Chọn nút cần click đúng giờ, sau đó kích hoạt.",
    outcome: {
      saved: "Đã lưu voucher — trang web đã xác nhận",
      exhausted: "Voucher đã hết lượt",
      not_found: "Không tìm thấy nút voucher tương ứng",
      timeout: "Đã click nhưng trang chưa xác nhận — hãy kiểm tra ví voucher",
      cancelled: "Đã hủy săn",
    },

    // Price History Badge
    priceBadgeTitle: "DealHunter Intelligence",
    betterDealPrefix: "Giá tốt hơn trên",
    cheaperBy: (percent: number, price: string) =>
      `Rẻ hơn ${percent}% (Chỉ còn ${price})`,
    onlyPrice: (price: string) => `Chỉ còn ${price}`,
    recordedPrice: "Giá DealHunter ghi nhận:",
    noDataYet: "Chưa có dữ liệu giá",
    viewHistoryWeb: "Xem lịch sử giá trên Web",
    notTrackingYet: "Bạn chưa theo dõi sản phẩm này trên DealHunter.",
    trackPriceNow: "Theo dõi giá ngay",
  },
} as const;

export function getTranslation(lang: Language = "en") {
  return I18N[lang] || I18N.en;
}
