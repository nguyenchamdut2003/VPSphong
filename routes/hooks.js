const express = require("express");
const router = express.Router();
const { handleSepayPaymentWebhook } = require("../controllers/sepay.controller");

router.post("/sepay-payment", handleSepayPaymentWebhook);

module.exports = router;
