// 自建服务实现：与 api-cloud.js 同名同签名，页面代码不需要区分数据源。
// 服务端在 D:/dask/eat-what-admin/server（刻意放在小程序工程之外），接口前缀 /v1。
const config = require('./config');
const { formatRelative } = require('./util');

const PAGE_SIZE = 10;
const BASE = config.baseUrl;
const SHARE = config.shareCode || '';

// 公网发布链接走 sharecode 网关鉴权：每个请求 URL 都要带上，否则 403。
// 本地开发（shareCode 为空）时原样返回，行为不变。
function withShare(url) {
    if (!SHARE) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + encodeURIComponent(SHARE);
}

/* ---------------- 云托管通道（callContainer，走微信内网，免域名）---------------- */
let cloudClient = null;
let cloudInitPromise = null;
let cloudLastError = '';

function getCloudClient() {
    if (!config.useCloudRun) return Promise.resolve(null);
    if (cloudClient) return Promise.resolve(cloudClient);
    if (cloudInitPromise) return cloudInitPromise;
    cloudInitPromise = new Promise((resolve) => {
        try {
            if (!wx.cloud) { cloudLastError = '当前环境不支持 wx.cloud'; resolve(null); return; }
            const c = new wx.cloud.Cloud({ resourceEnv: config.cloudEnv });
            c.init().then(() => {
                cloudClient = c;
                resolve(c);
            }).catch((err) => {
                cloudLastError = (err && err.errMsg) || String(err);
                cloudInitPromise = null; // 允许下次重试，不缓存失败状态
                resolve(null);
            });
        } catch (error) {
            cloudLastError = String(error);
            cloudInitPromise = null;
            resolve(null);
        }
    });
    return cloudInitPromise;
}

/* ---------------- 基础请求 ---------------- */

function token() {
    try {
        return wx.getStorageSync(config.tokenKey) || '';
    } catch (error) {
        return '';
    }
}

function message(detail) {
    const raw = typeof detail === 'string' ? detail : '';
    if (!raw) return '操作失败，请稍后再试';
    if (raw.indexOf('SIGN_IN_REQUIRED') >= 0) return '请先登录';
    if (raw.indexOf('USER_BANNED') >= 0) return '账号已被封禁，暂时无法发布内容';
    if (raw.indexOf('SENSITIVE_WORD') >= 0) {
        const matched = raw.split('SENSITIVE_WORD:')[1] || '';
        const word = matched.split(' ')[0].trim();
        return word ? '内容包含敏感词「' + word + '」，请修改后再提交' : '内容包含敏感词，请修改后再提交';
    }
    if (raw.indexOf('CANNOT_REPORT_SELF') >= 0) return '不能举报自己的内容';
    if (raw.indexOf('ALREADY_REPORTED') >= 0) return '你已经举报过这条内容，我们正在处理';
    if (raw.indexOf('ALREADY_HANDLED') >= 0) return '这条工单已经处理过了';
    // ---- 申诉相关（必须放在 NOT_FOUND / EMPTY_ 之前，否则会被泛化话术覆盖）----
    if (raw.indexOf('APPEAL_LIMIT') >= 0) return '这条内容的申诉次数已经用完';
    if (raw.indexOf('APPEAL_PENDING') >= 0) return '已经有一条申诉在处理中，请耐心等待结果';
    if (raw.indexOf('NOT_REJECTED') >= 0) return '这条内容当前不是驳回状态，不需要申诉';
    if (raw.indexOf('NOT_OWNER') >= 0) return '只能处理自己发布的内容';
    if (raw.indexOf('EMPTY_REASON') >= 0) return '请写一句申诉说明，告诉审核员你觉得哪里被误判了';
    if (raw.indexOf('EMPTY_REPLY') >= 0) return '驳回时请填写给用户的说明';
    if (raw.indexOf('TARGET_NOT_FOUND') >= 0) return '内容不存在或已被删除';
    if (raw.indexOf('TARGET_NOT_FOUND') >= 0) return '内容不存在或已被删除';
    if (raw.indexOf('CANNOT_BAN_SELF') >= 0) return '不能封禁自己的账号';
    if (raw.indexOf('CANNOT_FOLLOW_SELF') >= 0) return '不能关注自己';
    if (raw.indexOf('EMPTY_WORD') >= 0) return '敏感词不能为空';
    if (raw.indexOf('NOT_ADMIN') >= 0) return '只有审核员才能操作';
    if (raw.indexOf('NO_PERMISSION') >= 0) return '没有权限删除这条内容';
    if (raw.indexOf('NOT_FOUND') >= 0) return '内容不存在或已被删除';
    if (raw.indexOf('NO_MATCH') >= 0) return '没有符合条件的菜，放宽一点筛选再试试';
    if (raw.indexOf('FILE_TOO_LARGE') >= 0) return '文件太大了，换一个小一点的';
    if (raw.indexOf('EMPTY_') >= 0) return '必填内容不能为空';
    return raw;
}

/* 自动审核结果兜底：服务端没返回 audit 时按"已提交审核"处理，页面不用做兼容判断 */
const AUDIT_DECISIONS = { pass: 'pass', reject: 'reject', review: 'review' };

function normalizeAudit(raw) {
    if (!raw || !raw.decision) {
        return { decision: 'review', status: 1, score: 0, code: '', reasons: [], hint: '', checkedAt: '' };
    }
    const status = Number(raw.status);
    return {
        decision: AUDIT_DECISIONS[raw.decision] || 'review',
        status: status === 0 || status === 1 || status === 2 || status === 3 ? status : 1,
        score: raw.score || 0,
        code: raw.code || '',
        reasons: raw.reasons || [],
        hint: raw.hint || '',
        checkedAt: raw.checked_at || '',
    };
}

function _settleResponse(res, resolve) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ ok: true, data: res.data });
        return;
    }
    const detail = res.data && res.data.detail;
    const text = typeof detail === 'string' ? detail : '';
    if (res.statusCode === 401) wx.removeStorageSync(config.tokenKey);
    resolve({ ok: false, detail: text || 'HTTP ' + res.statusCode, status: res.statusCode });
}

// 标准 HTTP 通道（公网分享链接 / 本地开发 / 云托管回退）
function httpRequest(method, path, data, header) {
    return new Promise((resolve) => {
        wx.request({
            url: withShare(BASE + path),
            method: method,
            data: data,
            header: header,
            timeout: 15000,
            success(res) {
                _settleResponse(res, resolve);
            },
            fail() {
                resolve({ ok: false, detail: '连接不上服务，请确认后台已启动', status: 0 });
            },
        });
    });
}

function request(method, path, data, options) {
    const opts = options || {};
    const header = { 'Content-Type': 'application/json' };
    const tk = token();
    if (tk) header['X-Auth-Token'] = tk;

    // 云托管：走微信内网，path 相对于服务根，免域名免备案
    if (config.useCloudRun) {
        return getCloudClient().then((client) => {
            // wx.cloud 不可用（预览卡/旧基础库）时回退到公网分享链接，保证仍能看效果
            if (!client) return httpRequest(method, path, data, header);
            const cloudHeader = Object.assign({}, header, { 'X-WX-SERVICE': config.cloudService });
            return client.callContainer({
                path: path,
                method: method,
                data: data,
                header: cloudHeader,
                timeout: 15000,
            }).then((res) => {
                const wrapped = { statusCode: res.statusCode, data: res.data };
                return new Promise((resolve) => _settleResponse(wrapped, resolve));
            }).catch(() => httpRequest(method, path, data, header)); // 调用失败也回退
        });
    }

    return httpRequest(method, path, data, header);
}

function query(params) {
    const parts = [];
    Object.keys(params || {}).forEach((key) => {
        const value = params[key];
        if (value === undefined || value === null || value === '') return;
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return parts.length ? '?' + parts.join('&') : '';
}

/* ---------------- 会话 ---------------- */

function currentUser() {
    const app = getApp();
    return (app && app.globalData && app.globalData.user) || null;
}

function currentUid() {
    const user = currentUser();
    return user && user.id ? user.id : '';
}

function displayName() {
    const user = currentUser();
    return (user && user.name) || '美食爱好者';
}

async function getSession() {
    if (!token()) return { session: null, error: null };
    const res = await request('GET', '/v1/me');
    if (!res.ok) {
        if (res.status === 401) return { session: null, error: null };
        return { session: null, error: message(res.detail) };
    }
    return { session: { user: res.data.user }, error: null };
}

async function signInWithWechat() {
    const login = await new Promise((resolve) => {
        wx.login({
            success: (res) => resolve(res.code || ''),
            fail: () => resolve(''),
        });
    });
    let deviceId = '';
    try {
        deviceId = wx.getStorageSync(config.deviceKey) || '';
    } catch (error) {
        deviceId = '';
    }
    if (!deviceId) {
        deviceId = 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
        try {
            wx.setStorageSync(config.deviceKey, deviceId);
        } catch (error) {
            // 存储不可用时退化为一次性标识
        }
    }
    const res = await request('POST', '/v1/auth/login', { code: login, device_id: deviceId });
    if (!res.ok) return { data: null, error: message(res.detail) };
    wx.setStorageSync(config.tokenKey, res.data.token);
    const app = getApp();
    if (app) {
        app.setUser(res.data.user);
        app.resetSession();
    }
    return { data: res.data.user, error: null };
}

async function signOut() {
    try {
        wx.removeStorageSync(config.tokenKey);
    } catch (error) {
        // 忽略
    }
    return { error: null };
}

/* ---------------- 媒体 ---------------- */

// 演示封面（dish1..dish12）已经打包在小程序里，服务端返回的 /assets/covers/xxx 或 /covers/xxx
// 直接映射成包内路径：真机不接受 http 图片，本地图还省掉一次网络请求。
// 用户上传的图片走 /uploads/...，仍然拼 baseUrl。
const DEMO_COVER_RE = /^\/?(?:assets\/)?covers\/(dish\d+\.jpg)$/;

// 返回值必须与入参等长：decorateRecipes / decoratePosts / 步骤图都按原下标回填，
// 一旦把空封面过滤掉，后面的图片就会整体错位一格（第 1 条没封面时尤其明显）。
function resolveMedia(paths) {
    const urls = (paths || []).map((path) => {
        if (typeof path !== 'string' || !path) return '';
        if (/^https?:\/\//.test(path)) return path;
        // 云托管对象存储：小程序 image/video 组件原生支持 cloud:// fileID，直接用
        if (path.indexOf('cloud://') === 0) return path;
        const demo = DEMO_COVER_RE.exec(path);
        if (demo) return '/assets/covers/' + demo[1];
        if (path.charAt(0) === '/') return withShare(BASE + path);
        return withShare(BASE + '/' + path);
    });
    return Promise.resolve(urls);
}

function uploadFile(tempPath, kind) {
    // 云托管：小程序直传对象存储，拿 cloud:// fileID 存库（后端不落盘）
    if (config.useCloudRun) {
        const cloudUpload = require('./cloud-upload');
        return cloudUpload.uploadToCloud(tempPath, kind).then((fileID) => {
            if (fileID) return { data: fileID, error: null };
            return { data: null, error: '上传失败，请重试' };
        });
    }
    return new Promise((resolve) => {
        const tk = token();
        wx.uploadFile({
            url: withShare(BASE + '/v1/upload?kind=' + (kind || 'image')),
            filePath: tempPath,
            name: 'file',
            header: tk ? { 'X-Auth-Token': tk } : {},
            success(res) {
                let body = {};
                try {
                    body = JSON.parse(res.data || '{}');
                } catch (error) {
                    body = {};
                }
                if (res.statusCode >= 200 && res.statusCode < 300 && body.path) {
                    resolve({ data: body.path, error: null });
                    return;
                }
                resolve({ data: null, error: message(body.detail) });
            },
            fail() {
                resolve({ data: null, error: '上传失败，请检查网络' });
            },
        });
    });
}

async function uploadImage(tempPath) {
    if (!currentUid()) return { data: null, error: '请先登录后再上传图片' };
    return uploadFile(tempPath, 'image');
}

async function uploadVideo(tempPath, size) {
    if (!currentUid()) return { data: null, error: '请先登录后再上传视频' };
    const limitMb = 20;
    if (size && size > limitMb * 1024 * 1024) {
        return { data: null, error: '视频不能超过 ' + limitMb + 'MB' };
    }
    return uploadFile(tempPath, 'video');
}

/* ---------------- 菜谱 ---------------- */

function decorateRecipe(row) {
    return Object.assign({}, row, {
        cover: row.cover_img || '',
        timeText: formatRelative(row.created_at),
        tagText: (row.tags || []).slice(0, 3).join(' · '),
        isOwner: !!row.is_owner,
    });
}

async function decorateRecipes(rows) {
    const list = rows || [];
    const covers = await resolveMedia(list.map((row) => row.cover_img));
    return list.map((row, index) => Object.assign(decorateRecipe(row), { cover: covers[index] || '' }));
}

async function listRecipes(params) {
    const p = params || {};
    const res = await request(
        'GET',
        '/v1/recipes' +
            query({
                page: p.page || 1,
                page_size: p.pageSize || PAGE_SIZE,
                cuisine: p.cuisine,
                meal: p.meal,
                taste: p.taste,
                difficulty: p.difficulty,
                quick: p.quick ? 1 : '',
                takeaway: p.takeaway ? 1 : '',
                tag: p.tag,
                max_time: p.maxTime,
                keyword: p.keyword,
                sort: p.sort,
            })
    );
    if (!res.ok) return { data: null, error: message(res.detail) };
    const list = await decorateRecipes(res.data.list || []);
    return {
        data: { list: list, hasMore: !!res.data.has_more, total: res.data.total || list.length },
        error: null,
    };
}

async function randomRecipe(filters) {
    const f = filters || {};
    const res = await request(
        'GET',
        '/v1/recipes/random' +
            query({
                cuisine: f.cuisine,
                meal: f.meal,
                taste: f.taste,
                difficulty: f.difficulty,
                quick: f.quick ? 1 : '',
                takeaway: f.takeaway ? 1 : '',
                tag: f.tag,
                max_time: f.maxTime,
            })
    );
    if (!res.ok) return { data: null, error: message(res.detail) };
    const item = decorateRecipe(res.data);
    const randomCover = await resolveMedia([res.data.cover_img]);
    item.cover = randomCover[0] || '';
    item.materials = res.data.materials || [];
    return { data: item, error: null };
}

async function getRecipeDetail(id) {
    const res = await request('GET', '/v1/recipes/' + id);
    if (!res.ok) return { data: null, error: message(res.detail) };
    const recipe = decorateRecipe(res.data);
    // 详情页封面也要走媒体解析，否则 /covers/xxx.jpg 会被当成包内路径而 404
    const coverUrls = await resolveMedia([res.data.cover_img]);
    recipe.cover = coverUrls[0] || '';
    recipe.materials = res.data.materials || [];
    const steps = res.data.steps || [];
    const images = await resolveMedia(steps.map((step) => step.img_url));
    recipe.steps = steps.map((step, index) => Object.assign({}, step, { image: images[index] || '' }));
    recipe.liked = !!res.data.liked;
    recipe.collected = !!res.data.collected;
    recipe.isOwner = !!res.data.is_owner;
    recipe.viewCountText = String(recipe.view_count || 0);
    return { data: recipe, error: null };
}

async function createRecipe(payload) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const body = {
        name: (payload.name || '').trim(),
        cuisine: (payload.cuisine || '').trim(),
        region: (payload.region || '').trim(),
        taste: (payload.taste || '').trim(),
        difficulty: (payload.difficulty || '').trim(),
        cost_time: Number(payload.cost_time) || 30,
        meal_type: (payload.meal_type || '').trim(),
        summary: (payload.summary || '').trim(),
        tags: payload.tags || [],
        fit_quick: !!payload.fit_quick,
        fit_takeaway: !!payload.fit_takeaway,
        cover_img: payload.cover_img || '',
        audit_status: payload.audit_status === 0 ? 0 : 1,
        materials: payload.materials || [],
        steps: payload.steps || [],
    };
    const res = await request('POST', '/v1/recipes', body);
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: { id: res.data.id, audit: normalizeAudit(res.data.audit) }, error: null };
}

/* ---------------- 帖子 ---------------- */

async function decoratePosts(rows) {
    const list = rows || [];
    const flat = [];
    list.forEach((row) => (row.media || []).forEach((path) => flat.push(path)));
    const urls = await resolveMedia(flat);
    const videos = await resolveMedia(list.map((row) => row.video_url));
    let cursor = 0;
    return list.map((row, index) => {
        const count = (row.media || []).length;
        const media = urls.slice(cursor, cursor + count);
        cursor += count;
        return Object.assign({}, row, {
            media: media,
            cover: media[0] || '',
            video: videos[index] || '',
            timeText: formatRelative(row.created_at),
            isCheckin: row.post_type === 'checkin',
            isOwner: !!row.is_owner,
        });
    });
}

async function listPosts(params) {
    const p = params || {};
    const res = await request(
        'GET',
        '/v1/posts' + query({ page: p.page || 1, page_size: p.pageSize || PAGE_SIZE, keyword: p.keyword, sort: p.sort })
    );
    if (!res.ok) return { data: null, error: message(res.detail) };
    const list = await decoratePosts(res.data.list || []);
    return { data: { list: list, hasMore: !!res.data.has_more }, error: null };
}

async function getPostDetail(id) {
    const res = await request('GET', '/v1/posts/' + id);
    if (!res.ok) return { data: null, error: message(res.detail) };
    const post = (await decoratePosts([res.data]))[0];
    post.isOwner = !!res.data.is_owner;
    post.liked = !!res.data.liked;
    post.collected = !!res.data.collected;
    if (res.data.recipe) {
        post.recipe = await decorateRecipes([res.data.recipe]).then((list) => list[0]);
    }
    return { data: post, error: null };
}

async function createPost(payload) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const res = await request('POST', '/v1/posts', {
        title: (payload.title || '').trim(),
        content: (payload.content || '').trim(),
        media: payload.media || [],
        video_url: payload.video_url || '',
        rel_recipe_id: payload.rel_recipe_id || null,
    });
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: { id: res.data.id, audit: normalizeAudit(res.data.audit) }, error: null };
}

async function deletePost(id) {
    const res = await request('DELETE', '/v1/posts/' + id);
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

async function deleteRecipe(id) {
    const res = await request('DELETE', '/v1/recipes/' + id);
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

/* ---------------- 互动 ---------------- */

async function isLiked(targetType, targetId) {
    if (!currentUid()) return false;
    const res = await request(
        'GET',
        '/v1/interactions/state' + query({ target_type: targetType, target_id: targetId })
    );
    return !!(res.ok && res.data.liked);
}

async function isCollected(targetType, targetId) {
    if (!currentUid()) return false;
    const res = await request(
        'GET',
        '/v1/interactions/state' + query({ target_type: targetType, target_id: targetId })
    );
    return !!(res.ok && res.data.collected);
}

async function toggleLike(targetType, targetId) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const res = await request('POST', '/v1/likes/toggle', { target_type: targetType, target_id: Number(targetId) });
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: !!res.data.liked, error: null };
}

async function toggleCollect(targetType, targetId) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const res = await request('POST', '/v1/collects/toggle', { target_type: targetType, target_id: Number(targetId) });
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: !!res.data.collected, error: null };
}

async function bumpView(targetType, targetId) {
    await request('POST', '/v1/views', { target_type: targetType, target_id: Number(targetId) });
}

async function listComments(targetType, targetId) {
    const res = await request('GET', '/v1/comments' + query({ target_type: targetType, target_id: targetId }));
    if (!res.ok) return { data: null, error: message(res.detail) };
    const rows = res.data.list || [];
    const roots = rows.filter((row) => !row.parent_id);
    const replies = rows.filter((row) => row.parent_id);
    const list = roots.map((row) => {
        const children = replies.filter((item) => item.parent_id === row.id);
        return Object.assign({}, row, {
            timeText: formatRelative(row.created_at),
            isOwner: currentUid() === row.owner_id,
            children: children.map((child) =>
                Object.assign({}, child, {
                    timeText: formatRelative(child.created_at),
                    isOwner: currentUid() === child.owner_id,
                })
            ),
        });
    });
    return { data: list, error: null };
}

async function addComment(targetType, targetId, content, parentId) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const res = await request('POST', '/v1/comments', {
        target_type: targetType,
        target_id: Number(targetId),
        content: (content || '').trim(),
        parent_id: parentId || null,
    });
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: { id: res.data.id }, error: null };
}

async function deleteComment(id) {
    const res = await request('DELETE', '/v1/comments/' + id);
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

/* ---------------- 关注 ---------------- */

async function isFollowing(targetUid) {
    if (!currentUid() || !targetUid || targetUid === currentUid()) return false;
    const res = await request('GET', '/v1/follows/state' + query({ target_uid: targetUid }));
    return !!(res.ok && res.data.following);
}

async function toggleFollow(targetUid) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    if (targetUid === currentUid()) return { data: null, error: '不能关注自己' };
    const res = await request('POST', '/v1/follows/toggle' + query({ target_uid: targetUid }));
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: !!res.data.following, error: null };
}

async function countFollows(uid) {
    if (!uid) return { fans: 0, following: 0 };
    const res = await request('GET', '/v1/users/' + uid);
    if (!res.ok) return { fans: 0, following: 0 };
    return { fans: res.data.fans || 0, following: res.data.following_count || 0 };
}

/* ---------------- 我的 ---------------- */

async function listMyContents() {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const res = await request('GET', '/v1/me/contents');
    if (!res.ok) return { data: null, error: message(res.detail) };
    const recipes = [];
    const posts = [];
    (res.data.list || []).forEach((row) => {
        if (row.kind === 'recipe') recipes.push(row);
        else posts.push(row);
    });
    const recipeList = (await decorateRecipes(recipes)).map((row) =>
        Object.assign({}, row, { kind: 'recipe', kindText: '菜谱' })
    );
    const postList = (await decoratePosts(posts)).map((row) =>
        Object.assign({}, row, { kind: 'post', kindText: '帖子' })
    );
    const list = recipeList
        .concat(postList)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { data: list, error: null };
}

async function listFavorites() {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const res = await request('GET', '/v1/me/favorites');
    if (!res.ok) return { data: null, error: message(res.detail) };
    const rows = res.data.list || [];
    const recipes = rows.filter((row) => row.kind === 'recipe');
    const posts = rows.filter((row) => row.kind === 'post');
    const recipeList = (await decorateRecipes(recipes)).map((row) =>
        Object.assign({}, row, { kind: 'recipe', kindText: '菜谱' })
    );
    const postList = (await decoratePosts(posts)).map((row) =>
        Object.assign({}, row, { kind: 'post', kindText: '帖子' })
    );
    return { data: recipeList.concat(postList), error: null };
}

async function getAuthor(uid) {
    const res = await request('GET', '/v1/users/' + uid);
    if (!res.ok) return { data: null, error: message(res.detail) };
    const data = res.data;
    const recipeList = (await decorateRecipes(data.recipes || [])).map((row) =>
        Object.assign({}, row, { kind: 'recipe' })
    );
    const postList = (await decoratePosts(data.posts || [])).map((row) => Object.assign({}, row, { kind: 'post' }));
    return {
        data: {
            uid: data.uid,
            name: data.name,
            recipes: recipeList,
            posts: postList,
            following: !!data.following,
            fans: data.fans || 0,
            followingCount: data.following_count || 0,
            viewTotal: data.view_total || 0,
            collectTotal: data.collect_total || 0,
        },
        error: null,
    };
}

/* ---------------- 买菜清单 ---------------- */

async function listShopping() {
    if (!currentUid()) return { data: [], error: null };
    const res = await request('GET', '/v1/shopping');
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: res.data.list || [], error: null };
}

async function addShoppingItems(items, recipe) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const rows = (items || []).map((item) => ({
        name: (item.name || '').trim(),
        dosage: (item.dosage || '').trim(),
    }));
    if (rows.length === 0) return { data: null, error: '没有可添加的食材' };
    const res = await request('POST', '/v1/shopping/batch', {
        items: rows,
        recipe_id: recipe ? recipe.id : null,
        recipe_name: recipe ? recipe.name : '',
    });
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: res.data.count, error: null };
}

async function addShoppingItem(name, dosage) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const res = await request('POST', '/v1/shopping', { name: (name || '').trim(), dosage: (dosage || '').trim() });
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: true, error: null };
}

async function toggleShoppingItem(id, checked) {
    const res = await request('PATCH', '/v1/shopping/' + id, { checked: !!checked });
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

async function removeShoppingItem(id) {
    const res = await request('DELETE', '/v1/shopping/' + id);
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

async function clearShopping() {
    if (!currentUid()) return { error: '请先登录' };
    const res = await request('DELETE', '/v1/shopping');
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

/* ---------------- 消息 ---------------- */

async function listNotices() {
    const res = await request('GET', '/v1/notices');
    if (!res.ok) return { data: [], error: message(res.detail) };
    return {
        data: (res.data.list || []).map((row) => Object.assign({}, row, { timeText: formatRelative(row.created_at) })),
        error: null,
    };
}

async function listAuditMessages() {
    if (!currentUid()) return { data: [], error: null };
    const res = await request('GET', '/v1/me/audit-messages');
    if (!res.ok) return { data: [], error: message(res.detail) };
    const list = (res.data.list || []).map((row) => ({
        id: row.id,
        target: row.target,
        targetId: row.target_id,
        title: row.title,
        passed: !!row.passed,
        reason: row.reason || '',
        timeText: formatRelative(row.created_at),
        createdAt: row.created_at,
    }));
    return { data: list, error: null };
}

async function listInteractions() {
    if (!currentUid()) return { data: [], error: null };
    const res = await request('GET', '/v1/me/interactions');
    if (!res.ok) return { data: [], error: message(res.detail) };
    const list = (res.data.list || []).map((row) => ({
        id: row.id,
        who: row.who,
        content: row.content,
        targetText: row.target_text,
        target: row.target,
        targetId: row.target_id,
        timeText: formatRelative(row.created_at),
    }));
    return { data: list, error: null };
}

/* ---------------- 审核 ---------------- */

async function isAdmin() {
    if (!currentUid()) return false;
    const res = await request('GET', '/v1/me');
    return !!(res.ok && res.data.is_admin);
}

async function claimAdmin() {
    const res = await request('POST', '/v1/me/claim-admin');
    if (!res.ok) return { data: false, error: message(res.detail) };
    return { data: !!res.data.ok, error: null };
}

async function listPending() {
    const res = await request('GET', '/v1/admin/pending');
    if (!res.ok) return { data: null, error: message(res.detail) };
    const items = res.data.list || [];
    const recipes = items.filter((row) => row.kind === 'recipe');
    const posts = items.filter((row) => row.kind === 'post');
    const recipeList = (await decorateRecipes(recipes)).map((row) =>
        Object.assign({}, row, { kind: 'recipe', kindText: '菜谱', title: row.name })
    );
    const postList = (await decoratePosts(posts)).map((row) =>
        Object.assign({}, row, { kind: 'post', kindText: '帖子' })
    );
    return { data: recipeList.concat(postList), error: null };
}

async function moderate(kind, id, passed, reason) {
    const res = await request('POST', '/v1/admin/moderate', {
        kind: kind,
        id: Number(id),
        passed: !!passed,
        reason: reason || '',
    });
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

/* ---------------- 申诉 ---------------- */

async function getAppealContext(kind, id) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const res = await request('GET', '/v1/appeals/context' + query({ target_type: kind, target_id: id }));
    if (!res.ok) return { data: null, error: message(res.detail) };
    const data = res.data;
    const content = Object.assign({}, data.content || {});
    if (kind === 'post') {
        content.mediaView = await resolveMedia(content.media || []);
    }
    return { data: Object.assign({}, data, { content: content }), error: null };
}

async function submitAppeal(payload) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const body = {
        target_type: payload.target_type,
        target_id: Number(payload.target_id),
        reason: (payload.reason || '').trim(),
    };
    if (payload.content) body.content = payload.content;
    const res = await request('POST', '/v1/appeals', body);
    if (!res.ok) return { data: null, error: message(res.detail) };
    const data = Object.assign({}, res.data);
    if (data.audit) data.audit = normalizeAudit(data.audit);
    return { data: data, error: null };
}

async function listMyAppeals() {
    if (!currentUid()) return { data: [], error: null };
    const res = await request('GET', '/v1/me/appeals');
    if (!res.ok) return { data: [], error: message(res.detail) };
    return { data: res.data.list || [], error: null };
}

async function listAdminAppeals(status) {
    if (!currentUid()) return { data: [], error: null };
    const res = await request('GET', '/v1/admin/appeals' + query({ status: status === undefined ? 0 : status }));
    if (!res.ok) return { data: [], error: message(res.detail) };
    return { data: res.data.list || [], error: null, pending: res.data.pending || 0 };
}

async function handleAdminAppeal(id, accepted, reply) {
    const res = await request('POST', '/v1/admin/appeals/' + id + '/handle', {
        accepted: !!accepted,
        reply: reply || '',
    });
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

/* ---------------- 筛选候选 ---------------- */

async function listCuisineOptions() {
    const res = await request('GET', '/v1/meta/cuisines');
    return res.ok ? res.data.list || [] : [];
}

/* ---------------- 举报 ---------------- */

async function submitReport(targetType, targetId, reason, detail) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    const res = await request('POST', '/v1/reports', {
        target_type: targetType,
        target_id: Number(targetId),
        reason: reason,
        detail: detail || '',
    });
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: res.data.id, error: null };
}

async function listReports(status) {
    const res = await request('GET', '/v1/admin/reports' + query({ status: status === 0 || status === 1 ? status : '' }));
    if (!res.ok) return { data: null, error: message(res.detail) };
    const list = (res.data.list || []).map((row) =>
        Object.assign({}, row, {
            timeText: formatRelative(row.created_at),
            typeText: row.target_type === 'recipe' ? '菜谱' : row.target_type === 'post' ? '帖子' : '评论',
            statusText: row.status === 0 ? '待处理' : '已处理',
            resultText: row.status === 0 ? '' : row.result === 1 ? '违规下架' : '判定合规',
        })
    );
    return { data: list, error: null };
}

async function handleReport(id, result, remark) {
    const res = await request('POST', '/v1/admin/reports/' + id + '/handle', {
        result: result ? 1 : 0,
        remark: remark || '',
    });
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

/* ---------------- 配置 ---------------- */

async function getConfig() {
    const res = await request('GET', '/v1/config');
    if (!res.ok) return { data: {}, error: message(res.detail) };
    return { data: res.data || {}, error: null };
}

// 今日想喝品牌池：优先远端，本地缓存 1 小时，失败回落默认池
const DRINKS_CACHE_KEY = 'eat_what_drinks';
const DRINKS_CACHE_TTL = 60 * 60 * 1000;

async function getDrinks() {
    const cache = wx.getStorageSync(DRINKS_CACHE_KEY);
    if (cache && cache.brands && cache.brands.length && Date.now() - (cache.at || 0) < DRINKS_CACHE_TTL) {
        return { data: cache.brands, error: null };
    }
    const res = await request('GET', '/v1/drinks');
    if (res.ok && res.data && Array.isArray(res.data.brands) && res.data.brands.length) {
        wx.setStorageSync(DRINKS_CACHE_KEY, { brands: res.data.brands, at: Date.now() });
        return { data: res.data.brands, error: null };
    }
    if (cache && cache.brands && cache.brands.length) {
        return { data: cache.brands, error: null };
    }
    return { data: [], error: null };
}

async function getSubscribeTemplates() {
    const config2 = await getConfig();
    const raw = (config2.data && config2.data.subscribe_templates) || '';
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/* ---------------- 管理台 ---------------- */

async function listAllRecipes() {
    const res = await request('GET', '/v1/admin/contents?kind=recipe');
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: await decorateRecipes(res.data.list || []), error: null };
}

async function listAllPosts() {
    const res = await request('GET', '/v1/admin/contents?kind=post');
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: await decoratePosts(res.data.list || []), error: null };
}

async function adminContent(kind, id, action) {
    const res = await request('POST', '/v1/admin/contents/action', { kind: kind, id: Number(id), action: action });
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

async function listAuthors() {
    const res = await request('GET', '/v1/admin/authors');
    if (!res.ok) return { data: null, error: message(res.detail) };
    return {
        data: (res.data.list || []).map((row) => ({
            uid: row.uid,
            name: row.name,
            count: row.count,
            banned: !!row.banned,
            banReason: row.ban_reason || '',
        })),
        error: null,
    };
}

async function adminUser(uid, action, reason) {
    const res = await request('POST', '/v1/admin/users/' + uid + '/action', { action: action, reason: reason || '' });
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

async function listNoticesAll() {
    const res = await request('GET', '/v1/admin/notices');
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: res.data.list || [], error: null };
}

async function adminNotice(action, id, title, content, active) {
    const res = await request('POST', '/v1/admin/notices/action', {
        action: action,
        id: id ? Number(id) : null,
        title: title || '',
        content: content || '',
        active: active === undefined ? true : !!active,
    });
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

async function listWords() {
    const res = await request('GET', '/v1/admin/words');
    if (!res.ok) return { data: null, error: message(res.detail) };
    return { data: res.data.list || [], error: null };
}

async function adminWord(action, id, word) {
    const res = await request('POST', '/v1/admin/words/action', {
        action: action,
        id: id ? Number(id) : null,
        word: word || '',
    });
    if (!res.ok) return { error: message(res.detail) };
    return { error: null };
}

module.exports = {
    PAGE_SIZE,
    message,
    normalizeAudit,
    getSession,
    signInWithWechat,
    signOut,
    currentUser,
    currentUid,
    displayName,
    resolveMedia,
    uploadImage,
    uploadVideo,
    listRecipes,
    randomRecipe,
    getRecipeDetail,
    createRecipe,
    listPosts,
    getPostDetail,
    createPost,
    deletePost,
    deleteRecipe,
    isLiked,
    isCollected,
    toggleLike,
    toggleCollect,
    bumpView,
    listComments,
    addComment,
    deleteComment,
    isFollowing,
    toggleFollow,
    countFollows,
    listMyContents,
    listFavorites,
    getAuthor,
    listShopping,
    addShoppingItems,
    addShoppingItem,
    toggleShoppingItem,
    removeShoppingItem,
    clearShopping,
    listNotices,
    listAuditMessages,
    listInteractions,
    isAdmin,
    claimAdmin,
    listPending,
    moderate,
    getAppealContext,
    submitAppeal,
    listMyAppeals,
    listAdminAppeals,
    handleAdminAppeal,
    listCuisineOptions,
    submitReport,
    listReports,
    handleReport,
    getConfig,
    getDrinks,
    getSubscribeTemplates,
    listAllRecipes,
    listAllPosts,
    adminContent,
    listAuthors,
    adminUser,
    listNoticesAll,
    adminNotice,
    listWords,
    adminWord,
};
