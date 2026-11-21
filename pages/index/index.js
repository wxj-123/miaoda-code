const api = require('../../utils/api');
const { CUISINES, TASTES, MEALS, DIFFICULTIES, QUICK_TAGS } = require('../../utils/constants');
const { BRANDS } = require('../../utils/drinks');
const { toast } = require('../../utils/util');
// 饮品滚盘的位移时长，必须和 index.wxss 里 .reel-track-run 的 transition 一致
const DRINK_ROLL_MS = 1500;
const DRINK_ITEM_RPX = 108;

Page({
    data: {
        loading: true,
        gridLoading: false,
        greeting: '',
        error: '',
        notice: null,
        featured: [],
        recommend: [],
        hot: [],
        cuisines: CUISINES,
        quickTags: QUICK_TAGS,
        tastes: ['不限'].concat(TASTES),
        meals: ['不限'].concat(MEALS),
        difficulties: ['不限'].concat(DIFFICULTIES),

        rollVisible: false,
        rollLoading: false,
        rollError: '',
        rollResult: null,
        filters: {
            takeaway: false,
            quick: false,
            taste: '不限',
            meal: '不限',
            difficulty: '不限',
        },

        // 今日想喝
        drinkVisible: false,
        drinkKind: '全部',
        drinkKinds: ['全部', '奶茶', '柠檬茶', '咖啡'],
        drinkReel: [],
        drinkOffset: 0,
        drinkItemRpx: DRINK_ITEM_RPX,
        drinkTransition: false,
        drinkAnimating: false,
        drinkResult: null,
    },

    onLoad() {
        this.setData({ greeting: this.buildGreeting() });
        this.loadAll();
        this.loadDrinkBrands();
    },

    // 拉远端品牌池，失败或为空时保持包内默认池
    async loadDrinkBrands() {
        if (typeof api.getDrinks !== 'function') return;
        const result = await api.getDrinks();
        const brands = result.data && result.data.length ? result.data : BRANDS;
        this.drinkBrands = brands;
    },

    onHide() {
        this.stopShakeWatch();
    },

    onUnload() {
        this.clearDrinkTimers();
        this.stopShakeWatch();
    },

    buildGreeting() {
        const now = new Date();
        const hour = now.getHours();
        const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
        let part = '早上好';
        if (hour >= 5 && hour < 11) part = '早上好';
        else if (hour >= 11 && hour < 14) part = '午饭时间';
        else if (hour >= 14 && hour < 18) part = '下午好';
        else if (hour >= 18 && hour < 22) part = '晚饭时间';
        else part = '夜宵时间';
        return part + ' · ' + week;
    },

    onPullDownRefresh() {
        this.loadAll().then(() => wx.stopPullDownRefresh());
    },

    async loadAll() {
        this.setData({ loading: true, gridLoading: false, error: '' });

        // 第一阶段：公告 + 官方精选。首屏内容一到位就先渲染，不必等三组列表
        const [notices, featured] = await Promise.all([
            api.listNotices(),
            api.listRecipes({ sort: 'weight', pageSize: 6 }),
        ]);
        if (featured.error) {
            this.setData({ loading: false, error: featured.error });
            return;
        }
        this.setData({
            loading: false,
            gridLoading: true,
            notice: (notices.data && notices.data[0]) || null,
            featured: (featured.data && featured.data.list) || [],
        });

        // 第二阶段：两个网格，骨架屏先占住位置，数据到了原地替换
        const [recommend, hot] = await Promise.all([
            api.listRecipes({ sort: 'like', pageSize: 6 }),
            api.listRecipes({ sort: 'latest', pageSize: 6 }),
        ]);
        this.setData({
            gridLoading: false,
            recommend: (recommend.data && recommend.data.list) || [],
            hot: (hot.data && hot.data.list) || [],
        });
    },

    goSearch() {
        wx.navigateTo({ url: '/pages/search/search' });
    },

    goList(event) {
        const dataset = event.currentTarget.dataset;
        const params = [];
        if (dataset.cuisine) params.push('cuisine=' + encodeURIComponent(dataset.cuisine));
        if (dataset.field === 'tag') params.push('tag=' + encodeURIComponent(dataset.label));
        if (dataset.field === 'quick') params.push('quick=1');
        if (dataset.field === 'takeaway') params.push('takeaway=1');
        wx.navigateTo({ url: '/pages/recipe/list/list?' + params.join('&') });
    },

    goAllRecipes() {
        wx.navigateTo({ url: '/pages/recipe/list/list' });
    },

    goDetail(event) {
        const id = event.currentTarget.dataset.id;
        if (!id) return;
        wx.navigateTo({ url: '/pages/recipe/detail/detail?id=' + id });
    },

    showNotice() {
        const notice = this.data.notice;
        if (!notice) return;
        wx.showModal({
            title: notice.title,
            content: notice.content || '',
            showCancel: false,
            confirmText: '知道了',
            confirmColor: '#FF6B35',
        });
    },

    /* ---------- 随机抽菜 ---------- */

    openRoll() {
        this.setData({ rollVisible: true, rollError: '', rollResult: null });
        this.roll();
    },

    closeRoll() {
        this.setData({ rollVisible: false });
    },

    noop() {},

    setFilter(event) {
        const { group, value } = event.currentTarget.dataset;
        const filters = Object.assign({}, this.data.filters);
        if (group === 'takeaway' || group === 'quick') {
            filters[group] = !filters[group];
        } else {
            filters[group] = value;
        }
        this.setData({ filters: filters });
        this.roll();
    },

    buildFilters() {
        const f = this.data.filters;
        const params = {};
        if (f.takeaway) params.takeaway = true;
        if (f.quick) params.quick = true;
        if (f.taste !== '不限') params.taste = f.taste;
        if (f.meal !== '不限') params.meal = f.meal;
        if (f.difficulty !== '不限') params.difficulty = f.difficulty;
        return params;
    },

    async roll() {
        this.setData({ rollLoading: true, rollError: '' });
        const result = await api.randomRecipe(this.buildFilters());
        if (result.error) {
            this.setData({ rollLoading: false, rollResult: null, rollError: result.error });
            return;
        }
        const item = result.data;
        item.materialText = (item.materials || [])
            .slice(0, 5)
            .map((material) => material.name)
            .join('、');
        this.setData({ rollLoading: false, rollResult: item, rollError: '' });
    },

    viewRollDetail() {
        const item = this.data.rollResult;
        if (!item) return;
        this.setData({ rollVisible: false });
        wx.navigateTo({ url: '/pages/recipe/detail/detail?id=' + item.id });
    },

    async collectRoll() {
        const item = this.data.rollResult;
        if (!item) return;
        if (!getApp().requireLogin()) return;
        const result = await api.toggleCollect('recipe', item.id);
        if (result.error) {
            toast(result.error);
            return;
        }
        toast(result.data ? '已加入收藏' : '已取消收藏');
    },

    copyRollName() {
        const item = this.data.rollResult;
        if (!item) return;
        wx.setClipboardData({
            data: item.name,
            success: () => toast('菜名已复制，去外卖平台搜同款'),
        });
    },

    /* ---------- 今日想喝 ---------- */

    openDrink() {
        this.setData({
            drinkVisible: true,
            drinkResult: null,
            drinkReel: [],
            drinkOffset: 0,
            drinkTransition: false,
            drinkAnimating: false,
        });
        this.startShakeWatch();
        this.rollDrink();
    },

    closeDrink() {
        this.clearDrinkTimers();
        this.stopShakeWatch();
        this.setData({ drinkVisible: false, drinkAnimating: false, drinkTransition: false });
    },

    setDrinkKind(event) {
        const kind = event.currentTarget.dataset.kind;
        if (!kind || kind === this.data.drinkKind) return;
        this.setData({ drinkKind: kind, drinkResult: null });
        this.rollDrink();
    },

    drinkPool() {
        const kind = this.data.drinkKind;
        const all = this.drinkBrands && this.drinkBrands.length ? this.drinkBrands : BRANDS;
        const pool = kind === '全部' ? all : all.filter((item) => item.kind === kind);
        return pool.length ? pool : all;
    },

    // 滚盘：轨道里塞一段随机品牌，最后一个才是结果，整段一起位移过去
    rollDrink() {
        if (this.data.drinkAnimating) return;
        const pool = this.drinkPool();
        const target = pool[Math.floor(Math.random() * pool.length)];
        const track = [];
        const pick = () => pool[Math.floor(Math.random() * pool.length)];
        // 品牌会重复出现，给每格一个唯一 key，避免 wx:for 复用错节点
        for (let i = 0; i < 16; i += 1) {
            track.push(Object.assign({}, pick(), { key: 'r' + i }));
        }
        track.push(Object.assign({}, target, { key: 'hit' }));
        // 末尾补一格垫底，停下时结果正好停在中线，下面不会露白
        track.push(Object.assign({}, pick(), { key: 'tail' }));

        this.clearDrinkTimers();
        // 先无过渡把轨道拨回顶部，下一帧再出发，否则首帧不会动
        this.setData({ drinkReel: track, drinkOffset: 0, drinkTransition: false, drinkAnimating: true, drinkResult: null });
        this.drinkStartTimer = setTimeout(() => {
            this.setData({ drinkTransition: true, drinkOffset: (track.length - 2) * DRINK_ITEM_RPX });
        }, 60);
        this.drinkStopTimer = setTimeout(() => {
            this.setData({ drinkAnimating: false, drinkResult: target });
            if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
        }, 60 + DRINK_ROLL_MS);
    },

    copyDrinkName() {
        const result = this.data.drinkResult;
        if (!result) return;
        wx.setClipboardData({
            data: result.name + ' ' + result.star,
            success: () => toast('已复制，去外卖平台搜同款'),
        });
    },

    // 真机摇一摇：加速度合值超过阈值就重摇一次
    startShakeWatch() {
        if (this.shakeHandler) return;
        this.shakeHandler = (res) => {
            if (!this.data.drinkVisible || this.data.drinkAnimating) return;
            const power = Math.abs(res.x) + Math.abs(res.y) + Math.abs(res.z);
            if (power > 2.8) this.rollDrink();
        };
        wx.startAccelerometer({ interval: 'normal', success: () => {} });
        wx.onAccelerometerChange(this.shakeHandler);
    },

    stopShakeWatch() {
        if (!this.shakeHandler) return;
        if (wx.offAccelerometerChange) wx.offAccelerometerChange(this.shakeHandler);
        if (wx.stopAccelerometer) wx.stopAccelerometer({});
        this.shakeHandler = null;
    },

    clearDrinkTimers() {
        if (this.drinkStartTimer) {
            clearTimeout(this.drinkStartTimer);
            this.drinkStartTimer = null;
        }
        if (this.drinkStopTimer) {
            clearTimeout(this.drinkStopTimer);
            this.drinkStopTimer = null;
        }
    },
});
