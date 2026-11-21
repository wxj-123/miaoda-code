const api = require('../../../utils/api');
const { CUISINES, TASTES, MEALS, DIFFICULTIES, SORTS } = require('../../../utils/constants');

Page({
    data: {
        loading: true,
        error: '',
        list: [],
        page: 1,
        hasMore: true,
        loadingMore: false,
        sorts: SORTS,
        sort: 'latest',
        cuisines: ['不限'].concat(CUISINES),
        tastes: ['不限'].concat(TASTES),
        meals: ['不限'].concat(MEALS),
        difficulties: ['不限'].concat(DIFFICULTIES),
        filterVisible: false,
        filters: {
            cuisine: '不限',
            taste: '不限',
            meal: '不限',
            difficulty: '不限',
            takeaway: false,
            quick: false,
            maxTime: 0,
        },
        title: '全部菜谱',
        activeCount: 0,
    },

    onLoad(query) {
        const filters = Object.assign({}, this.data.filters);
        let title = '全部菜谱';
        if (query.cuisine) {
            filters.cuisine = decodeURIComponent(query.cuisine);
            title = filters.cuisine;
        }
        if (query.tag) {
            filters.tag = decodeURIComponent(query.tag);
            title = filters.tag;
        }
        if (query.quick === '1') {
            filters.quick = true;
            title = '快手菜';
        }
        if (query.takeaway === '1') {
            filters.takeaway = true;
            title = '适合外卖';
        }
        this.setData({ filters: filters, title: title });
        wx.setNavigationBarTitle({ title: title });
        this.reload();
    },

    onPullDownRefresh() {
        this.reload().then(() => wx.stopPullDownRefresh());
    },

    onReachBottom() {
        this.loadMore();
    },

    buildParams() {
        const f = this.data.filters;
        const params = { page: this.data.page, sort: this.data.sort };
        if (f.cuisine !== '不限') params.cuisine = f.cuisine;
        if (f.taste !== '不限') params.taste = f.taste;
        if (f.meal !== '不限') params.meal = f.meal;
        if (f.difficulty !== '不限') params.difficulty = f.difficulty;
        if (f.tag) params.tag = f.tag;
        if (f.takeaway) params.takeaway = true;
        if (f.quick) params.quick = true;
        if (f.maxTime > 0) params.maxTime = f.maxTime;
        return params;
    },

    countActive() {
        const f = this.data.filters;
        let count = 0;
        if (f.cuisine !== '不限') count += 1;
        if (f.taste !== '不限') count += 1;
        if (f.meal !== '不限') count += 1;
        if (f.difficulty !== '不限') count += 1;
        if (f.takeaway) count += 1;
        if (f.quick) count += 1;
        if (f.maxTime > 0) count += 1;
        return count;
    },

    async reload() {
        this.setData({ loading: true, error: '', page: 1 });
        const result = await api.listRecipes(this.buildParams());
        if (result.error) {
            this.setData({ loading: false, error: result.error, list: [], hasMore: false });
            return;
        }
        this.setData({
            loading: false,
            list: result.data.list,
            hasMore: result.data.hasMore,
            activeCount: this.countActive(),
        });
    },

    async loadMore() {
        if (this.data.loadingMore || !this.data.hasMore || this.data.loading) return;
        this.setData({ loadingMore: true, page: this.data.page + 1 });
        const result = await api.listRecipes(this.buildParams());
        this.setData({ loadingMore: false });
        if (result.error) {
            this.setData({ page: this.data.page - 1 });
            return;
        }
        this.setData({
            list: this.data.list.concat(result.data.list),
            hasMore: result.data.hasMore,
        });
    },

    switchSort(event) {
        const sort = event.currentTarget.dataset.sort;
        if (sort === this.data.sort) return;
        this.setData({ sort: sort });
        this.reload();
    },

    toggleFilter() {
        this.setData({ filterVisible: !this.data.filterVisible });
    },

    setFilter(event) {
        const { group, value } = event.currentTarget.dataset;
        const filters = Object.assign({}, this.data.filters);
        if (group === 'takeaway' || group === 'quick') {
            filters[group] = !filters[group];
        } else if (group === 'maxTime') {
            filters.maxTime = filters.maxTime === Number(value) ? 0 : Number(value);
        } else {
            filters[group] = value;
        }
        this.setData({ filters: filters });
        this.reload();
    },

    resetFilter() {
        this.setData({
            filters: {
                cuisine: '不限',
                taste: '不限',
                meal: '不限',
                difficulty: '不限',
                takeaway: false,
                quick: false,
                maxTime: 0,
                tag: '',
            },
        });
        this.reload();
    },

    goRoll() {
        wx.switchTab({ url: '/pages/index/index' });
    },
});
