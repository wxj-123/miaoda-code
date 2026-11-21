const api = require('../../../utils/api');
const { toast } = require('../../../utils/util');

Page({
    data: {
        uid: '',
        loading: true,
        error: '',
        author: null,
        tab: 'recipe',
        list: [],
    },

    onLoad(query) {
        const uid = query.uid || '';
        if (!uid) {
            this.setData({ loading: false, error: '缺少作者信息' });
            return;
        }
        this.setData({ uid: uid });
        this.load();
    },

    async load() {
        this.setData({ loading: true, error: '' });
        const result = await api.getAuthor(this.data.uid);
        if (result.error) {
            this.setData({ loading: false, error: result.error });
            return;
        }
        const author = result.data;
        author.initial = (author.name || '食').slice(0, 1);
        this.setData({
            loading: false,
            author: author,
            list: author.recipes,
        });
        wx.setNavigationBarTitle({ title: author.name });
    },

    switchTab(event) {
        const tab = event.currentTarget.dataset.tab;
        const author = this.data.author;
        if (!author) return;
        this.setData({ tab: tab, list: tab === 'recipe' ? author.recipes : author.posts });
    },

    async onFollow() {
        if (!getApp().requireLogin()) return;
        const result = await api.toggleFollow(this.data.uid);
        if (result.error) {
            toast(result.error);
            return;
        }
        const author = Object.assign({}, this.data.author, {
            following: result.data,
            fans: Math.max(0, this.data.author.fans + (result.data ? 1 : -1)),
        });
        this.setData({ author: author });
    },

    goDetail(event) {
        const dataset = event.currentTarget.dataset;
        if (dataset.kind === 'recipe') {
            wx.navigateTo({ url: '/pages/recipe/detail/detail?id=' + dataset.id });
            return;
        }
        wx.navigateTo({ url: '/pages/post/detail/detail?id=' + dataset.id });
    },
});
