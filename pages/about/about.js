const api = require('../../utils/api');
const { toast, confirm } = require('../../utils/util');

Page({
    data: {
        version: '1.0.0',
    },

    async claimAdmin() {
        if (!getApp().requireLogin()) return;
        const ok = await confirm('把当前账号绑定为系统审核员？仅当系统里还没有审核员时可用。', '开发者工具');
        if (!ok) return;
        const result = await api.claimAdmin();
        if (result.error) {
            toast(result.error);
            return;
        }
        toast(result.data ? '已绑定为审核员，可在「我的」进入内容审核' : '系统里已经有审核员了');
    },

    showAgreement() {
        wx.showModal({
            title: '用户协议与隐私说明',
            content:
                '本小程序为美食内容社区。你发布的菜谱与帖子会先经过审核再展示；我们对内容保留下架权利。我们仅收集完成登录所需的邮箱与你主动上传的内容，不向第三方出售个人信息。',
            showCancel: false,
            confirmText: '知道了',
            confirmColor: '#FF6B35',
        });
    },
});
