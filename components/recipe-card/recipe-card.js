const { formatCount } = require('../../utils/util');

Component({
    properties: {
        item: { type: Object, value: {} },
        mode: { type: String, value: 'grid' },
        showMeta: { type: Boolean, value: true },
    },

    data: {
        collectText: '0',
        viewText: '0',
    },

    observers: {
        item(item) {
            if (!item) return;
            this.setData({
                collectText: formatCount(item.collect_count),
                viewText: formatCount(item.view_count),
            });
        },
    },

    methods: {
        onTap() {
            const item = this.data.item || {};
            if (!item.id) return;
            wx.navigateTo({ url: '/pages/recipe/detail/detail?id=' + item.id });
        },
    },
});
