const api = require('../../utils/api');
const { toast, confirm } = require('../../utils/util');

Page({
    data: {
        signedIn: false,
        loading: true,
        items: [],
        pendingCount: 0,
        newName: '',
        newDosage: '',
        adding: false,
    },

    onShow() {
        this.restore();
    },

    // 未登录不做无条件请求，先给出明确的登录引导
    async restore() {
        this.setData({ loading: true });
        const result = await getApp().ensureSession();
        const session = result.error ? null : result.session;
        if (!session) {
            this.setData({
                signedIn: false,
                loading: false,
                items: [],
                pendingCount: 0,
            });
            return;
        }
        this.setData({ signedIn: true });
        await this.load();
    },

    async load() {
        this.setData({ loading: true });
        const result = await api.listShopping();
        if (result.error) {
            this.setData({ loading: false, items: [], pendingCount: 0 });
            return;
        }
        const items = (result.data || []).map((item) =>
            Object.assign({}, item, { sourceText: item.source_recipe_name || '' })
        );
        this.setData({
            loading: false,
            items: items,
            pendingCount: items.filter((item) => !item.checked).length,
        });
    },

    goLogin() {
        wx.switchTab({ url: '/pages/mine/mine' });
    },

    onNameInput(event) {
        this.setData({ newName: event.detail.value });
    },

    onDosageInput(event) {
        this.setData({ newDosage: event.detail.value });
    },

    async addItem() {
        if (!this.data.signedIn) {
            this.goLogin();
            return;
        }
        const name = this.data.newName.trim();
        if (!name) {
            toast('写个食材名');
            return;
        }
        if (this.data.adding) return;
        this.setData({ adding: true });
        const result = await api.addShoppingItem(name, this.data.newDosage);
        this.setData({ adding: false });
        if (result.error) {
            toast(result.error);
            return;
        }
        this.setData({ newName: '', newDosage: '' });
        this.load();
    },

    async toggleItem(event) {
        const index = Number(event.currentTarget.dataset.index);
        const item = this.data.items[index];
        const result = await api.toggleShoppingItem(item.id, !item.checked);
        if (result.error) {
            toast(result.error);
            return;
        }
        const items = this.data.items.slice();
        items[index] = Object.assign({}, item, { checked: !item.checked });
        this.setData({ items: items, pendingCount: items.filter((row) => !row.checked).length });
    },

    async removeItem(event) {
        const index = Number(event.currentTarget.dataset.index);
        const item = this.data.items[index];
        const result = await api.removeShoppingItem(item.id);
        if (result.error) {
            toast(result.error);
            return;
        }
        const items = this.data.items.slice();
        items.splice(index, 1);
        this.setData({ items: items, pendingCount: items.filter((row) => !row.checked).length });
    },

    async clearAll() {
        if (!this.data.items.length) return;
        const ok = await confirm('清空整张买菜清单？');
        if (!ok) return;
        const result = await api.clearShopping();
        if (result.error) {
            toast(result.error);
            return;
        }
        this.setData({ items: [], pendingCount: 0 });
    },

    copyList() {
        if (!this.data.items.length) {
            toast('清单还是空的');
            return;
        }
        const lines = this.data.items.map(
            (item) => (item.checked ? '☑ ' : '☐ ') + item.name + (item.dosage ? ' ' + item.dosage : '')
        );
        wx.setClipboardData({
            data: '买菜清单\n' + lines.join('\n'),
            success: () => toast('清单已复制'),
        });
    },
});
