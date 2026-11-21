const api = require('../../../utils/api');
const { CUISINES, TASTES, DIFFICULTIES, MEALS, FORM_TAGS } = require('../../../utils/constants');
const { toast } = require('../../../utils/util');

Page({
    data: {
        cuisines: CUISINES,
        tastes: TASTES,
        difficulties: DIFFICULTIES,
        meals: MEALS,
        formTags: FORM_TAGS,
        tagList: FORM_TAGS.map((label) => ({ label: label, checked: false })),

        name: '',
        cuisineIndex: -1,
        region: '',
        tasteIndex: 0,
        difficultyIndex: 0,
        mealIndex: 1,
        costTime: '30',
        summary: '',
        tags: [],
        cover: '',
        coverView: '',

        materials: [{ name: '', dosage: '' }],
        steps: [{ content: '' }],

        uploading: false,
        submitting: false,
        agreed: false,
    },

    onNameInput(event) {
        this.setData({ name: event.detail.value });
    },

    onRegionInput(event) {
        this.setData({ region: event.detail.value });
    },

    onCostInput(event) {
        this.setData({ costTime: event.detail.value });
    },

    onSummaryInput(event) {
        this.setData({ summary: event.detail.value });
    },

    onCuisineChange(event) {
        this.setData({ cuisineIndex: Number(event.detail.value) });
    },

    onTasteChange(event) {
        this.setData({ tasteIndex: Number(event.detail.value) });
    },

    onDifficultyChange(event) {
        this.setData({ difficultyIndex: Number(event.detail.value) });
    },

    onMealChange(event) {
        this.setData({ mealIndex: Number(event.detail.value) });
    },

    toggleTag(event) {
        const tag = event.currentTarget.dataset.tag;
        const tagList = this.data.tagList.map((item) =>
            item.label === tag ? { label: item.label, checked: !item.checked } : item
        );
        const tags = tagList.filter((item) => item.checked).map((item) => item.label);
        this.setData({ tagList: tagList, tags: tags });
    },

    toggleAgree() {
        this.setData({ agreed: !this.data.agreed });
    },

    chooseCover() {
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: async (res) => {
                const file = (res.tempFiles || [])[0];
                if (!file) return;
                this.setData({ uploading: true });
                const result = await api.uploadImage(file.tempFilePath);
                if (result.error) {
                    this.setData({ uploading: false });
                    toast(result.error);
                    return;
                }
                const views = await api.resolveMedia([result.data]);
                this.setData({ uploading: false, cover: result.data, coverView: views[0] || '' });
            },
        });
    },

    removeCover() {
        this.setData({ cover: '', coverView: '' });
    },

    /* ---------- 食材 ---------- */

    addMaterial() {
        this.setData({ materials: this.data.materials.concat([{ name: '', dosage: '' }]) });
    },

    removeMaterial(event) {
        const index = Number(event.currentTarget.dataset.index);
        const materials = this.data.materials.slice();
        if (materials.length === 1) {
            toast('至少保留一项食材');
            return;
        }
        materials.splice(index, 1);
        this.setData({ materials: materials });
    },

    onMaterialInput(event) {
        const { index, field } = event.currentTarget.dataset;
        const materials = this.data.materials.slice();
        materials[Number(index)][field] = event.detail.value;
        this.setData({ materials: materials });
    },

    /* ---------- 步骤 ---------- */

    addStep() {
        this.setData({ steps: this.data.steps.concat([{ content: '' }]) });
    },

    removeStep(event) {
        const index = Number(event.currentTarget.dataset.index);
        const steps = this.data.steps.slice();
        if (steps.length === 1) {
            toast('至少保留一个步骤');
            return;
        }
        steps.splice(index, 1);
        this.setData({ steps: steps });
    },

    onStepInput(event) {
        const index = Number(event.currentTarget.dataset.index);
        const steps = this.data.steps.slice();
        steps[index].content = event.detail.value;
        this.setData({ steps: steps });
    },

    /* ---------- 提交 ---------- */

    validate() {
        if (!this.data.name.trim()) return '菜名不能为空';
        if (this.data.cuisineIndex < 0) return '选一个菜系';
        if (!this.data.materials.some((item) => item.name.trim())) return '至少写一项食材';
        if (!this.data.steps.some((item) => item.content.trim())) return '至少写一个步骤';
        if (!this.data.agreed) return '请先同意发布须知';
        return '';
    },

    async saveDraft() {
        this.submitForm(0);
    },

    async submitReview() {
        this.submitForm(1);
    },

    async submitForm(status) {
        if (this.data.submitting || this.data.uploading) return;
        if (status === 1) {
            const message = this.validate();
            if (message) {
                toast(message);
                return;
            }
        } else if (!this.data.name.trim()) {
            toast('草稿也要有菜名');
            return;
        }

        this.setData({ submitting: true });
        const tags = this.data.tags.slice();
        const result = await api.createRecipe({
            name: this.data.name,
            cuisine: CUISINES[this.data.cuisineIndex],
            region: this.data.region,
            taste: TASTES[this.data.tasteIndex],
            difficulty: DIFFICULTIES[this.data.difficultyIndex],
            meal_type: MEALS[this.data.mealIndex],
            cost_time: Number(this.data.costTime) || 30,
            summary: this.data.summary,
            tags: tags,
            fit_quick: tags.indexOf('快手菜') >= 0,
            fit_takeaway: tags.indexOf('适合外卖') >= 0,
            cover_img: this.data.cover,
            materials: this.data.materials,
            steps: this.data.steps,
            audit_status: status,
        });
        this.setData({ submitting: false });
        if (result.error) {
            toast(result.error);
            return;
        }

        if (status === 0) {
            wx.showModal({
                title: '已保存草稿',
                content: '草稿只保存在你的账号里，可以随时再提交。',
                showCancel: false,
                confirmText: '好的',
                confirmColor: '#FF6B35',
                success: () => wx.navigateBack(),
            });
            return;
        }

        const audit = (result.data && result.data.audit) || { decision: 'review' };
        const recipeId = result.data && result.data.id;
        if (audit.decision === 'pass') {
            wx.showModal({
                title: '已通过审核',
                content: '菜谱已经出现在菜谱库里了。',
                showCancel: false,
                confirmText: '太好了',
                confirmColor: '#FF6B35',
                success: () => wx.navigateBack(),
            });
            return;
        }
        if (audit.decision === 'reject') {
            const detail = (audit.reasons || []).join('；');
            wx.showModal({
                title: '没有通过审核',
                content: (detail ? detail + '。' : '') + (audit.hint || '内容不符合社区规范，可以修改后重新提交。'),
                cancelText: '稍后再说',
                confirmText: '去修改',
                confirmColor: '#FF6B35',
                success: (res) => {
                    if (res.confirm && recipeId) {
                        wx.redirectTo({ url: '/pages/appeal/appeal?kind=recipe&id=' + recipeId });
                        return;
                    }
                    wx.navigateBack();
                },
            });
            return;
        }
        wx.showModal({
            title: '已提交审核',
            content: '审核通过后会出现在菜谱库，可在「我的 - 我的发布」查看进度。',
            showCancel: false,
            confirmText: '好的',
            confirmColor: '#FF6B35',
            success: () => wx.navigateBack(),
        });
    },
});
