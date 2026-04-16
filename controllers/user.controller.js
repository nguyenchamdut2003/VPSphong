const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { tb_userModel, tb_vpsModel, tb_user_vpsModel, tb_transactionModel, tb_vps_logModel, tb_promo_modalModel } = require("../models/vpsphong");
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
  try {
    let promoModal = await tb_promo_modalModel.findOne().lean();
    if (!promoModal) promoModal = { isEnabled: false };
    res.render("user/dashboard", { user: res.locals.user, promoModal });
  } catch (e) {
    res.render("user/dashboard", { user: res.locals.user, promoModal: { isEnabled: false } });
  }
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
    const transactions = await tb_transactionModel
      .find({ userId, type: { $in: ["deposit", "withdraw"] } })
      .sort({ createdAt: -1 })
      .lean();
    const vietqr = getVietQrConfigForUser(res.locals.user.username);
    const minDeposit = Number(process.env.VIETQR_MIN_AMOUNT || 0);
    const minWithdraw = Number(process.env.WITHDRAW_MIN_AMOUNT || 50000);
    res.render("user/chuyen-khoan", {
      user: res.locals.user,
      vietqr,
      transactions,
      minDeposit: Number.isNaN(minDeposit) ? 0 : minDeposit,
      minWithdraw: Number.isNaN(minWithdraw) ? 50000 : minWithdraw,
      withdrawError: req.query.werr || null,
      withdrawOk: req.query.wok === "1",
    });
  } catch (e) {
    console.log(e);
    res.send("Lỗi tải trang");
  }
};

module.exports.postWithdraw = async (req, res) => {
  try {
    const amount = Number(req.body.amount || 0);
    const bankName = String(req.body.bankName || "").trim();
    const accountNumber = String(req.body.accountNumber || "").trim();
    const accountName = String(req.body.accountName || "").trim();
    const note = String(req.body.note || "").trim().slice(0, 300);
    const minWithdraw = Number(process.env.WITHDRAW_MIN_AMOUNT || 50000);

    if (!Number.isFinite(amount) || amount <= 0) return res.redirect("/user/chuyen-khoan?werr=invalid_amount");
    if (amount < minWithdraw) return res.redirect("/user/chuyen-khoan?werr=min_amount");
    if (!bankName || !accountNumber || !accountName) return res.redirect("/user/chuyen-khoan?werr=missing_info");

    const user = await tb_userModel.findById(res.locals.user._id);
    if (!user) return res.redirect("/login");
    if (user.balance < amount) return res.redirect("/user/chuyen-khoan?werr=insufficient_balance");

    user.balance -= amount;
    await user.save();

    await tb_transactionModel.create({
      userId: user._id,
      amount,
      type: "withdraw",
      description: `Yêu cầu rút tiền về ${bankName} - ${accountNumber}`,
      status: "pending",
      withdrawInfo: {
        bankName,
        accountNumber,
        accountName,
        note,
      },
      orderNumber: await nextTransactionOrderNumber(),
    });

    await tb_vps_logModel.create({
      userId: user._id,
      ownerUserId: user._id,
      action: "withdraw_request",
      category: "billing",
      description: `Tạo yêu cầu rút tiền ${amount.toLocaleString()}đ (${bankName})`,
    });

    return res.redirect("/user/chuyen-khoan?wok=1");
  } catch (err) {
    console.log(err);
    return res.redirect("/user/chuyen-khoan?werr=server_error");
  }
};

// Mua VPS (có thể kèm mã voucher)
module.exports.postBuyVps = async (req, res) => {
  let voucherReservedId = null;
  try {
    const vpsId = req.body.vpsId;
    const months = Math.max(1, parseInt(req.body.months, 10) || 1);
    const quantity = Math.max(1, parseInt(req.body.quantity, 10) || 1);
    const vpsData = await tb_vpsModel.findById(vpsId);
    if (!vpsData) return res.send("VPS không tồn tại");
    if (!vpsData.status || vpsData.isSold) return res.send("Gói này không còn sẵn sàng hoặc đã được bán.");

    function discountPrice(base, months) {
      let total = base * months;
      if (months === 3) total *= 0.9;
      if (months === 6) total *= 0.861;
      if (months === 12) total *= 0.833;
      return Math.floor(total);
    }

    const unitMonthPrice = Number(vpsData.price) || 0;
    const unitOrderPrice = discountPrice(unitMonthPrice, months); // tiền cho 1 VPS instance (trong đúng số tháng)
    const originalOrderPrice = unitOrderPrice * quantity; // tiền gốc cho cả đơn

    const rawVoucher = req.body.voucherCode;
    let finalPrice = originalOrderPrice;
    let discountAmount = 0;
    let appliedVoucher = null;

    // Tìm đủ "stock" (nhiều record vps cùng cấu hình) để mua số lượng
    const availableVpsList = await tb_vpsModel
      .find({
        status: true,
        isSold: { $ne: true },
        name: vpsData.name,
        cpu: vpsData.cpu,
        ram: vpsData.ram,
        disk: vpsData.disk,
        price: vpsData.price,
        ipLocation: vpsData.ipLocation,
      })
      .sort({ createdAt: 1 })
      .limit(quantity);

    if (!availableVpsList || availableVpsList.length < quantity) {
      return res.send(`Số lượng VPS không đủ. Hiện có ${availableVpsList?.length || 0} gói cho cấu hình này.`);
    }

    if (rawVoucher && String(rawVoucher).trim()) {
      const vDoc = await findEligibleVoucher(rawVoucher);
      if (!vDoc) {
        return res.send("Mã voucher không hợp lệ, đã hết hạn hoặc hết lượt dùng.");
      }
      const calc = calculateVoucherDiscount(vDoc, originalOrderPrice);
      if (!calc.ok) return res.send(calc.error);
      finalPrice = calc.finalPrice;
      discountAmount = calc.discountAmount;
      appliedVoucher = vDoc;
    }

    const user = res.locals.user;
    if (user.balance < finalPrice) {
      const extra =
        discountAmount > 0
          ? ` (giá gốc ${originalOrderPrice.toLocaleString()}đ, sau giảm còn ${finalPrice.toLocaleString()}đ)`
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

    const createdUserVpsList = [];
    for (const vp of availableVpsList) {
      const cycle = vp.billingCycleDays || 30;
      const unitDays = vp.initialRentDays || cycle;

      let expireDate;
      if (vp.durationKind === "until_date" && vp.rentValidUntil) {
        expireDate = new Date(vp.rentValidUntil);
        if (months > 1) expireDate.setDate(expireDate.getDate() + (months - 1) * unitDays);
      } else {
        expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + unitDays * months);
      }

      const plainPass = vp.passwordEnc ? decrypt(vp.passwordEnc) : "";
      const finalPassword = plainPass || Math.random().toString(36).slice(-10);
      const ip =
        (vp.serverIp && String(vp.serverIp).trim()) ||
        `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      const sshUser = (vp.serverUsername && vp.serverUsername.trim()) || "root";

      const newVps = await tb_user_vpsModel.create({
        userId: user._id,
        vpsId: vp._id,
        displayName: vp.name,
        ip,
        username: sshUser,
        password: finalPassword,
        renewalPeriodDays: cycle,
        expireDate,
      });

      vp.isSold = true;
      vp.status = false;
      await vp.save();

      createdUserVpsList.push(newVps);
    }

    const codeNorm = appliedVoucher ? normalizeCode(rawVoucher) : "";
    const desc = appliedVoucher
      ? `Mua VPS: ${vpsData.name} x${quantity} — Giá gốc ${originalOrderPrice.toLocaleString()}đ, giảm ${discountAmount.toLocaleString()}đ (mã ${codeNorm}), thanh toán ${finalPrice.toLocaleString()}đ`
      : `Mua VPS: ${vpsData.name} x${quantity} — Thanh toán ${finalPrice.toLocaleString()}đ (${months} tháng)`;

    const orderNumber = await nextTransactionOrderNumber();

    await tb_transactionModel.create({
      userId: user._id,
      userVpsId: quantity === 1 ? createdUserVpsList[0]?._id : undefined,
      vpsPlanId: vpsData._id,
      amount: finalPrice,
      type: "payment",
      description: desc,
      status: "success",
      voucherId: appliedVoucher ? appliedVoucher._id : undefined,
      originalAmount: appliedVoucher ? originalOrderPrice : undefined,
      discountAmount: appliedVoucher ? discountAmount : 0,
      orderNumber,
    });

    for (let idx = 0; idx < createdUserVpsList.length; idx++) {
      const uv = createdUserVpsList[idx];
      await tb_vps_logModel.create({
        userId: user._id,
        ownerUserId: user._id,
        userVpsId: uv._id,
        action: "buy",
        category: "billing",
        description: appliedVoucher
          ? idx === 0
            ? `Mua thành công VPS ${vpsData.name} x${quantity} (voucher ${codeNorm}, -${discountAmount}đ tổng)`
            : `Mua thành công VPS ${vpsData.name}`
          : `Mua thành công VPS ${vpsData.name}`,
      });
    }

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
      .populate({ path: "vpsId", populate: { path: "categoryId", select: "name" } })
      .sort({ powerActionStatus: -1, powerActionRequestedAt: -1, createdAt: -1 });
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

    const actionNorm = String(action || "").toLowerCase();
    if (!["start", "stop", "restart"].includes(actionNorm)) {
      return res.send("Thao tác không hợp lệ");
    }

    if (uv.powerActionStatus === "pending" && uv.pendingPowerAction !== "none") {
      return res.send("VPS đang có yêu cầu xử lý trước đó. Vui lòng đợi admin duyệt xong.");
    }

    uv.pendingPowerAction = actionNorm;
    uv.powerActionStatus = "pending";
    uv.powerActionRequestedAt = new Date();
    await uv.save();

    await tb_vps_logModel.create({
      userId: res.locals.user._id,
      ownerUserId: res.locals.user._id,
      userVpsId: uv._id,
      action: `${actionNorm}_request`,
      category: "control",
      description:
        actionNorm === "restart"
          ? "Yêu cầu khởi động lại VPS (chờ admin duyệt)"
          : actionNorm === "stop"
            ? "Yêu cầu tắt VPS (chờ admin duyệt)"
            : "Yêu cầu bật VPS (chờ admin duyệt)",
    });

    res.redirect("/user/vps");
  } catch (err) {
    res.send("Lỗi");
  }
};

