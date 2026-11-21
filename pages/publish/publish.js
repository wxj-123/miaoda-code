Page({
    data: {
        user: null,
        checked: false,
    },

    onShow() {
        const user = getApp().getUser();
        if (user) {
            this.setData({ user: user, checked: true });
            return;
        }
        getApp().ensureSession().then((result) => {
            const session = result.error ? null : result.session;
            this.setData({ user: session ? session.user : null, checked: true });
        });
    },

    // 未登录时先解释一句再引导，不直接把用户甩到别的 tab
    needLogin() {
        if (this.data.user) return false;
        wx.showModal({
            title: '还没登录',
            content: '登录后才能发布内容，发布记录也会存进「我的发布」。现在去登录？',
            confirmText: '去登录',
            confirmColor: '#ff6b35',
            success: (res) => {
                if (res.confirm) wx.switchTab({ url: '/pages/mine/mine' });
            },
        });
        return true;
    },

    goLogin() {
        wx.switchTab({ url: '/pages/mine/mine' });
    },

    goRecipe() {
        if (this.needLogin()) return;
        wx.navigateTo({ url: '/pages/recipe/edit/edit' });
    },

    goPost() {
        if (this.needLogin()) return;
        wx.navigateTo({ url: '/pages/post/edit/edit' });
    },

    goMine() {
        wx.switchTab({ url: '/pages/mine/mine' });
    },
});
