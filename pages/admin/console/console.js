const api = require('../../../utils/api');
const { AUDIT_TEXT } = require('../../../utils/constants');
const { toast, confirm, formatCount, formatRelative, initial } = require('../../../utils/util');

const TABS = [
    { key: 'audit', label: '审核' },
    { key: 'appeal', label: '申诉' },
    { key: 'report', label: '举报' },
    { key: 'content', label: '内容' },
    { key: 'user', label: '用户' },
    { key: 'notice', label: '公告' },
    { key: 'word', label: '词库' },
];

/* 每个板块一句话说明：管理员不看文档也知道这里在管什么 */
const TAB_HINT = {
    audit: '新提交的菜谱和帖子在这里排队，通过后立刻对外可见。',
    appeal: '用户对驳回结果有异议的申诉单，通过即恢复上线。',
    report: '用户举报的工单，处理后举报人会收到结果通知。',
    content: '全站已发布内容，可以置顶推荐或下架违规条目。',
    user: '发过内容的账号，封禁后无法再发布或评论。',
    notice: '首页公告条，发布后立即展示给所有用户。',
    word: '命中的内容会在提交时被服务端直接拒绝，客户端绕不过去。',
};

const STATUS_CLASS = { 0: 's-draft', 1: 's-review', 2: 's-pass', 3: 's-reject' };

const AUDIT_FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'recipe', label: '菜谱' },
    { key: 'post', label: '帖子' },
];

const REPORT_FILTERS = [
    { key: 'pending', label: '待处理' },
    { key: 'done', label: '已处理' },
    { key: 'all', label: '全部' },
];

const CONTENT_FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'reviewing', label: '待审' },
    { key: 'passed', label: '已通过' },
    { key: 'rejected', label: '已驳回' },
];

/* ---------- 数据装饰：把后端字段整理成模板直接能用的形状 ---------- */

function decoratePending(list) {
    return (list || []).map((row) =>
        Object.assign({}, row, {
            kindClass: row.kind === 'recipe' ? 'k-recipe' : 'k-post',
            excerpt: row.summary || row.content || '',
            initial: initial(row.owner_name, '?'),
            timeText: row.timeText || formatRelative(row.created_at),
        })
    );
}

function decorateReports(list) {
    return (list || [])
        .map((row) => {
            const status = Number(row.status) === 1 ? 1 : 0;
            return Object.assign({}, row, {
                status: status,
                statusClass: status === 0 ? 's-review' : 's-pass',
            });
        })
        .sort((a, b) => (a.status === b.status ? 0 : a.status === 0 ? -1 : 1));
}

function decorateContents(list) {
    return (list || []).map((row) => {
        const audit = Number(row.audit_status);
        return Object.assign({}, row, {
            auditStatus: audit,
            statusClass: STATUS_CLASS[audit] || 's-draft',
            statusText: AUDIT_TEXT[audit] || '',
            initial: initial(row.owner_name, '?'),
        });
    });
}

function decorateAuthors(list) {
    return (list || []).map((row) =>
        Object.assign({}, row, {
            initial: initial(row.name, '食'),
            banned: !!row.banned,
        })
    );
}

function decorateNotices(list) {
    return (list || []).map((row) =>
        Object.assign({}, row, {
            statusClass: row.is_active ? 's-pass' : 's-draft',
            timeText: formatRelative(row.created_at || row.updated_at),
        })
    );
}

/* 申诉单：把后端字段整理成卡片能直接渲染的形状 */
function decorateAppeals(list) {
    return (list || []).map((row) => {
        const current = row.current || {};
        return Object.assign({}, row, {
            initial: initial(row.owner_name, '审'),
            kindText: row.target_text || (row.target_type === 'recipe' ? '菜谱' : '帖子'),
            timeText: formatRelative(row.created_at),
            currentText: current.content || '',
            roundText: row.rounds > 1 ? '第 ' + row.rounds + ' 次申诉' : '首次申诉',
            autoText: row.auto ? '系统自动判定' : '用户主动申诉',
        });
    });
}

/* 纯函数：根据原始数据和当前筛选条件，算出所有视图和统计
   状态字段做容错读取，避免某处漏装饰时静默失效 */
function buildViews(d) {
    const pending = d.pending || [];
    const reports = d.reports || [];
    const recipes = d.recipes || [];
    const posts = d.posts || [];
    const authors = d.authors || [];
    const appeals = d.appeals || [];

    const auditOf = (row) => (row.auditStatus === undefined ? Number(row.audit_status) : row.auditStatus);
    const reportOf = (row) => (Number(row.status) === 1 ? 1 : 0);

    const auditFilter = d.auditFilter || 'all';
    const pendingView = auditFilter === 'all' ? pending : pending.filter((row) => row.kind === auditFilter);

    const reportFilter = d.reportFilter || 'all';
    const reportView = reports.filter((row) => {
        if (reportFilter === 'all') return true;
        return reportFilter === 'pending' ? reportOf(row) === 0 : reportOf(row) !== 0;
    });

    const contentFilter = d.contentFilter || 'all';
    const statusMatch = {
        all: () => true,
        reviewing: (row) => auditOf(row) === 1,
        passed: (row) => auditOf(row) === 2,
        rejected: (row) => auditOf(row) === 3,
    };
    const match = statusMatch[contentFilter] || statusMatch.all;
    const recipeView = recipes.filter(match);
    const postView = posts.filter(match);

    const keyword = String(d.userKeyword || '').trim();
    const authorView = keyword
        ? authors.filter((row) => String(row.name || '').indexOf(keyword) >= 0)
        : authors;

    const pendingReports = reports.filter((row) => reportOf(row) === 0).length;
    const contentTotal = recipes.length + posts.length;
    const count = (list, fn) => list.filter(fn).length;

    const num = (value) => formatCount(value);
    const badge = (value) => (value > 99 ? '99+' : String(value));

    return {
        pendingView: pendingView,
        reportView: reportView,
        recipeView: recipeView,
        postView: postView,
        authorView: authorView,
        appealView: appeals,
        appealCount: appeals.length,

        auditCounts: {
            all: pending.length,
            recipe: count(pending, (row) => row.kind === 'recipe'),
            post: count(pending, (row) => row.kind === 'post'),
        },
        reportCounts: {
            all: reports.length,
            pending: pendingReports,
            done: reports.length - pendingReports,
        },
        contentCounts: {
            all: contentTotal,
            reviewing: count(recipes, (r) => auditOf(r) === 1) + count(posts, (r) => auditOf(r) === 1),
            passed: count(recipes, (r) => auditOf(r) === 2) + count(posts, (r) => auditOf(r) === 2),
            rejected: count(recipes, (r) => auditOf(r) === 3) + count(posts, (r) => auditOf(r) === 3),
        },

        stats: {
            pending: pending.length,
            pendingText: num(pending.length),
            reports: pendingReports,
            reportsText: num(pendingReports),
            contents: contentTotal,
            contentsText: num(contentTotal),
            users: authors.length,
            usersText: num(authors.length),
        },

        badge: {
            audit: pending.length,
            auditText: badge(pending.length),
            report: pendingReports,
            reportText: badge(pendingReports),
            appeal: appeals.length,
            appealText: badge(appeals.length),
        },

        heroTitle: pending.length ? '还有 ' + pending.length + ' 项内容等你审' : '待审池已清空',
        heroSub: appeals.length
            ? '另有 ' + appeals.length + ' 条申诉待处理'
            : pendingReports
            ? '另外有 ' + pendingReports + ' 条举报待处理'
            : '没有待处理的举报工单',
    };
}

function nowText() {
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

Page({
    data: {
        tabs: TABS,
        tab: 'audit',
        tabHint: TAB_HINT.audit,

        checking: true,
        isAdmin: false,
        loading: true,
        acting: false,
        refreshedAt: '',

        auditFilters: AUDIT_FILTERS,
        reportFilters: REPORT_FILTERS,
        contentFilters: CONTENT_FILTERS,
        auditFilter: 'all',
        reportFilter: 'pending',
        contentFilter: 'all',
        userKeyword: '',

        stats: { pending: 0, pendingText: '0', reports: 0, reportsText: '0', contents: 0, contentsText: '0', users: 0, usersText: '0' },
        badge: { audit: 0, auditText: '0', report: 0, reportText: '0', appeal: 0, appealText: '0' },
        auditCounts: { all: 0, recipe: 0, post: 0 },
        reportCounts: { all: 0, pending: 0, done: 0 },
        contentCounts: { all: 0, reviewing: 0, passed: 0, rejected: 0 },
        heroTitle: '',
        heroSub: '',

        pending: [],
        reports: [],
        recipes: [],
        posts: [],
        authors: [],
        notices: [],
        words: [],
        appeals: [],
        pendingView: [],
        reportView: [],
        recipeView: [],
        postView: [],
        authorView: [],
        appealView: [],
        appealCount: 0,

        newWord: '',
        noticeTitle: '',
        noticeContent: '',
        noticeLen: 0,
        canNotice: false,
        auditText: AUDIT_TEXT,
    },

    onShow() {
        this.restore();
    },

    onPullDownRefresh() {
        this.restore(true);
    },

    /* 统一提交：数据 patch + 视图重建一次 setData 完成 */
    commit(patch) {
        const next = Object.assign({}, this.data, patch);
        this.setData(Object.assign({}, patch, buildViews(next)));
    },

    async restore(silent) {
        if (!silent) this.setData({ checking: true });
        const admin = await api.isAdmin();
        this.setData({ isAdmin: admin, checking: false });
        if (!admin) {
            wx.stopPullDownRefresh();
            return;
        }
        await this.loadOverview();
        wx.stopPullDownRefresh();
    },

    /* 首屏一次性拉全量数据，填满概览数字和角标 */
    async loadOverview() {
        this.setData({ loading: true });
        const [pending, reports, recipes, posts, authors, appeals] = await Promise.all([
            api.listPending(),
            api.listReports(),
            api.listAllRecipes(),
            api.listAllPosts(),
            api.listAuthors(),
            api.listAdminAppeals(0),
        ]);
        const error = [pending, reports, recipes, posts, authors].map((res) => res && res.error).filter(Boolean)[0];

        this.commit({
            pending: decoratePending(pending.data || []),
            reports: decorateReports(reports.data || []),
            recipes: decorateContents(recipes.data || []),
            posts: decorateContents(posts.data || []),
            authors: decorateAuthors(authors.data || []),
            appeals: decorateAppeals(appeals.data || []),
            loading: false,
            refreshedAt: nowText(),
        });

        if (error) toast(error);
    },

    switchTab(event) {
        const tab = event.currentTarget.dataset.tab;
        if (!tab) return;
        /* 点同一个 tab 视为刷新，符合后台操作的直觉 */
        if (tab === this.data.tab) {
            this.loadTab(tab, true);
            return;
        }
        this.setData({ tab: tab, tabHint: TAB_HINT[tab] || '' });
        this.loadTab(tab, true);
    },

    /* silent = 后台静默刷新，不显示骨架，避免切换时闪一下 */
    async loadTab(tab, silent) {
        if (!silent) this.setData({ loading: true });

        if (tab === 'audit') {
            const res = await api.listPending();
            this.commit({ pending: decoratePending(res.data || []), loading: false, refreshedAt: nowText() });
            if (res.error) toast(res.error);
        } else if (tab === 'appeal') {
            const res = await api.listAdminAppeals(0);
            this.commit({ appeals: decorateAppeals(res.data || []), loading: false, refreshedAt: nowText() });
            if (res.error) toast(res.error);
        } else if (tab === 'report') {
            const res = await api.listReports();
            this.commit({ reports: decorateReports(res.data || []), loading: false, refreshedAt: nowText() });
            if (res.error) toast(res.error);
        } else if (tab === 'content') {
            const [recipes, posts] = await Promise.all([api.listAllRecipes(), api.listAllPosts()]);
            this.commit({
                recipes: decorateContents(recipes.data || []),
                posts: decorateContents(posts.data || []),
                loading: false,
                refreshedAt: nowText(),
            });
            const error = recipes.error || posts.error;
            if (error) toast(error);
        } else if (tab === 'user') {
            const res = await api.listAuthors();
            this.commit({ authors: decorateAuthors(res.data || []), loading: false, refreshedAt: nowText() });
            if (res.error) toast(res.error);
        } else if (tab === 'notice') {
            const res = await api.listNoticesAll();
            this.commit({ notices: decorateNotices(res.data || []), loading: false, refreshedAt: nowText() });
            if (res.error) toast(res.error);
        } else if (tab === 'word') {
            const res = await api.listWords();
            this.commit({ words: res.data || [], loading: false, refreshedAt: nowText() });
            if (res.error) toast(res.error);
        }
    },

    refresh() {
        if (this.data.loading) return;
        this.loadTab(this.data.tab, false);
    },

    /* ---------- 筛选 ---------- */

    onAuditFilter(event) {
        this.commit({ auditFilter: event.currentTarget.dataset.key });
    },

    onReportFilter(event) {
        this.commit({ reportFilter: event.currentTarget.dataset.key });
    },

    onContentFilter(event) {
        this.commit({ contentFilter: event.currentTarget.dataset.key });
    },

    onUserKeyword(event) {
        const userKeyword = event.detail.value;
        const keyword = String(userKeyword || '').trim();
        const authors = this.data.authors || [];
        this.setData({
            userKeyword: userKeyword,
            authorView: keyword ? authors.filter((row) => String(row.name || '').indexOf(keyword) >= 0) : authors,
        });
    },

    clearUserKeyword() {
        this.setData({ userKeyword: '', authorView: this.data.authors });
    },

    /* ---------- 审核 ---------- */

    async approve(event) {
        if (this.data.acting) return;
        const d = event.currentTarget.dataset;
        this.setData({ acting: true });
        const res = await api.moderate(d.kind, d.id, true, '');
        this.setData({ acting: false });
        if (res.error) {
            toast(res.error);
            return;
        }
        toast('已通过');
        this.loadTab('audit', true);
    },

    reject(event) {
        if (this.data.acting) return;
        const d = event.currentTarget.dataset;
        wx.showModal({
            title: '驳回理由',
            editable: true,
            placeholderText: '写清楚原因，作者会看到',
            confirmColor: '#FF6B35',
            success: async (modal) => {
                if (!modal.confirm) return;
                const reason = (modal.content || '').trim();
                if (!reason) {
                    toast('驳回理由必填');
                    return;
                }
                this.setData({ acting: true });
                const res = await api.moderate(d.kind, d.id, false, reason);
                this.setData({ acting: false });
                if (res.error) {
                    toast(res.error);
                    return;
                }
                toast('已驳回');
                this.loadTab('audit', true);
            },
        });
    },

    /* ---------- 申诉 ---------- */

    async approveAppeal(event) {
        if (this.data.acting) return;
        const d = event.currentTarget.dataset;
        const ok = await confirm('通过后这条内容会立刻恢复展示，确定吗？', '通过申诉');
        if (!ok) return;
        this.setData({ acting: true });
        const res = await api.handleAdminAppeal(d.id, true, '');
        this.setData({ acting: false });
        if (res.error) {
            toast(res.error);
            return;
        }
        toast('已恢复展示');
        this.loadTab('appeal', true);
    },

    rejectAppeal(event) {
        if (this.data.acting) return;
        const d = event.currentTarget.dataset;
        wx.showModal({
            title: '维持驳回',
            editable: true,
            placeholderText: '写清楚原因，用户会在申诉记录里看到',
            confirmColor: '#FF6B35',
            success: async (modal) => {
                if (!modal.confirm) return;
                const reply = (modal.content || '').trim();
                if (!reply) {
                    toast('请填写驳回说明');
                    return;
                }
                this.setData({ acting: true });
                const res = await api.handleAdminAppeal(d.id, false, reply);
                this.setData({ acting: false });
                if (res.error) {
                    toast(res.error);
                    return;
                }
                toast('已维持驳回');
                this.loadTab('appeal', true);
            },
        });
    },

    /* ---------- 举报 ---------- */

    async resolveReport(event) {
        if (this.data.acting) return;
        const d = event.currentTarget.dataset;
        const violate = d.result === '1';
        const ok = await confirm(
            violate ? '判定违规：内容将被下架，举报人收到处理结果。' : '判定合规：内容保留，举报工单关闭。',
            '处理举报'
        );
        if (!ok) return;
        wx.showModal({
            title: violate ? '下架备注' : '处理备注',
            editable: true,
            placeholderText: violate ? '例如：含引流广告' : '例如：内容正常，无需处理',
            confirmColor: '#FF6B35',
            success: async (modal) => {
                if (!modal.confirm) return;
                this.setData({ acting: true });
                const res = await api.handleReport(d.id, violate, (modal.content || '').trim());
                this.setData({ acting: false });
                if (res.error) {
                    toast(res.error);
                    return;
                }
                toast('已处理');
                this.loadTab('report', true);
            },
        });
    },

    /* ---------- 内容管理 ---------- */

    async contentAction(event) {
        if (this.data.acting) return;
        const d = event.currentTarget.dataset;
        const labels = { top: '置顶', untop: '取消置顶', takedown: '下架', restore: '恢复上架' };
        const ok = await confirm('确定' + (labels[d.action] || '操作') + '这条内容？', '内容管理');
        if (!ok) return;
        this.setData({ acting: true });
        const res = await api.adminContent(d.kind, d.id, d.action);
        this.setData({ acting: false });
        if (res.error) {
            toast(res.error);
            return;
        }
        toast('已' + (labels[d.action] || '处理'));
        this.loadTab('content', true);
    },

    /* ---------- 用户 ---------- */

    userAction(event) {
        if (this.data.acting) return;
        const d = event.currentTarget.dataset;
        const banned = d.banned === '1';
        wx.showModal({
            title: banned ? '解封账号' : '封禁账号',
            editable: !banned,
            placeholderText: banned ? '' : '填写封禁原因',
            content: banned ? '解封后该账号可以继续发布内容。' : '',
            confirmColor: '#FF6B35',
            success: async (modal) => {
                if (!modal.confirm) return;
                if (!banned && !(modal.content || '').trim()) {
                    toast('封禁需要填写原因');
                    return;
                }
                this.setData({ acting: true });
                const res = await api.adminUser(d.uid, banned ? 'unban' : 'ban', (modal.content || '').trim());
                this.setData({ acting: false });
                if (res.error) {
                    toast(res.error);
                    return;
                }
                toast(banned ? '已解封' : '已封禁');
                this.loadTab('user', true);
            },
        });
    },

    /* ---------- 公告 ---------- */

    onNoticeTitle(event) {
        const value = event.detail.value || '';
        this.setData({ noticeTitle: value, canNotice: !!value.trim() });
    },

    onNoticeContent(event) {
        const value = event.detail.value || '';
        this.setData({ noticeContent: value, noticeLen: value.length });
    },

    async createNotice() {
        if (this.data.acting) return;
        if (!this.data.noticeTitle.trim()) {
            toast('公告标题不能为空');
            return;
        }
        this.setData({ acting: true });
        const res = await api.adminNotice('create', 0, this.data.noticeTitle.trim(), this.data.noticeContent.trim(), true);
        this.setData({ acting: false });
        if (res.error) {
            toast(res.error);
            return;
        }
        this.commit({ noticeTitle: '', noticeContent: '', noticeLen: 0, canNotice: false });
        toast('已发布');
        this.loadTab('notice', true);
    },

    async noticeAction(event) {
        if (this.data.acting) return;
        const d = event.currentTarget.dataset;
        const active = d.active === '1' ? false : true;
        if (d.action === 'delete') {
            const ok = await confirm('删除这条公告？删除后无法恢复。', '公告管理');
            if (!ok) return;
        }
        this.setData({ acting: true });
        const res = await api.adminNotice(d.action, d.id, null, null, active);
        this.setData({ acting: false });
        if (res.error) {
            toast(res.error);
            return;
        }
        this.loadTab('notice', true);
    },

    /* ---------- 敏感词 ---------- */

    onWordInput(event) {
        this.setData({ newWord: event.detail.value });
    },

    async addWord() {
        if (this.data.acting) return;
        const word = this.data.newWord.trim();
        if (!word) {
            toast('请输入敏感词');
            return;
        }
        this.setData({ acting: true });
        const res = await api.adminWord('add', 0, word);
        this.setData({ acting: false });
        if (res.error) {
            toast(res.error);
            return;
        }
        this.setData({ newWord: '' });
        toast('已加入词库');
        this.loadTab('word', true);
    },

    async removeWord(event) {
        const word = event.currentTarget.dataset.word;
        const ok = await confirm('从词库移除「' + word + '」？', '敏感词');
        if (!ok) return;
        const res = await api.adminWord('remove', event.currentTarget.dataset.id, null);
        if (res.error) {
            toast(res.error);
            return;
        }
        this.loadTab('word', true);
    },

    /* ---------- 通用 ---------- */

    async claim() {
        const ok = await confirm('只有系统里还没有审核员时才能绑定。确定把当前账号设为审核员？', '绑定审核员');
        if (!ok) return;
        const res = await api.claimAdmin();
        if (res.error) {
            toast(res.error);
            return;
        }
        toast(res.data ? '已绑定为审核员' : '系统里已经有审核员了');
        this.restore();
    },

    goDetail(event) {
        const d = event.currentTarget.dataset;
        if (!d.id) return;
        if (d.kind === 'recipe') {
            wx.navigateTo({ url: '/pages/recipe/detail/detail?id=' + d.id });
            return;
        }
        wx.navigateTo({ url: '/pages/post/detail/detail?id=' + d.id });
    },
});
