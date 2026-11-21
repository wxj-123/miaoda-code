const api = require('../../utils/api');
const { toast, confirm, formatCount } = require('../../utils/util');

Page({
    data: {
        authState: 'checking',
        user: null,
        displayName: '',
        displayInitial: '',
        stats: { works: 0, favorites: 0, fans: 0 },
        creator: { view: '0', collect: '0' },
        isAdmin: false,
    },

    onShow() {
        this.restore();
    },

    async restore() {
        this.setData({ authState: 'checking' });
        const result = await getApp().ensureSession();
        if (result.error || !result.session) {
            getApp().resetSession();
            this.setData({ authState: 'signed-out', user: null });
            return;
        }
        const user = result.session.user;
        getApp().setUser(user);
        const name = user.name || (user.email ? user.email.split('@')[0] : '美食爱好者');
        this.setData({
            authState: 'signed-in',
            user: user,
            displayName: name,
            displayInitial: name.slice(0, 1),
        });
        this.loadStats();
    },

    async loadStats() {
        const [contents, favorites, admin] = await Promise.all([
            api.listMyContents(),
            api.listFavorites(),
            api.isAdmin(),
        ]);
        const uid = api.currentUid();
        const follows = await api.countFollows(uid);
        const list = contents.data || [];
        const view = list.reduce((sum, item) => sum + (item.view_count || 0), 0);
        const collect = list.reduce((sum, item) => sum + (item.collect_count || 0), 0);
        this.setData({
            isAdmin: admin,
            stats: {
                works: list.length,
                favorites: (favorites.data || []).length,
                fans: follows.fans,
            },
            creator: { view: formatCount(view), collect: formatCount(collect) },
        });
    },

    async onSignedIn() {
        getApp().resetSession();
        this.restore();
    },

    async signOut() {
        const ok = await confirm('确定退出登录？');
        if (!ok) return;
        await api.signOut();
        getApp().resetSession();
        getApp().setUser(null);
        this.setData({ authState: 'signed-out', user: null });
        toast('已退出');
    },

    goPage(event) {
        const path = event.currentTarget.dataset.path;
        if (!path) return;
        wx.navigateTo({
            url: path,
            fail: () => toast('页面暂未开放'),
        });
    },
});
