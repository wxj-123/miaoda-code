const api = require('../../utils/api');

Page({
    data: {
        tab: 'interaction',
        signedIn: false,
        loading: true,
        interactions: [],
        audits: [],
        notices: [],
    },

    onShow() {
        this.restore();
    },

    async restore() {
        this.setData({ loading: true });
        const result = await getApp().ensureSession();
        const session = result.error ? null : result.session;
        this.setData({ signedIn: !!session });
        const notices = await api.listNotices();
        const signedIn = !!session;
        const [interactions, audits] = signedIn
            ? await Promise.all([api.listInteractions(), api.listAuditMessages()])
            : [{ data: [] }, { data: [] }];
        this.setData({
            loading: false,
            notices: notices.data || [],
            interactions: (interactions.data || []).map((item) =>
                Object.assign({}, item, { initial: (item.who || '食').slice(0, 1) })
            ),
            audits: audits.data || [],
        });
    },

    switchTab(event) {
        this.setData({ tab: event.currentTarget.dataset.tab });
    },

    goLogin() {
        wx.switchTab({ url: '/pages/mine/mine' });
    },

    goContent(event) {
        const dataset = event.currentTarget.dataset;
        const id = dataset.id;
        if (dataset.target === 'recipe') {
            wx.navigateTo({ url: '/pages/recipe/detail/detail?id=' + id });
            return;
        }
        wx.navigateTo({ url: '/pages/post/detail/detail?id=' + id });
    },

    goContents() {
        wx.navigateTo({ url: '/pages/mine/contents/contents' });
    },

    async onSubscribe() {
        const templates = await api.getSubscribeTemplates();
        if (!templates.length) {
            wx.showModal({
                title: '订阅提醒还没配置',
                content: '需要在微信公众平台申请「审核结果」「评论回复」订阅消息模板，把模板 ID 填进后台配置后才能推送。',
                showCancel: false,
                confirmText: '知道了',
                confirmColor: '#FF6B35',
            });
            return;
        }
        wx.requestSubscribeMessage({
            tmplIds: templates.slice(0, 3),
            success: (res) => {
                let accepted = false;
                Object.keys(res).forEach((key) => {
                    if (res[key] === 'accept') accepted = true;
                });
                wx.showToast({ title: accepted ? '已开启提醒' : '已取消', icon: 'none' });
            },
            fail: () => {
                wx.showToast({ title: '订阅失败，请稍后再试', icon: 'none' });
            },
        });
    },

    showNotice(event) {
        const index = Number(event.currentTarget.dataset.index);
        const notice = this.data.notices[index];
        if (!notice) return;
        wx.showModal({
            title: notice.title,
            content: notice.content || '',
            showCancel: false,
            confirmText: '知道了',
            confirmColor: '#FF6B35',
        });
    },
});
