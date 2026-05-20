/** Dữ liệu mặc định (fallback seed) — khớp logic hardcode ban đầu */
module.exports.LEGACY_TIME_PACKAGES = [
  { name: "30 ngày", days: 30, price: 30000 },
  { name: "60 ngày", days: 60, price: 55000 },
  { name: "90 ngày", days: 90, price: 80000 },
  { name: "365 ngày", days: 365, price: 300000 },
];

module.exports.LEGACY_EXTRA_BY_DAYS = {
  30: 10000,
  60: 20000,
  90: 30000,
  365: 120000,
};

module.exports.LEGACY_SERVERS = [
  { name: "Bokken", value: "Bokken" },
  { name: "Shuriken", value: "Shuriken" },
  { name: "Kunai", value: "Kunai" },
  { name: "Tesen", value: "Tesen" },
  { name: "Katana", value: "Katana" },
  { name: "Tone", value: "Tone" },
];

/** Các gói cũ (free) — ẩn khỏi admin & user khi mở cấu hình */
module.exports.REMOVED_OPTION_CODES = ["upyen", "uplevel", "pkam"];

/** Mặc định: chỉ gói kiểu có phụ thu theo thời gian (admin chọn Miễn phí / Tính phí) */
module.exports.LEGACY_OPTIONS = [
  { name: "Up danh vọng", code: "updanhvong", type: "paid" },
  { name: "Quạt buff", code: "quatbuff", type: "paid" },
  { name: "Kích yên", code: "kichyen", type: "paid" },
];

module.exports.UPTHUE_TYPE_LABELS = {
  free: "Miễn phí",
  paid: "Tính phí",
};
