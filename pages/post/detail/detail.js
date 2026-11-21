const api = require('../../../utils/api');
const { toast, confirm, initial } = require('../../../utils/util');
const { openReport } = require('../../../utils/report');

function decorateComments(list) {
    return (list || []).map((item) => Object.assign({}, item, { initial: initial(item.owner_name) }));
}

Page({
    data: {
        id: 0,
        loading: true,
        error: '',
        post: null,
        comments: [],
        commentText: '',
        replyTo: null,
        submitting: false,
    },

    onLoad(query) {
        const id = Number(query.id || 0);
        this.setData({ id: id });
        if (!id) {
            this.setData({ loading: false, error: '缺少帖子编号' });
            return;
        }
        this.load();
    },

    async load() {
        this.setData({ loading: true, error: '' });
        const [detail, comments] = await Promise.all([
            api.getPostDetail(this.data.id),
            api.listComments('post', this.data.id),
        ]);
        if (detail.error) {
            this.setData({ loading: false, error: detail.error });
            return;
        }
        api.bumpView('post', this.data.id);
        const post = detail.data;
        post.initial = initial(post.owner_name);
        this.setData({ loading: false, post: post, comments: decorateComments(comments.data) });
        wx.setNavigationBarTitle({ title: detail.data.title });
    },

    previewImage(event) {
        const current = event.currentTarget.dataset.src;
        const urls = this.data.post.media.filter(Boolean);
        if (!urls.length) return;
        wx.previewImage({ current: current, urls: urls });
    },

    async onLike() {
        if (!getApp().requireLogin()) return;
        const result = await api.toggleLike('post', this.data.id);
        if (result.error) {
            toast(result.error);
            return;
        }
        this.setData({
            post: Object.assign({}, this.data.post, {
                liked: result.data,
                like_count: Math.max(0, (this.data.post.like_count || 0) + (result.data ? 1 : -1)),
            }),
        });
    },

    async onCollect() {
        if (!getApp().requireLogin()) return;
        const result = await api.toggleCollect('post', this.data.id);
        if (result.error) {
            toast(result.error);
            return;
        }
        this.setData({
            post: Object.assign({}, this.data.post, {
                collected: result.data,
                collect_count: Math.max(0, (this.data.post.collect_count || 0) + (result.data ? 1 : -1)),
            }),
        });
        toast(result.data ? '已收藏' : '已取消收藏');
    },

    goRecipe() {
        const recipe = this.data.post.recipe;
        if (!recipe) return;
        wx.navigateTo({ url: '/pages/recipe/detail/detail?id=' + recipe.id });
    },

    goAuthor(event) {
        const uid = event.currentTarget.dataset.uid;
        if (!uid || uid === 'official') {
            toast('来自编辑部');
            return;
        }
        wx.navigateTo({ url: '/pages/user/home/home?uid=' + uid });
    },

    onCommentInput(event) {
        this.setData({ commentText: event.detail.value });
    },

    replyComment(event) {
        this.setData({
            replyTo: { id: event.currentTarget.dataset.id, name: event.currentTarget.dataset.name || '这位食客' },
        });
    },

    cancelReply() {
        this.setData({ replyTo: null });
    },

    async submitComment() {
        const content = (this.data.commentText || '').trim();
        if (!content) {
            toast('写点什么再发吧');
            return;
        }
        if (!getApp().requireLogin()) return;
        if (this.data.submitting) return;
        this.setData({ submitting: true });
        const parent = this.data.replyTo;
        const result = await api.addComment('post', this.data.id, content, parent ? parent.id : null);
        this.setData({ submitting: false });
        if (result.error) {
            toast(result.error);
            return;
        }
        this.setData({ commentText: '', replyTo: null });
        const comments = await api.listComments('post', this.data.id);
        this.setData({ comments: decorateComments(comments.data) });
    },

    async removeComment(event) {
        const ok = await confirm('确定删除这条评论？');
        if (!ok) return;
        const result = await api.deleteComment(event.currentTarget.dataset.id);
        if (result.error) {
            toast(result.error);
            return;
        }
        const comments = await api.listComments('post', this.data.id);
        this.setData({ comments: decorateComments(comments.data) });
    },

    onShareAppMessage() {
        const post = this.data.post;
        return {
            title: post ? post.title : '今天吃什么',
            path: '/pages/post/detail/detail?id=' + this.data.id,
        };
    },

    onReport() {
        openReport('post', this.data.id);
    },

    reportComment(event) {
        openReport('comment', event.currentTarget.dataset.id);
    },
});
