const qs = require("querystring");
const {
  tb_userModel,
  tb_transactionModel,
  tb_vps_logModel,
  tb_sepay_webhookModel,
} = require("../models/vpsphong");
const { nextTransactionOrderNumber } = require("../utils/nextTransactionOrderNumber");

function normalizeRequestBody(rawBody) {
  let body = rawBody;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_err) {
      body = qs.parse(body);
    }
  }

  if (!body || typeof body !== "object") {
    return {};
  }

  return body;
}

function extractUsernameFromContent(content, prefix) {
  const transferContent = String(content || "");
  const marker = String(prefix || "SEVQR").trim().toUpperCase();
  if (!transferContent || !marker) return null;

  const upperContent = transferContent.toUpperCase();
  const markerIndex = upperContent.indexOf(marker);
  if (markerIndex === -1) return null;

  const afterMarker = transferContent.substring(markerIndex + marker.length).trim();
  if (!afterMarker) return null;

  const firstToken = afterMarker.split(/\s+/)[0] || "";
  const username = firstToken.split("-")[0]?.trim();
  return username || null;
}

function depositDescription(providerTransactionId, content) {
  return `Nạp SePay #${providerTransactionId} - ${String(content || "").trim()}`;
}

async function ensureWebhookRecord(providerTransactionId, body) {
  let record = await tb_sepay_webhookModel.findOne({
    provider: "sepay",
    providerTransactionId,
  });

  if (record) {
    return record;
  }

  try {
    record = await tb_sepay_webhookModel.create({
      provider: "sepay",
      providerTransactionId,
      payload: body,
    });
    return record;
  } catch (err) {
    if (err?.code === 11000) {
      return tb_sepay_webhookModel.findOne({
        provider: "sepay",
        providerTransactionId,
      });
    }
    throw err;
  }
}

module.exports.handleSepayPaymentWebhook = async (req, res) => {
  try {
    const body = normalizeRequestBody(req.body);
    const transferTypeRaw = body.transferType || body.transfer_type || body.transfertype;
    const transferType = String(transferTypeRaw || "").toLowerCase();

    if (transferType !== "in") {
      return res.status(200).json({ success: true, message: "Skip non-IN transaction" });
    }

    const amount = Number(body.transferAmount || body.transfer_amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(200).json({ success: true, message: "Invalid amount" });
    }

    const providerTransactionId = String(body.id || body.referenceCode || "").trim();
    if (!providerTransactionId) {
      return res.status(200).json({ success: true, message: "Missing transaction id" });
    }

    const prefix = process.env.VIETQR_ADDINFO_PREFIX || "SEVQR";
    const username = extractUsernameFromContent(body.content, prefix);
    if (!username) {
      return res.status(200).json({ success: true, message: "Username not found in transfer content" });
    }

    const user = await tb_userModel.findOne({ username });
    if (!user) {
      return res.status(200).json({ success: true, message: "User not found" });
    }

    const webhookRecord = await ensureWebhookRecord(providerTransactionId, body);
    if (!webhookRecord) {
      throw new Error("Unable to load webhook record");
    }

    if (webhookRecord.status === "processed" || webhookRecord.status === "success") {
      return res.status(200).json({ success: true, message: "Duplicate transaction ignored" });
    }

    const txDescription = depositDescription(providerTransactionId, body.content);
    let transaction = await tb_transactionModel.findOne({
      userId: user._id,
      type: "deposit",
      description: txDescription,
    });

    if (!transaction) {
      const oldBalance = Number(user.balance || 0);
      user.balance = oldBalance + amount;
      await user.save();

      transaction = await tb_transactionModel.create({
        userId: user._id,
        amount,
        type: "deposit",
        description: txDescription,
        status: "success",
        orderNumber: await nextTransactionOrderNumber(),
      });

      await tb_vps_logModel.create({
        userId: user._id,
        ownerUserId: user._id,
        action: "deposit",
        category: "billing",
        description: `Nạp tiền tự động SePay: +${amount.toLocaleString()}đ`,
      });
    } else {
      const creditedAmount = Number(transaction.amount || 0);
      const currentBalance = Number(user.balance || 0);
      if (creditedAmount > 0 && currentBalance < creditedAmount) {
        user.balance = currentBalance + creditedAmount;
        await user.save();
      } else {
        await user.save();
      }
    }

    await tb_sepay_webhookModel.updateOne(
      { _id: webhookRecord._id },
      {
        $set: {
          status: "processed",
          userId: user._id,
          amount,
          username,
          processedAt: new Date(),
          payload: body,
        },
      },
    );

    return res.status(200).json({
      success: true,
      message: "Deposit processed",
      user: username,
      amount,
      newBalance: user.balance,
    });
  } catch (err) {
    console.error("SePay webhook error:", err?.message || err, err?.errors || "");
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
