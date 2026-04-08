const { tb_userModel } = require("../models/vpsphong");
const bcrypt = require("bcryptjs");

module.exports.getLogin = (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
};

module.exports.postLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await tb_userModel.findOne({ username });
    
    if (!user) {
      return res.render('login', { error: 'Tên đăng nhập hoặc mật khẩu không đúng!' });
    }

    if (!user.isActive) {
      return res.render('login', { error: 'Tài khoản của bạn đã bị khóa.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('login', { error: 'Tên đăng nhập hoặc mật khẩu không đúng!' });
    }

    // Login success
    req.session.userId = user._id;
    
    if (user.role === 'admin') {
      res.redirect('/admin');
    } else {
      res.redirect('/');
    }
  } catch (err) {
    console.log(err);
    res.render('login', { error: 'Lỗi hệ thống!' });
  }
};

module.exports.getRegister = (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null });
};

module.exports.postRegister = async (req, res) => {
  try {
    const { username, email, phone, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res.render('register', { error: 'Mật khẩu xác nhận không khớp!' });
    }

    const existUser = await tb_userModel.findOne({ $or: [{ username }, { email }] });
    if (existUser) {
      return res.render('register', { error: 'Username hoặc Email đã tồn tại!' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new tb_userModel({
      username,
      email,
      phone,
      password: hashedPassword
    });

    await newUser.save();
    res.redirect('/login');
  } catch (err) {
    console.log(err);
    res.render('register', { error: 'Đăng ký thất bại, thử lại sau!' });
  }
};

module.exports.logout = (req, res) => {
  req.session.destroy();
  res.redirect('/');
};
