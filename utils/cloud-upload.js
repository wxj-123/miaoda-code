// 云托管对象存储上传：小程序直传，拿到 cloud:// fileID 存库。
// 微信 image/video 组件原生支持 cloud://，服务端只保存字符串，不碰文件。
// 本地开发（未配置 env）时返回 null，调用方回退到旧的 wx.uploadFile 通道。
const config = require('./config');

const CLOUD_ENV = config.cloudEnv || '';
const CLOUD_SERVICE = config.cloudService || '';
let cloudReady = false;

function cloudAvailable() {
    return !!(CLOUD_ENV && typeof wx !== 'undefined' && wx.cloud);
}

function initCloud() {
    if (!cloudAvailable() || cloudReady) return true;
    try {
        wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
        cloudReady = true;
        return true;
    } catch (error) {
        return false;
    }
}

// 上传本地临时文件到对象存储，成功返回 cloud:// fileID，失败返回 null（触发回退）
function uploadToCloud(tempFilePath, kind) {
    if (!initCloud()) return Promise.resolve(null);
    const ext = (tempFilePath.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0];
    const folder = kind === 'video' ? 'video' : 'food';
    const cloudPath = 'uploads/' + folder + '/' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + ext;
    return new Promise((resolve) => {
        wx.cloud.uploadFile({
            cloudPath: cloudPath,
            filePath: tempFilePath,
            config: { env: CLOUD_ENV },
            success(res) {
                resolve(res && res.fileID ? res.fileID : null);
            },
            fail() {
                resolve(null);
            },
        });
    });
}

module.exports = { cloudAvailable, initCloud, uploadToCloud };
