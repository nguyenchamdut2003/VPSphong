var db = require("./db.model");
const mongoose = require("mongoose");

/** Loại VPS (VPS Việt, VPS ngoại, …) — admin thêm / quản lý */
const tb_vps_category = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    isHidden: { type: Boolean, default: false },
  },
  {
    collection: "vps_categories",
    timestamps: true,
  },
);

/**
 * Một dòng = một máy VPS nhập tay (IP + mật khẩu mã hóa AES trên server).
 * isSold=true sau khi khách mua; vẫn giữ bản ghi để gia hạn / audit.
 */
const tb_vps = new mongoose.Schema(
  {
    name: { type: String, required: true },
    /** Mã hiển thị: #vpsphong + saleCode */
    saleCode: { type: Number, unique: true, sparse: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "vps_categories" },
    /** Treo game / VPS trắng / Datacenter — lọc trên trang chủ & sidebar khách */
    productKind: {
      type: String,
      enum: ["game", "blank", "datacenter"],
      default: "blank",
    },
    description: { type: String, default: "" },
    ipLocation: { type: String, default: "Singapore" },
    features: [{ type: String }],
    cpu: { type: Number, required: true },
    ram: { type: Number, required: true },
    disk: { type: Number, required: true },
    bandwidth: { type: Number },
    price: { type: Number, required: true },
    billingCycleDays: { type: Number, default: 30, min: 1 },
    status: { type: Boolean, default: true },
    isSold: { type: Boolean, default: false },

    serverIp: { type: String, default: "", trim: true },
    serverUsername: { type: String, default: "root", trim: true },
    /** Mật khẩu root/SSH — lưu ciphertext AES-256-GCM (utils/vpsCrypto) */
    passwordEnc: { type: String, default: "" },

    /** Chu kỳ thuê lần đầu: theo số ngày hoặc đến một ngày cố định */
    durationKind: { type: String, enum: ["days", "until_date"], default: "days" },
    initialRentDays: { type: Number, default: 30, min: 1 },
    rentValidUntil: { type: Date },
  },
  {
    collection: "vps",
    timestamps: true,
  },
);
tb_vps.index({ status: 1, isSold: 1 });
tb_vps.index({ categoryId: 1 });

const tb_user = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["admin", "customer"], default: "customer" },
    balance: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    collection: "users",
    timestamps: true,
  },
);

/**
 * Giao dịch: nạp tiền (deposit) không cần userVpsId;
 * mua (payment) / gia hạn (renew) gắn userVpsId để thanh toán đúng VPS.
 */
const tb_transaction = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true },
    userVpsId: { type: mongoose.Schema.Types.ObjectId, ref: "user_vps" },
    /** Snapshot gói catalog tại thời điểm giao dịch (audit) */
    vpsPlanId: { type: mongoose.Schema.Types.ObjectId, ref: "vps" },
    amount: { type: Number, required: true },
    type: {
      type: String,
      enum: ["deposit", "payment", "renew"],
      required: true,
    },
    description: String,
    status: { type: String, enum: ["pending", "success", "failed", "cancelled"], default: "pending" },
    voucherId: { type: mongoose.Schema.Types.ObjectId, ref: "vouchers" },
    /** Giá gốc gói trước giảm (khi dùng voucher) */
    originalAmount: { type: Number },
    discountAmount: { type: Number, default: 0 },
    /** Mã đơn số tăng dần toàn hệ thống (nạp / mua / gia hạn) */
    orderNumber: { type: Number, sparse: true, unique: true },
  },
  {
    collection: "transactions",
    timestamps: true,
  },
);
tb_transaction.index({ userId: 1, createdAt: -1 });
tb_transaction.index({ userVpsId: 1, createdAt: -1 });

/** Bộ đếm mã đơn (atomic) */
const tb_counter = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { collection: "counters" },
);

/** VPS đã bán / đang thuê của khách; autoRenew + renewalPeriodDays phục vụ thanh toán tự động */
const tb_user_vps = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true },
    vpsId: { type: mongoose.Schema.Types.ObjectId, ref: "vps", required: true },

    displayName: { type: String, default: "" },
    ip: String,
    username: String,
    password: String,

    status: {
      type: String,
      enum: ["running", "stopped", "expired", "suspended"],
      default: "running",
    },
    /** Yêu cầu thao tác nguồn chờ admin xử lý */
    pendingPowerAction: {
      type: String,
      enum: ["none", "start", "stop", "restart"],
      default: "none",
    },
    powerActionStatus: {
      type: String,
      enum: ["idle", "pending"],
      default: "idle",
    },
    powerActionRequestedAt: { type: Date },

    autoRenew: { type: Boolean, default: false },
    /** Đồng bộ với gói lúc mua; dùng cho gia hạn tay & cron */
    renewalPeriodDays: { type: Number, default: 30, min: 1 },

    expireDate: { type: Date, required: true },
  },
  {
    collection: "user_vps",
    timestamps: true,
  },
);
tb_user_vps.index({ userId: 1 });
tb_user_vps.index({ expireDate: 1, autoRenew: 1 });
tb_user_vps.index({ powerActionStatus: 1, powerActionRequestedAt: -1 });

/**
 * userId: người thực hiện (khách hoặc admin).
 * ownerUserId: chủ VPS (khách sở hữu instance); admin xem lịch sử theo khách dựa vào đây hoặc theo userVpsId.
 */
const tb_vps_log = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
    userVpsId: { type: mongoose.Schema.Types.ObjectId, ref: "user_vps" },
    action: { type: String, required: true },
    /** billing: mua/gia hạn/nạp liên quan VPS; control: start/stop/...; admin: thao tác admin */
    category: {
      type: String,
      enum: ["billing", "control", "admin", "system"],
      default: "control",
    },
    description: String,
  },
  {
    collection: "vps_logs",
    timestamps: true,
  },
);
tb_vps_log.index({ ownerUserId: 1, createdAt: -1 });
tb_vps_log.index({ userVpsId: 1, createdAt: -1 });
tb_vps_log.index({ userId: 1, createdAt: -1 });

/** Mã giảm giá khi mua VPS (admin tạo tại /admin/vouchers) */
const tb_voucher = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    discountType: { type: String, enum: ["percent", "fixed"], required: true },
    /** percent: 1–100; fixed: số VNĐ giảm */
    discountValue: { type: Number, required: true, min: 0 },
    /** null / không set = không giới hạn lượt */
    maxUses: { type: Number, default: null, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, default: null },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    isHidden: { type: Boolean, default: false },
    note: { type: String, default: "" },
  },
  {
    collection: "vouchers",
    timestamps: true,
  },
);
tb_voucher.index({ isActive: 1 });

/** Cấu hình chung (singleton): link hỗ trợ Zalo / Facebook — admin chỉnh tại /admin/settings/support */
const tb_site_settings = new mongoose.Schema(
  {
    supportZaloUrl: { type: String, default: "", trim: true },
    supportFacebookUrl: { type: String, default: "", trim: true },
    availableFeatures: [{ type: String }],
  },
  {
    collection: "site_settings",
    timestamps: true,
  },
);

/**
 * Modal quảng cáo popup — singleton, admin chỉnh tại /admin/settings/promo-modal
 * version tăng mỗi khi admin lưu → client nhận ra đã xem version mới hay chưa.
 */
const tb_promo_modal = new mongoose.Schema(
  {
    isEnabled:   { type: Boolean, default: false },
    title:       { type: String,  default: "Thông báo hệ thống" },
    bodyHtml:    { type: String,  default: "" },
    /** Nút liên hệ tuỳ chọn */
    facebookUrl: { type: String,  default: "", trim: true },
    zaloNumber:  { type: String,  default: "", trim: true },
    /** Số giờ ẩn sau khi bấm 'Ẩn trong X giờ' */
    hideHours:   { type: Number,  default: 1, min: 0 },
    /** Tăng mỗi lần admin lưu ᄑể client force-show lại */
    version:     { type: Number,  default: 1 },
  },
  {
    collection: "promo_modal",
    timestamps: true,
  },
);

let tb_userModel = db.mongoose.model("users", tb_user);
let tb_user_vpsModel = db.mongoose.model("user_vps", tb_user_vps);
let tb_transactionModel = db.mongoose.model("transactions", tb_transaction);
let tb_vps_categoryModel = db.mongoose.model("vps_categories", tb_vps_category);
let tb_vpsModel = db.mongoose.model("vps", tb_vps);
let tb_vps_logModel = db.mongoose.model("vps_logs", tb_vps_log);
let tb_site_settingsModel = db.mongoose.model("site_settings", tb_site_settings);
let tb_voucherModel = db.mongoose.model("vouchers", tb_voucher);
let tb_counterModel = db.mongoose.model("counters", tb_counter);
let tb_promo_modalModel = db.mongoose.model("promo_modal", tb_promo_modal);

module.exports = {
  tb_userModel,
  tb_user_vpsModel,
  tb_transactionModel,
  tb_vps_categoryModel,
  tb_vpsModel,
  tb_vps_logModel,
  tb_site_settingsModel,
  tb_voucherModel,
  tb_counterModel,
  tb_promo_modalModel,
};
