const api = require('../../../utils/api');
const { AUDIT_TEXT } = require('../../../utils/constants');

const TABS = [
    { key: 'all', label: '全部' },
    { key: '1', label: '审核中' },
    { key: '2', label: '已通过' },
    { key: '3', label: '已驳回' },
    { key: '0', label: '草稿' },
];

const STATUS_CLASS = { 0: 's-draft', 1: 's-review', 2: 's-pass', 3: 's-reject' };

Page({
    data: {
        tabs: TABS,
        tab: 'all',
        loading: true,
        all: [],
        list: [],
    },

    onShow() {
        this.load();
    },

    async load() {
        this.setData({ loading: true });
        const result = await api.listMyContents();
        const all = (result.data || []).map((item) => {
            const rejected = item.audit_status === 3;
            const pending = rejected && item.appeal_pending;
            const left = item.appeal_left === undefined ? 3 : item.appeal_left;
            return Object.assign({}, item, {
                statusText: pending ? '申诉中' : AUDIT_TEXT[item.audit_status] || '',
                statusClass: pending ? 's-review' : STATUS_CLASS[item.audit_status] || 's-draft',
                canAppeal: rejected && !pending && left > 0,
                appealPending: !!pending,
                actionText: pending ? '查看申诉进度' : left === 0 ? '申诉次数已用完' : '修改并重新提交',
            });
        });
        this.setData({ loading: false, all: all, list: this.filter(all, this.data.tab) });
    },

    filter(all, tab) {
        if (tab === 'all') return all;
        return all.filter((item) => String(item.audit_status) === tab);
    },

    switchTab(event) {
        const tab = event.currentTarget.dataset.tab;
        this.setData({ tab: tab, list: this.filter(this.data.all, tab) });
    },

    goDetail(event) {
        const dataset = event.currentTarget.dataset;
        // 已驳回的内容直接进"修改与申诉"页，避免打开一个自己也看不到的详情页
        if (Number(dataset.status) === 3) {
            this.goAppeal(dataset);
            return;
        }
        if (dataset.kind === 'recipe') {
            wx.navigateTo({ url: '/pages/recipe/detail/detail?id=' + dataset.id });
            return;
        }
        wx.navigateTo({ url: '/pages/post/detail/detail?id=' + dataset.id });
    },

    goAppeal(event) {
        const dataset = event.currentTarget ? event.currentTarget.dataset : event;
        wx.navigateTo({
            url: '/pages/appeal/appeal?kind=' + dataset.kind + '&id=' + dataset.id,
        });
    },
});
