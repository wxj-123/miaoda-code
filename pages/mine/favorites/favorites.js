const api = require('../../../utils/api');

Page({
    data: {
        loading: true,
        list: [],
    },

    onShow() {
        this.load();
    },

    async load() {
        this.setData({ loading: true });
        const result = await api.listFavorites();
        this.setData({ loading: false, list: result.data || [] });
    },

    goDetail(event) {
        const dataset = event.currentTarget.dataset;
        if (dataset.kind === 'recipe') {
            wx.navigateTo({ url: '/pages/recipe/detail/detail?id=' + dataset.id });
            return;
        }
        wx.navigateTo({ url: '/pages/post/detail/detail?id=' + dataset.id });
    },

    goHome() {
        wx.switchTab({ url: '/pages/index/index' });
    },
});
