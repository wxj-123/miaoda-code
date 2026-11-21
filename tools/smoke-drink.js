// 临时冒烟：模拟小程序运行时，验证「今日想喝」的状态流转
const path = require('path');

const listeners = {};
const wx = {
    request: () => {},
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    showToast: () => {},
    vibrateShort: (o) => { wx.__vibrated = (wx.__vibrated || 0) + 1; },
    startAccelerometer: () => {},
    stopAccelerometer: () => {},
    onAccelerometerChange: (fn) => { listeners.accel = fn; },
    offAccelerometerChange: () => { listeners.accel = null; },
    setClipboardData: () => {},
    stopPullDownRefresh: () => {},
    navigateTo: () => {},
    switchTab: () => {},
    showModal: () => {},
};
global.wx = wx;
global.getApp = () => ({
    globalData: { user: null },
    requireLogin: () => true,
    getUser: () => null,
    ensureSession: () => Promise.resolve({ session: null, error: null }),
});

let page;
global.Page = (options) => {
    page = options;
    page.data = JSON.parse(JSON.stringify(options.data));
    page.setData = function (patch) {
        Object.keys(patch).forEach((k) => {
            this.data[k] = patch[k];
        });
    };
};

require(path.resolve(__dirname, '../pages/index/index.js'));

page.openDrink();
console.log('打开后 visible:', page.data.drinkVisible, 'animating:', page.data.drinkAnimating, '轨道长度:', page.data.drinkReel.length);

const kinds = new Set(page.data.drinkReel.map((i) => i.kind));
console.log('轨道品牌种类:', [...kinds].join('/'), '唯一 key:', new Set(page.data.drinkReel.map((i) => i.key)).size === page.data.drinkReel.length);

setTimeout(() => {
    console.log('60ms 后 offset:', page.data.drinkOffset, 'transition:', page.data.drinkTransition);
}, 100);

setTimeout(() => {
    const r = page.data.drinkResult;
    console.log('结束后 animating:', page.data.drinkAnimating, '结果:', r && r.name, '| 招牌:', r && r.star);
    console.log('结果是否在轨道末尾前一格:', page.data.drinkReel[page.data.drinkReel.length - 2].name === r.name);
    console.log('震动次数:', wx.__vibrated || 0);

    // 切换分类后重摇
    page.setDrinkKind({ currentTarget: { dataset: { kind: '咖啡' } } });
    setTimeout(() => {
        const r2 = page.data.drinkResult;
        console.log('切到咖啡后结果:', r2 && r2.name, '| kind:', r2 && r2.kind);
        page.closeDrink();
        console.log('关闭后 visible:', page.data.drinkVisible, '| 监听移除:', listeners.accel === null);
        process.exit(0);
    }, 1800);
}, 1800);
