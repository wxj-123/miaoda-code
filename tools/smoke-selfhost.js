/* 自建服务接口的小程序客户端冒烟测试（Node 环境，模拟 wx.request）
 * 用法：node tools/smoke-selfhost.js [baseUrl]
 */
const http = require('http');
const path = require('path');
const { URL } = require('url');

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const storage = {};
const appState = { globalData: { user: null } };
let token = '';

function wxRequest(options) {
    const target = new URL(options.url);
    const body = options.method === 'GET' ? null : JSON.stringify(options.data || {});
    const headers = Object.assign({}, options.header || {});
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request(
        {
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            method: options.method || 'GET',
            headers: headers,
        },
        (res) => {
            let raw = '';
            res.on('data', (chunk) => (raw += chunk));
            res.on('end', () => {
                let data = raw;
                try {
                    data = JSON.parse(raw);
                } catch (error) {
                    // 保留原始文本
                }
                options.success({ statusCode: res.statusCode, data: data });
            });
        }
    );
    req.on('error', (error) => options.fail && options.fail(error));
    if (body) req.write(body);
    req.end();
}

global.wx = {
    request: wxRequest,
    login: (options) => options.success({ code: 'mock-code' }),
    getStorageSync: (key) => (storage[key] === undefined ? '' : storage[key]),
    setStorageSync: (key, value) => {
        storage[key] = value;
    },
    removeStorageSync: (key) => {
        delete storage[key];
    },
    showToast: () => {},
    uploadFile: (options) => options.fail && options.fail(new Error('skip upload in smoke')),
};

global.getApp = () => ({
    globalData: appState.globalData,
    setUser(user) {
        appState.globalData.user = user;
    },
    resetSession() {},
});

const api = require(path.resolve(__dirname, '../utils/api.js'));
const config = require(path.resolve(__dirname, '../utils/config.js'));

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}

async function main() {
    console.log('dataMode =', config.dataMode, '· base =', config.baseUrl);

    // 固定设备号 → 固定 uid，这样重复运行还是同一个账号（也是默认审核员账号）
    storage[config.deviceKey] = process.env.SMOKE_DEVICE || 'dev-machine-001';

    const login = await api.signInWithWechat();
    check('微信登录', !!login.data && !!login.data.id, login.error || (login.data && login.data.id));
    token = wx.getStorageSync(config.tokenKey);
    if (login.data) appState.globalData.user = login.data;

    const session = await api.getSession();
    check('恢复会话', !!(session.session && session.session.user), session.error || '');

    // 空库时把当前账号绑成第一个审核员，保证后面的审核链路可测
    await api.claimAdmin();

    const recipes = await api.listRecipes({ page: 1, pageSize: 5 });
    check('菜谱列表', !!recipes.data && recipes.data.list.length === 5, recipes.error || ('共 ' + (recipes.data && recipes.data.total)));

    const first = recipes.data.list[0];
    check('封面转绝对地址', !!first.cover && first.cover.indexOf('http') === 0, first.cover);

    const detail = await api.getRecipeDetail(first.id);
    check('菜谱详情', !!detail.data && detail.data.steps.length > 0, detail.error || (detail.data.name + ' · ' + detail.data.materials.length + ' 食材'));

    const random = await api.randomRecipe({ quick: true });
    check('随机抽菜（快手）', !!random.data && random.data.materials.length > 0, random.error || random.data.name);

    const like = await api.toggleLike('recipe', first.id);
    const likeBack = await api.isLiked('recipe', first.id);
    check('点赞切换', like.data === likeBack, 'now=' + likeBack);
    await api.toggleLike('recipe', first.id);

    const posts = await api.listPosts({ page: 1, pageSize: 3 });
    check('社区列表', !!posts.data && posts.data.list.length > 0, posts.error || (posts.data.list.length + ' 条'));

    const post = await api.getPostDetail(posts.data.list[0].id);
    check('帖子详情', !!post.data && !!post.data.title, post.error || post.data.title);

    const comments = await api.listComments('post', post.data.id);
    check('评论列表', Array.isArray(comments.data), comments.error || (comments.data.length + ' 条'));

    const added = await api.addComment('post', post.data.id, '冒烟测试：这条评论可以删掉');
    check('发表评论', !!added.data && !!added.data.id, added.error || ('id=' + added.data.id));
    const removed = await api.deleteComment(added.data.id);
    check('删除评论', !removed.error, removed.error || '');

    const shop = await api.addShoppingItems([{ name: '测试食材', dosage: '1份' }], { id: first.id, name: first.name });
    check('加入买菜清单', shop.data === 1, shop.error || '');
    const shopping = await api.listShopping();
    const mine = (shopping.data || []).filter((item) => item.name === '测试食材');
    check('清单可读', mine.length > 0, '共 ' + (shopping.data || []).length + ' 条');
    if (mine.length) {
        await api.toggleShoppingItem(mine[0].id, true);
        const toggled = await api.listShopping();
        const again = (toggled.data || []).find((item) => item.id === mine[0].id);
        check('勾选状态', !!again && again.checked === true, 'checked=' + (again && again.checked));
        for (const item of mine) await api.removeShoppingItem(item.id);
    }

    const favorites = await api.listFavorites();
    check('我的收藏', Array.isArray(favorites.data), favorites.error || (favorites.data || []).length + ' 条');

    const contents = await api.listMyContents();
    check('我的发布', Array.isArray(contents.data), contents.error || (contents.data || []).length + ' 条');

    const notices = await api.listNotices();
    check('公告', (notices.data || []).length > 0, (notices.data || [])[0] && notices.data[0].title);

    const cuisines = await api.listCuisineOptions();
    check('菜系候选', cuisines.length > 0, cuisines.join('/'));

    const isAdmin = await api.isAdmin();
    check('审核员身份', isAdmin === true, String(isAdmin));

    const pending = await api.listPending();
    check('待审列表', Array.isArray(pending.data), pending.error || (pending.data || []).length + ' 条');

    /* 自动审核：违规内容不再返回 400，而是入库后直接驳回，可申诉 */
    const blocked = await api.createPost({ title: '冒烟测试拦截', content: '想买的加微信 abc' });
    const blockedAudit = blocked.data && blocked.data.audit;
    check(
        '自动审核驳回',
        !blocked.error && !!blockedAudit && blockedAudit.decision === 'reject',
        blocked.error || (blockedAudit ? blockedAudit.reasons.join('；') : '无审核结果')
    );

    if (blocked.data && blocked.data.id) {
        const ctx = await api.getAppealContext('post', blocked.data.id);
        check(
            '申诉上下文',
            !ctx.error && ctx.data && ctx.data.appealable === true,
            ctx.error || ('剩余 ' + ctx.data.appeal_left + ' 次申诉机会')
        );

        const fixed = Object.assign({}, ctx.data.content);
        delete fixed.mediaView;
        fixed.content = '改成一段正常的美食分享，炖了一小时的牛腩确实软烂，推荐给爱吃肉的朋友。';
        const appeal = await api.submitAppeal({
            target_type: 'post',
            target_id: blocked.data.id,
            reason: '已经删掉联系方式',
            content: fixed,
        });
        check(
            '修改后重新发布',
            !appeal.error && appeal.data && appeal.data.audit_status === 2,
            appeal.error || ('决策 ' + (appeal.data && appeal.data.decision))
        );
        await api.deletePost(blocked.data.id);
    }

    const created = await api.createPost({ title: '冒烟测试帖子', content: '这条用于验证发布链路，可以删除。' });
    check('发布帖子', !!created.data && !!created.data.id, created.error || ('id=' + created.data.id));
    check(
        '自动审核放行',
        !!created.data && !!created.data.audit && created.data.audit.decision === 'pass',
        created.error || (created.data && created.data.audit ? created.data.audit.decision : '')
    );

    const passed = await api.moderate('post', created.data.id, true, '');
    check('审核通过', !passed.error, passed.error || '');

    const audit = await api.listAuditMessages();
    check('审核消息', (audit.data || []).some((item) => item.targetId === created.data.id), '');

    const cleaned = await api.deletePost(created.data.id);
    check('删除自己的帖子', !cleaned.error, cleaned.error || '');

    const author = await api.getAuthor(login.data.id);
    check('作者主页', !!author.data && author.data.uid === login.data.id, author.error || ('作品 ' + author.data.recipes.length));

    const reports = await api.listReports(0);
    check('举报工单', Array.isArray(reports.data), reports.error || (reports.data || []).length + ' 条');

    const words = await api.listWords();
    check('敏感词库', (words.data || []).length > 0, (words.data || []).length + ' 条');

    const cfg = await api.getConfig();
    check('配置读取', Object.keys(cfg.data || {}).length > 0, Object.keys(cfg.data || {}).join(','));

    await api.signOut();
    const afterSignOut = await api.getSession();
    check('退出登录', afterSignOut.session === null, '');

    const failed = results.filter((item) => !item.ok);
    console.log('\n合计 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
    process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
    console.error('UNCAUGHT', error);
    process.exit(1);
});
