var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var indexRouter = require('./routes/index');
var userRouter = require('./routes/user');
var adminRouter = require('./routes/admin');

require('dotenv').config();
var session = require('express-session');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'my_secret_token_123',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Đặt false nếu chạy dev trên localhost
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/user', userRouter);
app.use('/admin', adminRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;

// ===== CRON JOB: Tự động gia hạn VPS =====
var cron = require('node-cron');
const { tb_user_vpsModel, tb_userModel, tb_transactionModel, tb_vps_logModel, tb_vpsModel } = require('./models/vpsphong');

// Chạy job hàng ngày lúc 0h đêm
cron.schedule('0 0 * * *', async () => {
  console.log("CRON Job: Kiểm tra các VPS cần gia hạn...");
  const expiringDate = new Date();
  expiringDate.setDate(expiringDate.getDate() + 1);

  const lists = await tb_user_vpsModel.find({
    autoRenew: true,
    expireDate: { $lte: expiringDate }
  }).populate('vpsId');

  for (let uv of lists) {
    const user = await tb_userModel.findById(uv.userId);
    const vpsData = uv.vpsId;
    if (user && vpsData && user.balance >= vpsData.price) {
      user.balance -= vpsData.price;
      await user.save();

      const addDays = uv.renewalPeriodDays || vpsData.billingCycleDays || 30;
      const newExpire = new Date(uv.expireDate);
      if (newExpire < new Date()) newExpire.setTime(new Date().getTime());
      newExpire.setDate(newExpire.getDate() + addDays);

      uv.expireDate = newExpire;
      uv.status = "running";
      await uv.save();

      await tb_transactionModel.create({
        userId: user._id,
        userVpsId: uv._id,
        vpsPlanId: vpsData._id,
        amount: vpsData.price,
        type: "renew",
        description: `AutoRenew: Gia hạn tự động gói ${vpsData.name} (+${addDays} ngày)`,
        status: "success",
      });

      await tb_vps_logModel.create({
        userId: user._id,
        ownerUserId: user._id,
        userVpsId: uv._id,
        action: "renew",
        category: "system",
        description: "Gia hạn tự động (AutoRenew).",
      });
    } else {
      uv.status = 'expired';
      await uv.save();
    }
  }
});
