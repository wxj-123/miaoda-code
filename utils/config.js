// 数据源开关：一处配置决定小程序连哪套后台。改完需重新编译小程序。
//
//   cloudrun —— 微信云托管（走 wx.cloud.callContainer，免域名免备案，发布版用这个）
//   remote   —— 自建服务公网分享链接（带 sharecode 鉴权，仅过渡调试用）
//   local    —— 本机 127.0.0.1:8000（本地开发，开发者工具里用）
//
// 真机正式版必须用 cloudrun：微信只放行 callContainer 走内网，
// 普通的 wx.request 外部域名要求已备案 + 公众平台白名单，绕不过去。

const DATA_MODE = 'selfhost';       // 数据层实现仍是自建服务那套（页面零改动）
const TRANSPORT = 'cloudrun';       // cloudrun | remote | local

// ---- 微信云托管（发布版）----
// 在微信云托管控制台开通环境后，把环境 ID 和服务名填这里
const CLOUD_ENV = 'prod-d7gwaptyf3bb2e1d0'; // 微信云托管环境 ID（控制台复制）
const CLOUD_SERVICE = 'eat-what-api'; // 云托管服务名（与控制台一致）

// ---- 公网分享链接（过渡调试）----
const REMOTE_BASE = 'https://eat-what-96628.app.workbuddy.host';
const REMOTE_SHARECODE = 'ERU6ZJDOOB';

// ---- 本地开发 ----
const LOCAL_BASE = 'http://127.0.0.1:8000';

const useCloudRun = TRANSPORT === 'cloudrun' && !!CLOUD_ENV;
const baseUrl = TRANSPORT === 'local' ? LOCAL_BASE : REMOTE_BASE;

module.exports = {
    dataMode: DATA_MODE,
    isSelfHost: DATA_MODE === 'selfhost',
    transport: TRANSPORT,
    useCloudRun: useCloudRun,
    cloudEnv: CLOUD_ENV,
    cloudService: CLOUD_SERVICE,
    baseUrl: baseUrl,
    // cloudrun 模式下 wx.cloud 不可用时的回退（预览卡/开发者工具），走公网分享链接
    shareCode: TRANSPORT === 'remote' ? REMOTE_SHARECODE : (useCloudRun ? REMOTE_SHARECODE : ''),
    tokenKey: 'eat_what_token',
    deviceKey: 'eat_what_device',
};
