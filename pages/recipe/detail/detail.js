const api = require('../../../utils/api');
const { toast, confirm } = require('../../../utils/util');
const { openReport } = require('../../../utils/report');

// 评论头像取首字
function decorateComments(list) {
    return (list || []).map((item) =>
        Object.assign({}, item, { initial: (item.owner_name || '食').slice(0, 1) })
    );
}

Page({
    data: {
        id: 0,
        loading: true,
        error: '',
        recipe: null,
        comments: [],
        related: [],
        commentText: '',
        replyTo: null,
        submitting: false,
        isAuthor: false,
    },

    onLoad(query) {
        const id = Number(query.id || 0);
        this.setData({ id: id });
        if (!id) {
            this.setData({ loading: false, error: '缺少菜谱编号' });
            return;
        }
        this.load();
    },

    async load() {
        this.setData({ loading: true, error: '' });
        const [detail, comments] = await Promise.all([
            api.getRecipeDetail(this.data.id),
            api.listComments('recipe', this.data.id),
        ]);
        if (detail.error) {
            this.setData({ loading: false, error: detail.error });
            return;
        }
        const recipe = detail.data;
        recipe.initial = (recipe.owner_name || '食').slice(0, 1);
        const related = await api.listRecipes({ cuisine: recipe.cuisine, pageSize: 4 });
        const author = await api.isFollowing(recipe.owner_id);
        api.bumpView('recipe', this.data.id);
        this.setData({
            loading: false,
            recipe: recipe,
            comments: decorateComments(comments.data),
            related: (related.data && related.data.list ? related.data.list : []).filter((item) => item.id !== recipe.id).slice(0, 3),
            isAuthor: author,
            isOwner: recipe.owner_id === api.currentUid(),
        });
        wx.setNavigationBarTitle({ title: recipe.name });
    },

    /* ---------- 互动 ---------- */

    async onLike() {
        if (!getApp().requireLogin()) return;
        const result = await api.toggleLike('recipe', this.data.id);
        if (result.error) {
            toast(result.error);
            return;
        }
        const recipe = Object.assign({}, this.data.recipe, {
            liked: result.data,
            like_count: Math.max(0, (this.data.recipe.like_count || 0) + (result.data ? 1 : -1)),
        });
        this.setData({ recipe: recipe });
    },

    async onCollect() {
        if (!getApp().requireLogin()) return;
        const result = await api.toggleCollect('recipe', this.data.id);
        if (result.error) {
            toast(result.error);
            return;
        }
        const recipe = Object.assign({}, this.data.recipe, {
            collected: result.data,
            collect_count: Math.max(0, (this.data.recipe.collect_count || 0) + (result.data ? 1 : -1)),
        });
        this.setData({ recipe: recipe });
        toast(result.data ? '已收藏' : '已取消收藏');
    },

    copyName() {
        const recipe = this.data.recipe;
        if (!recipe) return;
        wx.setClipboardData({
            data: recipe.name,
            success: () => toast('菜名已复制，去外卖平台搜同款'),
        });
    },

    addToShopping() {
        const recipe = this.data.recipe;
        if (!recipe || !recipe.materials || recipe.materials.length === 0) {
            toast('这道菜没有食材清单');
            return;
        }
        if (!getApp().requireLogin()) return;
        confirm('把「' + recipe.name + '」的 ' + recipe.materials.length + ' 项食材加入买菜清单？', '加入买菜清单').then(
            async (ok) => {
                if (!ok) return;
                const result = await api.addShoppingItems(recipe.materials, recipe);
                if (result.error) {
                    toast(result.error);
                    return;
                }
                toast('已加入 ' + result.data + ' 项食材');
            }
        );
    },

    goShopping() {
        wx.navigateTo({ url: '/pages/shopping/shopping' });
    },

    async onFollow() {
        if (!getApp().requireLogin()) return;
        const result = await api.toggleFollow(this.data.recipe.owner_id);
        if (result.error) {
            toast(result.error);
            return;
        }
        this.setData({ isAuthor: result.data });
        toast(result.data ? '已关注' : '已取消关注');
    },

    goAuthor() {
        const recipe = this.data.recipe;
        if (!recipe || !recipe.owner_id || recipe.owner_id === 'official') {
            toast('这是编辑部官方菜谱');
            return;
        }
        wx.navigateTo({ url: '/pages/user/home/home?uid=' + recipe.owner_id + '&name=' + encodeURIComponent(recipe.owner_name || '') });
    },

    goCheckin() {
        if (!getApp().requireLogin()) return;
        wx.navigateTo({ url: '/pages/post/edit/edit?recipeId=' + this.data.id + '&recipeName=' + encodeURIComponent(this.data.recipe.name) });
    },

    /* ---------- 评论 ---------- */

    onCommentInput(event) {
        this.setData({ commentText: event.detail.value });
    },

    replyComment(event) {
        const dataset = event.currentTarget.dataset;
        this.setData({
            replyTo: { id: dataset.id, name: dataset.name || '这位食客' },
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
        const result = await api.addComment('recipe', this.data.id, content, parent ? parent.id : null);
        this.setData({ submitting: false });
        if (result.error) {
            toast(result.error);
            return;
        }
        this.setData({ commentText: '', replyTo: null });
        this.loadComments();
    },

    async loadComments() {
        const comments = await api.listComments('recipe', this.data.id);
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
        this.loadComments();
    },

    share() {
        wx.showToast({ title: '点右上角「···」可分享', icon: 'none' });
    },

    onReport() {
        openReport('recipe', this.data.id);
    },

    reportComment(event) {
        openReport('comment', event.currentTarget.dataset.id);
    },

    onShareAppMessage() {
        const recipe = this.data.recipe;
        return {
            title: recipe ? recipe.name + '｜今天吃什么' : '今天吃什么',
            path: '/pages/recipe/detail/detail?id=' + this.data.id,
        };
    },
});
