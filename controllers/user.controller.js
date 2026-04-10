const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { tb_userModel, tb_vpsModel, tb_user_vpsModel, tb_transactionModel, tb_vps_logModel } = require("../models/vpsphong");
const { decrypt } = require("../utils/vpsCrypto");
const { getVietQrConfigForUser } = require("../config/vietqr");
const {
  normalizeCode,
  findEligibleVoucher,
  calculateVoucherDiscount,
  reserveVoucherUse,
  releaseVoucherUse,
} = require("../utils/voucher");
const { nextTransactionOrderNumber } = require("../utils/nextTransactionOrderNumber");

module.exports.getDashboard = async (req, res) => {
  res.render("user/dashboard", { user: res.locals.user });
};

/** Quản lý tài khoản (thông tin / đổi MK / 2FA / lịch sử hoạt động) */
module.exports.getAccount = async (req, res) => {
  try {
    const uid = res.locals.user._id;
    const rawTab = String(req.query.tab || "info").toLowerCase();
    const tab = ["info", "password", "twofa", "activity"].includes(rawTab) ? rawTab : "info";

    const [depSum, paySum] = await Promise.all([
      tb_transactionModel.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(uid), type: "deposit", status: "success" } },
        { $group: { _id: null, t: { $sum: "$amount" } } },
      ]),
      tb_transactionModel.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(uid),
            type: { $in: ["payment", "renew"] },
            status: "success",
          },
        },
        { $group: { _id: null, t: { $sum: "$amount" } } },
      ]),
    ]);

    const totalDeposit = depSum[0]?.t || 0;
    const totalSpent = paySum[0]?.t || 0;

    let activityLogs = [];
    if (tab === "activity") {
      const myVpsIds = await tb_user_vpsModel.find({ userId: uid }).distinct("_id");
      activityLogs = await tb_vps_logModel
        .find({ userVpsId: { $in: myVpsIds } })
        .populate("userVpsId")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
    }

    const accountUser = await tb_userModel.findById(uid).lean();
    const clientIp =
      (req.headers["x-forwarded-for"] && String(req.headers["x-forwarded-for"]).split(",")[0].trim()) ||
      req.socket?.remoteAddress ||
      "";
    const userAgent = req.get("user-agent") || "—";

    res.render("user/account", {
      user: res.locals.user,
      accountUser,
      tab,
      totalDeposit,
      totalSpent,
      activityLogs,
      clientIp,
      userAgent,
      pwError: req.query.err || null,
      pwOk: req.query.ok === "1",
    });
  } catch (e) {
    console.error(e);
    res.send("Lỗi tải trang tài khoản");
  }
};

module.exports.postAccountPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const user = await tb_userModel.findById(res.locals.user._id);
    if (!user) return res.redirect("/user/account?tab=password&err=nouser");

    const cur = (currentPassword || "").trim();
    const nw = (newPassword || "").trim();
    const cf = (confirmPassword || "").trim();

    if (!cur || !nw || !cf) {
      return res.redirect("/user/account?tab=password&err=empty");
    }
    if (nw.length < 6) {
      return res.redirect("/user/account?tab=password&err=short");
    }
    if (nw !== cf) {
      return res.redirect("/user/account?tab=password&err=mismatch");
    }

    const ok = await bcrypt.compare(cur, user.password);
    if (!ok) {
      return res.redirect("/user/account?tab=password&err=current");
    }

    user.password = await bcrypt.hash(nw, 10);
    await user.save();
    res.redirect("/user/account?tab=password&ok=1");
  } catch (e) {
    console.error(e);
    res.redirect("/user/account?tab=password&err=server");
  }
};

/** Nạp ngân hàng: VietQR + nội dung SEVQR + username + lịch sử nạp tiền */
module.exports.getChuyenKhoan = async (req, res) => {
  try {
    const userId = res.locals.user._id;
    const deposits = await tb_transactionModel
      .find({ userId, type: "deposit" })
      .sort({ createdAt: -1 })
      .lean();
    const vietqr = getVietQrConfigForUser(res.locals.user.username);
    const minDeposit = Number(process.env.VIETQR_MIN_AMOUNT || 0);
    res.render("user/chuyen-khoan", {
      user: res.locals.user,
      vietqr,
      deposits,
      minDeposit: Number.isNaN(minDeposit) ? 0 : minDeposit,
    });
  } catch (e) {
    console.log(e);
    res.send("Lỗi tải trang");
  }
};

// Nạp tiền (Mô phỏng)
module.exports.postDeposit = async (req, res) => {
  try {
    const amount = Number(req.body.amount || 0);
    if (amount <= 0) return res.redirect('/user/dashboard');

    const user = res.locals.user;
    user.balance += amount;
    await user.save();

    await tb_transactionModel.create({
      userId: user._id,
      amount,
      type: "deposit",
      description: `Nạp tiền vào tài khoản: ${amount}`,
      status: "success",
      orderNumber: await nextTransactionOrderNumber(),
    });

    res.redirect("/user/chuyen-khoan");
  } catch (err) {
    console.log(err);
    res.send("Lỗi nạp tiền");
  }
}

// Mua VPS (có thể kèm mã voucher)
module.exports.postBuyVps = async (req, res) => {
  let voucherReservedId = null;
  try {
    const vpsId = req.body.vpsId;
    const vpsData = await tb_vpsModel.findById(vpsId);
    if (!vpsData) return res.send("VPS không tồn tại");
    if (!vpsData.status || vpsData.isSold) return res.send("Gói này không còn sẵn sàng hoặc đã được bán.");

    const originalPrice = Number(vpsData.price) || 0;
    const rawVoucher = req.body.voucherCode;
    let finalPrice = originalPrice;
    let discountAmount = 0;
    let appliedVoucher = null;

    if (rawVoucher && String(rawVoucher).trim()) {
      const vDoc = await findEligibleVoucher(rawVoucher);
      if (!vDoc) {
        return res.send("Mã voucher không hợp lệ, đã hết hạn hoặc hết lượt dùng.");
      }
      const calc = calculateVoucherDiscount(vDoc, originalPrice);
      if (!calc.ok) return res.send(calc.error);
      finalPrice = calc.finalPrice;
      discountAmount = calc.discountAmount;
      appliedVoucher = vDoc;
    }

    const user = res.locals.user;
    if (user.balance < finalPrice) {
      const extra =
        discountAmount > 0
          ? ` (giá gốc ${originalPrice.toLocaleString()}đ, sau giảm còn ${finalPrice.toLocaleString()}đ)`
          : "";
      return res.send(
        `Không đủ số dư${extra}. Số dư hiện tại: ${user.balance.toLocaleString()}đ. Vui lòng nạp thêm.`,
      );
    }

    if (appliedVoucher) {
      const reserved = await reserveVoucherUse(appliedVoucher._id);
      if (!reserved.ok) {
        return res.send("Voucher vừa hết lượt hoặc không còn hiệu lực. Vui lòng thử lại.");
      }
      voucherReservedId = appliedVoucher._id;
    }

    user.balance -= finalPrice;
    await user.save();

    const cycle = vpsData.billingCycleDays || 30;
    let expireDate;
    if (vpsData.durationKind === "until_date" && vpsData.rentValidUntil) {
      expireDate = new Date(vpsData.rentValidUntil);
    } else {
      const firstDays = vpsData.initialRentDays || cycle;
      expireDate = new Date();
      expireDate.setDate(expireDate.getDate() + firstDays);
    }

    const plainPass = vpsData.passwordEnc ? decrypt(vpsData.passwordEnc) : "";
    const finalPassword = plainPass || Math.random().toString(36).slice(-10);
    const ip =
      (vpsData.serverIp && String(vpsData.serverIp).trim()) ||
      `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    const sshUser = (vpsData.serverUsername && vpsData.serverUsername.trim()) || "root";

    const newVps = await tb_user_vpsModel.create({
      userId: user._id,
      vpsId: vpsData._id,
      displayName: vpsData.name,
      ip,
      username: sshUser,
      password: finalPassword,
      renewalPeriodDays: cycle,
      expireDate,
    });

    vpsData.isSold = true;
    vpsData.status = false;
    await vpsData.save();

    const codeNorm = appliedVoucher ? normalizeCode(rawVoucher) : "";
    const desc = appliedVoucher
      ? `Mua VPS: ${vpsData.name} — Giá gốc ${originalPrice.toLocaleString()}đ, giảm ${discountAmount.toLocaleString()}đ (mã ${codeNorm}), thanh toán ${finalPrice.toLocaleString()}đ`
      : `Mua gói VPS: ${vpsData.name} - Giá: ${vpsData.price}`;

    await tb_transactionModel.create({
      userId: user._id,
      userVpsId: newVps._id,
      vpsPlanId: vpsData._id,
      amount: finalPrice,
      type: "payment",
      description: desc,
      status: "success",
      voucherId: appliedVoucher ? appliedVoucher._id : undefined,
      originalAmount: appliedVoucher ? originalPrice : undefined,
      discountAmount: appliedVoucher ? discountAmount : 0,
      orderNumber: await nextTransactionOrderNumber(),
    });

    await tb_vps_logModel.create({
      userId: user._id,
      ownerUserId: user._id,
      userVpsId: newVps._id,
      action: "buy",
      category: "billing",
      description: appliedVoucher
        ? `Mua thành công VPS ${vpsData.name} (voucher ${codeNorm}, -${discountAmount}đ)`
        : `Mua thành công VPS ${vpsData.name}`,
    });

    res.redirect("/user/vps");
  } catch (err) {
    if (voucherReservedId) await releaseVoucherUse(voucherReservedId);
    console.log(err);
    res.send("Lỗi hệ thống khi mua VPS");
  }
};

// Xem VPS đang dùng
module.exports.getMyVps = async (req, res) => {
  try {
    const userVpsList = await tb_user_vpsModel
      .find({ userId: res.locals.user._id })
      .populate({ path: "vpsId", populate: { path: "categoryId", select: "name" } });
    res.render("user/vps", { user: res.locals.user, userVpsList });
  } catch (err) {
    res.send("Lỗi");
  }
};

// Xem lịch sử nạp / mua
module.exports.getHistory = async (req, res) => {
  try {
    const transactions = await tb_transactionModel.find({ userId: res.locals.user._id }).sort({ createdAt: -1 }).populate('userVpsId');
    res.render('user/history', { user: res.locals.user, transactions });
  } catch (err) {
    res.send("Lỗi");
  }
};

// Xem lịch sử thao tác (mọi log gắn VPS của khách, kể cả gia hạn tự động)
module.exports.getLogs = async (req, res) => {
  try {
    const myVpsIds = await tb_user_vpsModel.find({ userId: res.locals.user._id }).distinct("_id");
    const logs = await tb_vps_logModel
      .find({ userVpsId: { $in: myVpsIds } })
      .populate("userVpsId")
      .sort({ createdAt: -1 });
    res.render("user/logs", { user: res.locals.user, logs });
  } catch (err) {
    res.send("Lỗi");
  }
};

// Chỉnh sửa AutoRenew
module.exports.postToggleAutoRenew = async (req, res) => {
  try {
    const { userVpsId } = req.body;
    const uv = await tb_user_vpsModel.findOne({ _id: userVpsId, userId: res.locals.user._id });
    if (uv) {
      uv.autoRenew = !uv.autoRenew;
      await uv.save();
    }
    res.redirect('/user/vps');
  } catch (err) {
    res.send("Error");
  }
};

// Gia hạn thủ công
module.exports.postRenew = async (req, res) => {
  try {
    const { userVpsId } = req.body;
    const uv = await tb_user_vpsModel.findOne({ _id: userVpsId, userId: res.locals.user._id }).populate('vpsId');
    if (!uv) return res.send("VPS không tồn tại");

    const vpsData = uv.vpsId;
    const user = res.locals.user;
    if (user.balance < vpsData.price) {
      return res.send(`Không đủ số dư để gia hạn. Giá: ${vpsData.price}`);
    }

    user.balance -= vpsData.price;
    await user.save();

    const addDays = uv.renewalPeriodDays || vpsData.billingCycleDays || 30;
    const expire = new Date(uv.expireDate);
    expire.setDate(expire.getDate() + addDays);
    uv.expireDate = expire;

    if (uv.status === "expired") uv.status = "running";
    await uv.save();

    await tb_transactionModel.create({
      userId: user._id,
      userVpsId: uv._id,
      vpsPlanId: vpsData._id,
      amount: vpsData.price,
      type: "renew",
      description: `Gia hạn VPS: ${vpsData.name} - Thêm ${addDays} ngày`,
      status: "success",
      orderNumber: await nextTransactionOrderNumber(),
    });

    await tb_vps_logModel.create({
      userId: user._id,
      ownerUserId: user._id,
      userVpsId: uv._id,
      action: "renew",
      category: "billing",
      description: "Gia hạn thành công",
    });

    res.redirect('/user/vps');
  } catch (err) {
    res.send("Lỗi");
  }
}

// Các thao tác VPS (Stop, start, restart — bật/tắt/khởi động lại do admin xử lý tay)
module.exports.postVpsAction = async (req, res) => {
  try {
    const { userVpsId, action } = req.body;
    const uv = await tb_user_vpsModel.findOne({ _id: userVpsId, userId: res.locals.user._id });
    if (!uv) return res.send("VPS không tồn tại");

    if (uv.status === "expired" || uv.status === "suspended") {
      return res.send("VPS hết hạn hoặc bị khóa — không thể thao tác nguồn. Vui lòng gia hạn hoặc liên hệ admin.");
    }

    if (action === "start") uv.status = "running";
    else if (action === "stop") uv.status = "stopped";
    else if (action === "restart") {
      /* Giữ trạng thái hiển thị; admin làm thật trên máy chủ */
    } else {
      return res.send("Thao tác không hợp lệ");
    }

    await uv.save();

    const actionLabel =
      action === "start" ? "start" : action === "stop" ? "stop" : action === "restart" ? "restart" : action;
    await tb_vps_logModel.create({
      userId: res.locals.user._id,
      ownerUserId: res.locals.user._id,
      userVpsId: uv._id,
      action: actionLabel,
      category: "control",
      description:
        action === "restart"
          ? "Yêu cầu khởi động lại VPS (admin xử lý thủ công khi online)"
          : `Thực hiện thao tác: ${actionLabel}`,
    });

    res.redirect("/user/vps");
  } catch (err) {
    res.send("Lỗi");
  }
};

