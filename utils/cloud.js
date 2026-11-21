// 云端客户端：全局唯一实例，Auth / Database / Storage 共用。
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');

const publicConfig = {
    endpoint: 'https://mp-api.app.workbuddy.host',
    publishableKey: 'wbpk_r7CGx6kAa3BL6TtSAUc3K3_V3I2i9kUV6zvKZcHQHy8Rk2kNxGKcRxC',
};

const cloud = createMiniProgramWorkBuddyCloud({
    endpoint: publicConfig.endpoint,
    publishableKey: publicConfig.publishableKey,
    wx: createDiagnosticWx(wx),
});

module.exports = { cloud };
