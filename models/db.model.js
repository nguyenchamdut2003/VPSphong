require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Kết nối MongoDB thành công"))
  .catch(err => console.log("Lỗi kết nối DB:", err));

module.exports = { mongoose };
