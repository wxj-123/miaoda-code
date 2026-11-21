const api = require('../../utils/api');
const { toast } = require('../../utils/util');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

Page({
    data: {
        loading: true,
        error: '',
        kind: 'post',
        id: 0,

        title: '',
        rejectReason: '',
        verdict: null,
        appealLeft: 0,
        appealLimit: 3,
        pending: null,
        history: [],

        content: {},
        mediaView: [],
        uploading: false,

        reason: '',
        submitting: false,
        dirty: false,
    },

    onLoad(query) {
        const kind = query.kind === 'recipe' ? 'recipe' : 'post';
        const id = Number(query.id) || 0;
        this.setData({ kind: kind, id: id });
        wx.setNavigationBarTitle({ title: kind === 'recipe' ? '修改菜谱 · 申诉' : '修改帖子 · 申诉' });
        this.load();
    },

    async load() {
        this.setData({ loading: true, error: '' });
        const result = await api.getAppealContext(this.data.kind, this.data.id);
        this.setData({ loading: false });
        if (result.error) {
            this.setData({ error: result.error });
            return;
        }
        const data = result.data;
        const content = data.content || {};
        this.original = clone(content);
        this.setData({
            title: data.title || '',
            rejectReason: data.reject_reason || '',
            verdict: data.verdict || null,
            appealLeft: data.appeal_left || 0,
            appealLimit: data.appeal_limit || 3,
            pending: data.pending_appeal || null,
            history: data.history || [],
            content: content,
            mediaView: content.mediaView || [],
            reason: '',
            dirty: false,
        });
    },

    /* ---------- 帖子字段 ---------- */

    onTitleInput(event) {
        this.setData({ 'content.title': event.detail.value, dirty: true });
    },

    onBodyInput(event) {
        this.setData({ 'content.content': event.detail.value, dirty: true });
    },

    previewImage(event) {
        const urls = this.data.mediaView.filter(Boolean);
        if (!urls.length) return;
        wx.previewImage({ current: urls[event.currentTarget.dataset.index], urls: urls });
    },

    removeImage(event) {
        const index = Number(event.currentTarget.dataset.index);
        const media = (this.data.content.media || []).slice();
        const mediaView = this.data.mediaView.slice();
        media.splice(index, 1);
        mediaView.splice(index, 1);
        this.setData({ 'content.media': media, mediaView: mediaView, dirty: true });
    },

    chooseImage() {
        const remain = 9 - (this.data.content.media || []).length;
        if (remain <= 0) {
            toast('最多 9 张图片');
            return;
        }
        wx.chooseMedia({
            count: remain,
            mediaType: ['image'],
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: async (res) => {
                const files = res.tempFiles || [];
                if (!files.length) return;
                this.setData({ uploading: true });
                const media = (this.data.content.media || []).slice();
                const views = this.data.mediaView.slice();
                for (let i = 0; i < files.length; i += 1) {
                    const uploaded = await api.uploadImage(files[i].tempFilePath);
                    if (uploaded.error) {
                        toast(uploaded.error);
                        break;
                    }
                    const urls = await api.resolveMedia([uploaded.data]);
                    media.push(uploaded.data);
                    views.push(urls[0] || '');
                }
                this.setData({ uploading: false, 'content.media': media, mediaView: views, dirty: true });
            },
        });
    },

    /* ---------- 菜谱字段 ---------- */

    onNameInput(event) {
        this.setData({ 'content.name': event.detail.value, dirty: true });
    },

    onSummaryInput(event) {
        this.setData({ 'content.summary': event.detail.value, dirty: true });
    },

    onMaterialInput(event) {
        const { index, field } = event.currentTarget.dataset;
        this.setData({ ['content.materials[' + index + '].' + field]: event.detail.value, dirty: true });
    },

    addMaterial() {
        const materials = (this.data.content.materials || []).concat([{ name: '', dosage: '' }]);
        this.setData({ 'content.materials': materials, dirty: true });
    },

    removeMaterial(event) {
        const index = Number(event.currentTarget.dataset.index);
        const materials = (this.data.content.materials || []).slice();
        if (materials.length <= 1) {
            toast('至少保留一项食材');
            return;
        }
        materials.splice(index, 1);
        this.setData({ 'content.materials': materials, dirty: true });
    },

    onStepInput(event) {
        const index = Number(event.currentTarget.dataset.index);
        this.setData({ ['content.steps[' + index + '].content']: event.detail.value, dirty: true });
    },

    addStep() {
        const steps = (this.data.content.steps || []).concat([{ content: '', img_url: '' }]);
        this.setData({ 'content.steps': steps, dirty: true });
    },

    removeStep(event) {
        const index = Number(event.currentTarget.dataset.index);
        const steps = (this.data.content.steps || []).slice();
        if (steps.length <= 1) {
            toast('至少保留一个步骤');
            return;
        }
        steps.splice(index, 1);
        this.setData({ 'content.steps': steps, dirty: true });
    },

    /* ---------- 申诉说明 ---------- */

    onReasonInput(event) {
        this.setData({ reason: event.detail.value });
    },

    changed() {
        const current = clone(this.data.content);
        delete current.mediaView;
        const original = clone(this.original || {});
        delete original.mediaView;
        return JSON.stringify(current) !== JSON.stringify(original);
    },

    validate(kind) {
        const content = this.data.content;
        if (this.data.kind === 'post') {
            if (!String(content.title || '').trim()) return '标题不能为空';
            if (!String(content.content || '').trim()) return '正文不能为空';
        } else {
            if (!String(content.name || '').trim()) return '菜名不能为空';
            if (!(content.materials || []).some((item) => String(item.name || '').trim())) return '至少写一项食材';
            if (!(content.steps || []).some((item) => String(item.content || '').trim())) return '至少写一个步骤';
        }
        if (kind === 'appeal' && !this.data.reason.trim()) {
            return '内容没改动的话，请写一句申诉说明';
        }
        return '';
    },

    async submit(event) {
        if (this.data.submitting || this.data.uploading) return;
        const mode = event.currentTarget.dataset.mode || 'resubmit';

        if (this.data.pending) {
            toast('已有一条申诉在处理中');
            return;
        }
        if (this.data.appealLeft <= 0) {
            toast('申诉次数已用完');
            return;
        }

        if (mode === 'resubmit' && !this.changed()) {
            toast('内容还没改动：改完再提交，或者点「仅申诉」');
            return;
        }

        const message = this.validate(mode);
        if (message) {
            toast(message);
            return;
        }

        const payload = {
            target_type: this.data.kind,
            target_id: this.data.id,
            reason: this.data.reason.trim(),
        };
        if (mode === 'resubmit') {
            const content = clone(this.data.content);
            delete content.mediaView;
            payload.content = content;
        }

        this.setData({ submitting: true });
        const result = await api.submitAppeal(payload);
        this.setData({ submitting: false });
        if (result.error) {
            toast(result.error);
            return;
        }

        const data = result.data || {};
        if (mode === 'appeal') {
            wx.showModal({
                title: '申诉已提交',
                content: '审核员会重新看一遍这条内容，结果会出现在「我的 - 我的发布」里。',
                showCancel: false,
                confirmText: '知道了',
                confirmColor: '#ef4e19',
                success: () => wx.navigateBack(),
            });
            return;
        }

        const decision = (data.audit && data.audit.decision) || data.decision;
        if (decision === 'pass') {
            wx.showModal({
                title: '已重新发布',
                content: '修改后的内容通过了自动审核，现在已经出现在社区里。',
                showCancel: false,
                confirmText: '太好了',
                confirmColor: '#ef4e19',
                success: () => wx.navigateBack(),
            });
            return;
        }

        if (decision === 'reject') {
            const audit = data.audit || {};
            wx.showModal({
                title: '还是没通过',
                content: (audit.reasons || []).join('；') + (audit.hint ? '\n' + audit.hint : '') || data.message || '内容仍不符合社区规范',
                showCancel: false,
                confirmText: '继续修改',
                confirmColor: '#ef4e19',
                success: () => this.load(),
            });
            return;
        }

        wx.showModal({
            title: '已进入人工复核',
            content: '内容已更新，审核员会尽快确认，通过后自动上线。',
            showCancel: false,
            confirmText: '好的',
            confirmColor: '#ef4e19',
            success: () => wx.navigateBack(),
        });
    },
});
