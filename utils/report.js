const api = require('./api');
const { toast } = require('./util');

const REASONS = ['色情低俗', '广告引流', '抄袭侵权', '恶意引战', '违法违禁', '其他'];

function openReport(targetType, targetId) {
    if (!getApp().requireLogin()) return;
    wx.showActionSheet({
        itemList: REASONS,
        success: (res) => {
            const reason = REASONS[res.tapIndex];
            wx.showModal({
                title: '举报：' + reason,
                editable: true,
                placeholderText: '补充说明（选填），方便我们判断',
                confirmText: '提交举报',
                confirmColor: '#FF6B35',
                success: async (modal) => {
                    if (!modal.confirm) return;
                    const result = await api.submitReport(targetType, targetId, reason, (modal.content || '').trim());
                    if (result.error) {
                        toast(result.error);
                        return;
                    }
                    toast('已提交，我们会尽快处理');
                },
            });
        },
    });
}

module.exports = { openReport, REASONS };
