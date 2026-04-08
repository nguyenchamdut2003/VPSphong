/**
 * Tạo hoặc cập nhật tài khoản quản trị (role admin — full quyền /admin).
 * Chạy: node scripts/seed-super-admin.js
 * Tuỳ chọn trong .env: SUPER_ADMIN_USER, SUPER_ADMIN_PASS, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PHONE
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { tb_userModel } = require("../models/vpsphong");

const username = process.env.SUPER_ADMIN_USER || "superadmin";
const plainPassword = process.env.SUPER_ADMIN_PASS || "SuperAdmin@2026";
const email = process.env.SUPER_ADMIN_EMAIL || "superadmin@vpsphong.local";
const phone = process.env.SUPER_ADMIN_PHONE || "0900000000";

async function main() {
  await mongoose.connection.asPromise();

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(plainPassword, salt);

  let user = await tb_userModel.findOne({ $or: [{ username }, { email }] });

  if (user) {
    user.username = username;
    user.email = email;
    user.phone = phone;
    user.password = hashedPassword;
    user.role = "admin";
    user.isActive = true;
    await user.save();
    console.log("Đã cập nhật tài khoản admin:", username);
  } else {
    await tb_userModel.create({
      username,
      email,
      phone,
      password: hashedPassword,
      role: "admin",
      isActive: true,
      balance: 0,
    });
    console.log("Đã tạo tài khoản admin:", username);
  }

  console.log("\n--- Đăng nhập /login ---");
  console.log("Username:", username);
  console.log("Password:", plainPassword);
  console.log("(Đổi mật khẩu sau khi vào được; có thể đặt SUPER_ADMIN_PASS trong .env rồi chạy lại script.)\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => mongoose.connection.close());
