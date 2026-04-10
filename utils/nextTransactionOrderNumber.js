const { tb_counterModel } = require("../models/vpsphong");

const COUNTER_ID = "transaction_order";

/** Số đơn tăng dần (1, 2, 3, …) cho mọi giao dịch thành công */
async function nextTransactionOrderNumber() {
  const doc = await tb_counterModel.findOneAndUpdate(
    { _id: COUNTER_ID },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return doc.seq;
}

module.exports = { nextTransactionOrderNumber };
