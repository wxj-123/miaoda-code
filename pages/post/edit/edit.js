const api = require('../../../utils/api');
const { toast } = require('../../../utils/util');

Page({
    data: {
        title: '',
        content: '',
        media: [],
        mediaView: [],
        video: '',
        videoView: '',
        uploadingVideo: false,
        uploading: false,
        submitting: false,
        agreed: false,
        recipeId: 0,
        recipeName: '',
    },

    onLoad(query) {
        if (query.recipeId) {
            this.setData({
                recipeId: Number(query.recipeId),
                recipeName: decodeURIComponent(query.recipeName || ''),
            });
        }
    },

    onTitleInput(event) {
        this.setData({ title: event.detail.value });
    },

    onContentInput(event) {
        this.setData({ content: event.detail.value });
    },

    toggleAgree() {
        this.setData({ agreed: !this.data.agreed });
    },

    removeRecipe() {
        this.setData({ recipeId: 0, recipeName: '' });
    },

    chooseImage() {
        const remain = 9 - this.data.media.length;
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
                const uploaded = [];
                for (let i = 0; i < files.length; i += 1) {
                    const result = await api.uploadImage(files[i].tempFilePath);
                    if (result.error) {
                        toast(result.error);
                        break;
                    }
                    uploaded.push(result.data);
                }
                const media = this.data.media.concat(uploaded);
                const views = await api.resolveMedia(media);
                this.setData({ uploading: false, media: media, mediaView: views });
            },
        });
    },

    removeImage(event) {
        const index = Number(event.currentTarget.dataset.index);
        const media = this.data.media.slice();
        const mediaView = this.data.mediaView.slice();
        media.splice(index, 1);
        mediaView.splice(index, 1);
        this.setData({ media: media, mediaView: mediaView });
    },

    previewImage(event) {
        const index = Number(event.currentTarget.dataset.index);
        const urls = this.data.mediaView.filter(Boolean);
        if (!urls.length) return;
        wx.previewImage({ current: this.data.mediaView[index], urls: urls });
    },

    chooseVideo() {
        if (this.data.video) {
            toast('一条帖子只能放一个视频');
            return;
        }
        wx.chooseMedia({
            count: 1,
            mediaType: ['video'],
            maxDuration: 60,
            camera: 'back',
            success: async (res) => {
                const file = (res.tempFiles || [])[0];
                if (!file) return;
                if (file.size > 20 * 1024 * 1024) {
                    toast('视频不能超过 20MB，请先压缩');
                    return;
                }
                this.setData({ uploadingVideo: true });
                const uploaded = await api.uploadVideo(file.tempFilePath, file.size);
                if (uploaded.error) {
                    this.setData({ uploadingVideo: false });
                    toast(uploaded.error);
                    return;
                }
                const views = await api.resolveMedia([uploaded.data]);
                this.setData({
                    uploadingVideo: false,
                    video: uploaded.data,
                    videoView: views[0] || '',
                });
            },
        });
    },

    removeVideo() {
        this.setData({ video: '', videoView: '' });
    },

    async submit() {
        if (this.data.submitting || this.data.uploading || this.data.uploadingVideo) return;
        if (!this.data.title.trim()) {
            toast('写个标题吧');
            return;
        }
        if (!this.data.content.trim()) {
            toast('说点什么再发');
            return;
        }
        if (!this.data.agreed) {
            toast('请先同意发布须知');
            return;
        }
        this.setData({ submitting: true });
        const result = await api.createPost({
            title: this.data.title,
            content: this.data.content,
            media: this.data.media,
            video_url: this.data.video || null,
            rel_recipe_id: this.data.recipeId || null,
        });
        this.setData({ submitting: false });
        if (result.error) {
            toast(result.error);
            return;
        }

        const audit = (result.data && result.data.audit) || { decision: 'review' };
        const postId = result.data && result.data.id;
        if (audit.decision === 'pass') {
            wx.showModal({
                title: '已发布',
                content: '内容通过了自动审核，已经出现在社区里。',
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
                    if (res.confirm && postId) {
                        wx.redirectTo({ url: '/pages/appeal/appeal?kind=post&id=' + postId });
                        return;
                    }
                    wx.navigateBack();
                },
            });
            return;
        }
        wx.showModal({
            title: '已提交审核',
            content: '审核通过后就会出现在社区里，可以在「我的 - 我的发布」查看进度。',
            showCancel: false,
            confirmText: '知道了',
            confirmColor: '#FF6B35',
            success: () => wx.navigateBack(),
        });
    },
});
