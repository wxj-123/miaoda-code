const api = require('../../utils/api');

// 头像只放姓氏首字，避免长昵称挤爆圆形
function decorate(list) {
    return (list || []).map((item) =>
        Object.assign({}, item, { initial: (item.owner_name || '食').slice(0, 1) })
    );
}

Page({
    data: {
        sort: 'latest',
        loading: true,
        error: '',
        list: [],
        page: 1,
        hasMore: true,
        loadingMore: false,
    },

    onLoad() {
        this.reload();
    },

    onShow() {
        // 发帖或审核状态变化后回到社区刷新
        if (this.needRefresh) {
            this.needRefresh = false;
            this.reload();
        }
    },

    onPullDownRefresh() {
        this.reload().then(() => wx.stopPullDownRefresh());
    },

    onReachBottom() {
        this.loadMore();
    },

    switchSort(event) {
        const sort = event.currentTarget.dataset.sort;
        if (sort === this.data.sort) return;
        this.setData({ sort: sort });
        this.reload();
    },

    async reload() {
        this.setData({ loading: true, error: '', page: 1 });
        const result = await api.listPosts({ sort: this.data.sort, page: 1, pageSize: 10 });
        if (result.error) {
            this.setData({ loading: false, error: result.error, list: [], hasMore: false });
            return;
        }
        this.setData({
            loading: false,
            list: decorate(result.data.list),
            hasMore: result.data.hasMore,
        });
    },

    async loadMore() {
        if (this.data.loadingMore || !this.data.hasMore || this.data.loading) return;
        this.setData({ loadingMore: true, page: this.data.page + 1 });
        const result = await api.listPosts({ sort: this.data.sort, page: this.data.page, pageSize: 10 });
        this.setData({ loadingMore: false });
        if (result.error) {
            this.setData({ page: this.data.page - 1 });
            return;
        }
        this.setData({
            list: this.data.list.concat(decorate(result.data.list)),
            hasMore: result.data.hasMore,
        });
    },

    goDetail(event) {
        wx.navigateTo({ url: '/pages/post/detail/detail?id=' + event.currentTarget.dataset.id });
    },

    goPublish() {
        wx.switchTab({ url: '/pages/publish/publish' });
    },
});
