const api = require('../../utils/api');
const { toast } = require('../../utils/util');

const HISTORY_KEY = 'search_history';

Page({
    data: {
        keyword: '',
        mode: 'recipe',
        history: [],
        hotWords: ['番茄炒蛋', '宫保鸡丁', '辣椒炒肉', '麻婆豆腐', '早餐', '减脂'],
        loading: false,
        searched: false,
        recipes: [],
        posts: [],
    },

    onLoad() {
        const history = wx.getStorageSync(HISTORY_KEY) || [];
        this.setData({ history: history });
        wx.setNavigationBarTitle({ title: '搜索' });
    },

    onInput(event) {
        this.setData({ keyword: event.detail.value });
    },

    onConfirm() {
        this.search(this.data.keyword);
    },

    tapWord(event) {
        this.setData({ keyword: event.currentTarget.dataset.word });
        this.search(event.currentTarget.dataset.word);
    },

    switchMode(event) {
        const mode = event.currentTarget.dataset.mode;
        this.setData({ mode: mode });
        if (this.data.searched) this.doSearch(this.data.keyword);
    },

    async search(rawKeyword) {
        const keyword = (rawKeyword || '').trim();
        if (!keyword) {
            toast('输入菜名或食材再搜');
            return;
        }
        this.saveHistory(keyword);
        this.setData({ keyword: keyword });
        this.doSearch(keyword);
    },

    async doSearch(keyword) {
        this.setData({ loading: true, searched: true });
        if (this.data.mode === 'recipe') {
            const result = await api.listRecipes({ keyword: keyword, pageSize: 20 });
            this.setData({
                loading: false,
                recipes: (result.data && result.data.list) || [],
            });
            return;
        }
        const result = await api.listPosts({ keyword: keyword, pageSize: 20 });
        this.setData({
            loading: false,
            posts: ((result.data && result.data.list) || []).map((item) =>
                Object.assign({}, item, { initial: (item.owner_name || '食').slice(0, 1) })
            ),
        });
    },

    saveHistory(keyword) {
        const history = [keyword].concat(this.data.history.filter((item) => item !== keyword)).slice(0, 8);
        this.setData({ history: history });
        wx.setStorageSync(HISTORY_KEY, history);
    },

    clearHistory() {
        this.setData({ history: [] });
        wx.removeStorageSync(HISTORY_KEY);
    },

    goPost(event) {
        wx.navigateTo({ url: '/pages/post/detail/detail?id=' + event.currentTarget.dataset.id });
    },
});
