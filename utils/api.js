// 数据层入口：按 utils/config.js 的 dataMode 选择一个实现。
// 页面只 require 这个文件，不直接依赖 cloud.js 或 api-selfhost.js。
//
//   cloud    → ./api-cloud.js    走 WorkBuddy 托管云（云端 SDK）
//   selfhost → ./api-selfhost.js 走自建服务（D:/dask/eat-what-admin，与 PC 后台同一个库）

const config = require('./config');

const impl = config.dataMode === 'selfhost' ? require('./api-selfhost') : require('./api-cloud');

// 供登录组件判断：自建服务走微信一键登录，托管云走邮箱验证码
impl.canWechatLogin = config.isSelfHost;
impl.dataMode = config.dataMode;

module.exports = impl;
