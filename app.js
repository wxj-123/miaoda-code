const api = require('./utils/api');

App({
    globalData: {
        appName: '今天吃什么',
        user: null,
        isAdmin: false,
        dataMode: api.dataMode,
    },

    onLaunch() {
        this.authReady = this.restoreSession();
    },

    async restoreSession() {
        try {
            const result = await api.getSession();
            const session = result.error ? null : result.session;
            this.globalData.user = session ? session.user : null;
            return { session: session, error: result.error || null };
        } catch (error) {
            this.globalData.user = null;
            return { session: null, error: { message: (error && error.message) || '登录状态获取失败' } };
        }
    },

    // 页面统一通过这里取会话，避免重复请求
    ensureSession() {
        if (!this.sessionPromise) {
            this.sessionPromise = this.restoreSession().then((result) => {
                if (result.error) this.sessionPromise = null;
                return result;
            });
        }
        return this.sessionPromise;
    },

    resetSession() {
        this.sessionPromise = null;
    },

    setUser(user) {
        this.globalData.user = user || null;
    },

    getUser() {
        return this.globalData.user;
    },

    requireLogin() {
        if (this.globalData.user) return true;
        wx.showToast({ title: '请先登录', icon: 'none' });
        setTimeout(() => {
            wx.switchTab({ url: '/pages/mine/mine' });
        }, 600);
        return false;
    },
});
