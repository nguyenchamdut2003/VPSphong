/**
 * Tạo hoặc cập nhật tài khoản khách (role customer).
 * Chạy: node scripts/seed-customer.js
 * .env: DEMO_CUSTOMER_USER, DEMO_CUSTOMER_PASS, DEMO_CUSTOMER_EMAIL, DEMO_CUSTOMER_PHONE
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { tb_userModel } = require("../models/vpsphong");

const username = process.env.DEMO_CUSTOMER_USER || "khachdemo";
const plainPassword = process.env.DEMO_CUSTOMER_PASS || "KhachHang@2026";
const email = process.env.DEMO_CUSTOMER_EMAIL || "khachdemo@vpsphong.local";
const phone = process.env.DEMO_CUSTOMER_PHONE || "0912345678";
const balance = Number(process.env.DEMO_CUSTOMER_BALANCE || 500000);

async function main() {
  await mongoose.connection.asPromise();

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(plainPassword, salt);

  let user = await tb_userModel.findOne({ $or: [{ username }, { email }] });

  if (user) {
    if (user.role === "admin") {
      console.error("Trùng username/email với tài khoản admin. Đổi DEMO_CUSTOMER_USER / DEMO_CUSTOMER_EMAIL trong .env.");
      process.exit(1);
    }
    user.username = username;
    user.email = email;
    user.phone = phone;
    user.password = hashedPassword;
    user.role = "customer";
    user.isActive = true;
    if (!Number.isNaN(balance) && balance >= 0) user.balance = balance;
    await user.save();
    console.log("Đã cập nhật tài khoản khách:", username);
  } else {
    await tb_userModel.create({
      username,
      email,
      phone,
      password: hashedPassword,
      role: "customer",
      isActive: true,
      balance: Number.isNaN(balance) || balance < 0 ? 0 : balance,
    });
    console.log("Đã tạo tài khoản khách:", username);
  }

  console.log("\n--- Đăng nhập /login ---");
  console.log("Username:", username);
  console.log("Password:", plainPassword);
  console.log("(Có thể chỉnh DEMO_CUSTOMER_* trong .env rồi chạy lại script.)\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => mongoose.connection.close());
