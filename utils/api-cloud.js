// 数据层：页面只调用这里的方法，不直接拼 SQL 或访问存储。
const { cloud } = require('./cloud');
const { formatRelative } = require('./util');

const PAGE_SIZE = 10;

function message(error) {
    if (!error) return '操作失败，请稍后再试';
    const code = error.code || '';
    if (code === '42P01') return '数据表还没准备好';
    if (code === '42501') return '没有权限执行这个操作';
    if (code === '23505') return '已经存在相同的记录了';
    if (code === 'PGRST116') return '内容不存在或已被删除';
    if (code === 'NOT_ADMIN') return '只有审核员才能操作';
    if (code === 'SIGN_IN_REQUIRED') return '请先登录';
    const raw = error.message || '';
    if (raw.indexOf('SIGN_IN_REQUIRED') >= 0) return '请先登录';
    if (raw.indexOf('NOT_ADMIN') >= 0) return '只有审核员才能操作';
    if (raw.indexOf('USER_BANNED') >= 0) return '账号已被封禁，暂时无法发布内容';
    if (raw.indexOf('CANNOT_REPORT_SELF') >= 0) return '不能举报自己的内容';
    if (raw.indexOf('ALREADY_REPORTED') >= 0) return '你已经举报过这条内容，我们正在处理';
    if (raw.indexOf('TARGET_NOT_FOUND') >= 0) return '内容不存在或已被删除';
    if (raw.indexOf('CANNOT_BAN_SELF') >= 0) return '不能封禁自己的账号';
    if (raw.indexOf('EMPTY_WORD') >= 0) return '敏感词不能为空';
    if (raw.indexOf('SENSITIVE_WORD') >= 0) {
        const matched = raw.split('SENSITIVE_WORD:')[1] || '';
        const word = matched.split(' ')[0].split('For')[0].trim();
        return word ? '内容包含敏感词「' + word + '」，请修改后再提交' : '内容包含敏感词，请修改后再提交';
    }
    return raw || '操作失败，请稍后再试';
}

function trimmed(value) {
    return (value || '').toString().trim();
}

// 用户搜索词里不能带 PostgREST 的分隔符
function safeLike(keyword) {
    return trimmed(keyword).replace(/[,()*%\\]/g, ' ').trim();
}

async function getSession() {
    try {
        const result = await cloud.auth.getSession();
        if (result.error) return { session: null, error: message(result.error) };
        return { session: result.data || null, error: null };
    } catch (error) {
        return { session: null, error: message(error) };
    }
}

async function signOut() {
    try {
        await cloud.auth.signOut();
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

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

/* ---------------- 媒体地址 ---------------- */

const mediaCache = {};

// 返回值必须与入参等长：菜谱列表、帖子 media、步骤图都按原下标回填，
// 过滤掉空路径会让后面的图片整体错位一格。空值保留为 ''，由组件显示占位图。
async function resolveMedia(paths) {
    const list = paths || [];
    const need = [];
    list.forEach((path) => {
        if (typeof path !== 'string' || !path || path.indexOf('/') === 0) return;
        if (!mediaCache[path] && need.indexOf(path) < 0) need.push(path);
    });
    if (need.length > 0) {
        try {
            const result = await cloud.storage.createSignedUrls(need, 3600);
            if (result && result.data) {
                result.data.forEach((item) => {
                    const url = item.signedUrl || item.signedURL;
                    if (item.path && url) mediaCache[item.path] = url;
                });
            }
        } catch (error) {
            // 未登录或网络失败时不阻塞页面，图片位置显示占位
        }
    }
    return list.map((path) => {
        if (typeof path !== 'string' || !path) return '';
        if (path.indexOf('/') === 0) return path;
        return mediaCache[path] || '';
    });
}

async function uploadImage(tempPath) {
    if (!currentUid()) return { data: null, error: '请先登录后再上传图片' };
    try {
        const ext = (tempPath.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
        const safeExt = ext === 'png' ? 'png' : 'jpg';
        const name = 'food/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + safeExt;
        const path = cloud.storage.sharedPath(currentUid(), name);
        const buffer = wx.getFileSystemManager().readFileSync(tempPath);
        const result = await cloud.storage.upload(path, buffer, {
            contentType: 'image/' + (safeExt === 'jpg' ? 'jpeg' : 'png'),
            upsert: true,
        });
        if (result.error) return { data: null, error: message(result.error) };
        return { data: path, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

/* ---------------- 菜谱 ---------------- */

async function decorateRecipes(rows) {
    const list = rows || [];
    const covers = await resolveMedia(list.map((row) => row.cover_img));
    return list.map((row, index) =>
        Object.assign({}, row, {
            cover: covers[index] || '',
            timeText: formatRelative(row.created_at),
            tagText: (row.tags || []).slice(0, 3).join(' · '),
        })
    );
}

function applyRecipeFilters(query, filters) {
    const f = filters || {};
    let result = query;
    if (trimmed(f.cuisine)) result = result.eq('cuisine', trimmed(f.cuisine));
    if (trimmed(f.meal)) result = result.eq('meal_type', trimmed(f.meal));
    if (trimmed(f.taste)) result = result.eq('taste', trimmed(f.taste));
    if (trimmed(f.difficulty)) result = result.eq('difficulty', trimmed(f.difficulty));
    if (f.quick) result = result.eq('fit_quick', true);
    if (f.takeaway) result = result.eq('fit_takeaway', true);
    if (trimmed(f.tag)) result = result.contains('tags', [trimmed(f.tag)]);
    if (Number(f.maxTime) > 0) result = result.lte('cost_time', Number(f.maxTime));
    const keyword = safeLike(f.keyword);
    if (keyword) {
        const like = '%' + keyword + '%';
        result = result.or(
            'name.ilike.' + like + ',summary.ilike.' + like + ',cuisine.ilike.' + like + ',region.ilike.' + like
        );
    }
    return result;
}

function applyRecipeSort(query, sort) {
    if (sort === 'weight') return query.order('weight', { ascending: false }).order('created_at', { ascending: false });
    if (sort === 'collect') return query.order('collect_count', { ascending: false });
    if (sort === 'like') return query.order('like_count', { ascending: false });
    return query.order('created_at', { ascending: false });
}

async function listRecipes(params) {
    const p = params || {};
    const pageSize = p.pageSize || PAGE_SIZE;
    const page = p.page || 1;
    const from = (page - 1) * pageSize;
    try {
        let query = applyRecipeFilters(
            cloud.database.from('recipes').select('*', { count: 'exact' }).eq('audit_status', 2),
            p
        );
        query = applyRecipeSort(query, p.sort);
        const result = await query.range(from, from + pageSize - 1);
        if (result.error) return { data: null, error: message(result.error) };
        const list = await decorateRecipes(result.data || []);
        const total = typeof result.count === 'number' ? result.count : list.length;
        return { data: { list: list, hasMore: from + list.length < total, total: total }, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function randomRecipe(filters) {
    try {
        const query = applyRecipeFilters(cloud.database.from('recipes').select('*').eq('audit_status', 2), filters).limit(50);
        const result = await query;
        if (result.error) return { data: null, error: message(result.error) };
        const rows = result.data || [];
        if (rows.length === 0) return { data: null, error: '没有符合条件的菜，放宽一点筛选再试试' };
        const picked = rows[Math.floor(Math.random() * rows.length)];
        const decorated = await decorateRecipes([picked]);
        const item = decorated[0];
        const materials = await cloud.database
            .from('recipe_materials')
            .select('name,dosage')
            .eq('recipe_id', picked.id)
            .order('sort', { ascending: true });
        item.materials = materials.data || [];
        return { data: item, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function getRecipeDetail(id) {
    try {
        const result = await cloud.database.from('recipes').select('*').eq('id', id).maybeSingle();
        if (result.error) return { data: null, error: message(result.error) };
        if (!result.data) return { data: null, error: '这道菜不存在或已被下架' };
        const recipe = (await decorateRecipes([result.data]))[0];
        const [materials, steps] = await Promise.all([
            cloud.database.from('recipe_materials').select('name,dosage').eq('recipe_id', id).order('sort', { ascending: true }),
            cloud.database.from('recipe_steps').select('sort,content,img_url').eq('recipe_id', id).order('sort', { ascending: true }),
        ]);
        recipe.materials = materials.data || [];
        recipe.steps = steps.data || [];
        const stepImages = await resolveMedia(recipe.steps.map((step) => step.img_url));
        recipe.steps = recipe.steps.map((step, index) => Object.assign({}, step, { image: stepImages[index] || '' }));
        recipe.isOwner = currentUid() && currentUid() === recipe.owner_id;
        const states = await Promise.all([isLiked('recipe', id), isCollected('recipe', id)]);
        recipe.liked = states[0];
        recipe.collected = states[1];
        recipe.viewCountText = String(recipe.view_count || 0);
        return { data: recipe, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function createRecipe(payload) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    try {
        const row = {
            name: trimmed(payload.name),
            cuisine: trimmed(payload.cuisine),
            region: trimmed(payload.region),
            taste: trimmed(payload.taste),
            difficulty: trimmed(payload.difficulty),
            cost_time: Number(payload.cost_time) || 30,
            meal_type: trimmed(payload.meal_type),
            summary: trimmed(payload.summary),
            tags: payload.tags || [],
            fit_quick: !!payload.fit_quick,
            fit_takeaway: !!payload.fit_takeaway,
            cover_img: payload.cover_img || '',
            audit_status: payload.audit_status === 0 ? 0 : 1,
            owner_name: displayName(),
        };
        const created = await cloud.database.from('recipes').insert(row).select('id');
        if (created.error) return { data: null, error: message(created.error) };
        const recipeId = created.data[0].id;
        const materials = (payload.materials || [])
            .filter((item) => trimmed(item.name))
            .map((item, index) => ({ recipe_id: recipeId, name: trimmed(item.name), dosage: trimmed(item.dosage), sort: index + 1 }));
        const steps = (payload.steps || [])
            .filter((item) => trimmed(item.content))
            .map((item, index) => ({ recipe_id: recipeId, sort: index + 1, content: trimmed(item.content), img_url: item.img_url || '' }));
        if (materials.length > 0) {
            const res = await cloud.database.from('recipe_materials').insert(materials);
            if (res.error) return { data: { id: recipeId }, error: '食材保存失败：' + message(res.error) };
        }
        if (steps.length > 0) {
            const res = await cloud.database.from('recipe_steps').insert(steps);
            if (res.error) return { data: { id: recipeId }, error: '步骤保存失败：' + message(res.error) };
        }
        return { data: { id: recipeId }, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

/* ---------------- 帖子 ---------------- */

async function decoratePosts(rows) {
    const list = rows || [];
    const flat = [];
    list.forEach((row) => (row.media || []).forEach((path) => flat.push(path)));
    const urls = await resolveMedia(flat);
    const videoUrls = await resolveMedia(list.map((row) => row.video_url));
    let cursor = 0;
    return list.map((row, rowIndex) => {
        const count = (row.media || []).length;
        const media = urls.slice(cursor, cursor + count);
        cursor += count;
        return Object.assign({}, row, {
            media: media,
            cover: media[0] || '',
            video: videoUrls[rowIndex] || '',
            timeText: formatRelative(row.created_at),
            isCheckin: row.post_type === 'checkin',
        });
    });
}

async function listPosts(params) {
    const p = params || {};
    const pageSize = p.pageSize || PAGE_SIZE;
    const page = p.page || 1;
    const from = (page - 1) * pageSize;
    try {
        let query = cloud.database.from('posts').select('*', { count: 'exact' }).eq('audit_status', 2);
        const keyword = safeLike(p.keyword);
        if (keyword) {
            const like = '%' + keyword + '%';
            query = query.or('title.ilike.' + like + ',content.ilike.' + like);
        }
        query =
            p.sort === 'hot'
                ? query.order('like_count', { ascending: false })
                : query.order('created_at', { ascending: false });
        const result = await query.range(from, from + pageSize - 1);
        if (result.error) return { data: null, error: message(result.error) };
        const list = await decoratePosts(result.data || []);
        const total = typeof result.count === 'number' ? result.count : list.length;
        return { data: { list: list, hasMore: from + list.length < total }, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function getPostDetail(id) {
    try {
        const result = await cloud.database.from('posts').select('*').eq('id', id).maybeSingle();
        if (result.error) return { data: null, error: message(result.error) };
        if (!result.data) return { data: null, error: '这个帖子不存在或已被删除' };
        const post = (await decoratePosts([result.data]))[0];
        post.isOwner = currentUid() && currentUid() === post.owner_id;
        if (post.rel_recipe_id) {
            const rel = await cloud.database
                .from('recipes')
                .select('id,name,cover_img,cuisine,cost_time,difficulty')
                .eq('id', post.rel_recipe_id)
                .maybeSingle();
            if (rel.data) {
                post.recipe = (await decorateRecipes([rel.data]))[0];
            }
        }
        const states = await Promise.all([isLiked('post', id), isCollected('post', id)]);
        post.liked = states[0];
        post.collected = states[1];
        return { data: post, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function createPost(payload) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    try {
        const row = {
            title: trimmed(payload.title),
            content: trimmed(payload.content),
            media: payload.media || [],
            video_url: payload.video_url || null,
            post_type: payload.rel_recipe_id ? 'checkin' : 'normal',
            rel_recipe_id: payload.rel_recipe_id || null,
            audit_status: 1,
            owner_name: displayName(),
        };
        const created = await cloud.database.from('posts').insert(row).select('id');
        if (created.error) return { data: null, error: message(created.error) };
        return { data: { id: created.data[0].id }, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function deletePost(id) {
    try {
        const result = await cloud.database.from('posts').delete().eq('id', id).select('id');
        if (result.error) return { error: message(result.error) };
        if (!result.data || result.data.length === 0) return { error: '没有权限删除这条内容' };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

async function deleteRecipe(id) {
    try {
        const result = await cloud.database.from('recipes').delete().eq('id', id).select('id');
        if (result.error) return { error: message(result.error) };
        if (!result.data || result.data.length === 0) return { error: '没有权限删除这条内容' };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

/* ---------------- 互动 ---------------- */

async function isLiked(targetType, targetId) {
    if (!currentUid()) return false;
    const result = await cloud.database
        .from('likes')
        .select('id')
        .eq('owner_id', currentUid())
        .eq('target_type', targetType)
        .eq('target_id', targetId)
        .limit(1);
    return !!(result.data && result.data.length > 0);
}

async function isCollected(targetType, targetId) {
    if (!currentUid()) return false;
    const result = await cloud.database
        .from('collects')
        .select('id')
        .eq('owner_id', currentUid())
        .eq('target_type', targetType)
        .eq('target_id', targetId)
        .limit(1);
    return !!(result.data && result.data.length > 0);
}

async function toggleLike(targetType, targetId) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    try {
        const result = await cloud.database.rpc('toggle_like', {
            p_target_type: targetType,
            p_target_id: Number(targetId),
        });
        if (result.error) return { data: null, error: message(result.error) };
        return { data: !!result.data, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function toggleCollect(targetType, targetId) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    try {
        const result = await cloud.database.rpc('toggle_collect', {
            p_target_type: targetType,
            p_target_id: Number(targetId),
        });
        if (result.error) return { data: null, error: message(result.error) };
        return { data: !!result.data, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function bumpView(targetType, targetId) {
    try {
        await cloud.database.rpc('bump_view', { p_target_type: targetType, p_target_id: Number(targetId) });
    } catch (error) {
        // 浏览量失败不影响阅读
    }
}

async function listComments(targetType, targetId) {
    try {
        const result = await cloud.database
            .from('comments')
            .select('*')
            .eq('target_type', targetType)
            .eq('target_id', targetId)
            .order('created_at', { ascending: true })
            .limit(200);
        if (result.error) return { data: null, error: message(result.error) };
        const rows = result.data || [];
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
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function addComment(targetType, targetId, content, parentId) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    try {
        const result = await cloud.database
            .from('comments')
            .insert({
                target_type: targetType,
                target_id: Number(targetId),
                content: trimmed(content),
                parent_id: parentId || null,
                owner_name: displayName(),
            })
            .select('id');
        if (result.error) return { data: null, error: message(result.error) };
        return { data: result.data[0], error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function deleteComment(id) {
    try {
        const result = await cloud.database.from('comments').delete().eq('id', id).select('id');
        if (result.error) return { error: message(result.error) };
        if (!result.data || result.data.length === 0) return { error: '没有权限删除这条评论' };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

/* ---------------- 关注 ---------------- */

async function isFollowing(targetUid) {
    if (!currentUid() || !targetUid || targetUid === currentUid()) return false;
    const result = await cloud.database
        .from('follows')
        .select('id')
        .eq('owner_id', currentUid())
        .eq('target_uid', targetUid)
        .limit(1);
    return !!(result.data && result.data.length > 0);
}

async function toggleFollow(targetUid) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    if (targetUid === currentUid()) return { data: null, error: '不能关注自己' };
    try {
        if (await isFollowing(targetUid)) {
            const res = await cloud.database.from('follows').delete().eq('owner_id', currentUid()).eq('target_uid', targetUid);
            if (res.error) return { data: null, error: message(res.error) };
            return { data: false, error: null };
        }
        const res = await cloud.database.from('follows').insert({ target_uid: targetUid });
        if (res.error) return { data: null, error: message(res.error) };
        return { data: true, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function countFollows(uid) {
    const [fans, following] = await Promise.all([
        cloud.database.from('follows').select('id', { count: 'exact', head: true }).eq('target_uid', uid),
        cloud.database.from('follows').select('id', { count: 'exact', head: true }).eq('owner_id', uid),
    ]);
    return { fans: fans.count || 0, following: following.count || 0 };
}

/* ---------------- 我的内容 / 收藏 ---------------- */

async function listMyContents() {
    if (!currentUid()) return { data: null, error: '请先登录' };
    try {
        const [recipes, posts] = await Promise.all([
            cloud.database.from('recipes').select('*').eq('owner_id', currentUid()).order('created_at', { ascending: false }).limit(100),
            cloud.database.from('posts').select('*').eq('owner_id', currentUid()).order('created_at', { ascending: false }).limit(100),
        ]);
        const recipeList = (await decorateRecipes(recipes.data || [])).map((row) =>
            Object.assign({}, row, { kind: 'recipe', kindText: '菜谱' })
        );
        const postList = (await decoratePosts(posts.data || [])).map((row) =>
            Object.assign({}, row, { kind: 'post', kindText: '帖子', cover: row.cover || '' })
        );
        const list = recipeList
            .concat(postList)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return { data: list, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function listFavorites() {
    if (!currentUid()) return { data: null, error: '请先登录' };
    try {
        const rows = await cloud.database
            .from('collects')
            .select('target_type,target_id,created_at')
            .eq('owner_id', currentUid())
            .order('created_at', { ascending: false })
            .limit(100);
        if (rows.error) return { data: null, error: message(rows.error) };
        const recipeIds = (rows.data || []).filter((row) => row.target_type === 'recipe').map((row) => row.target_id);
        const postIds = (rows.data || []).filter((row) => row.target_type === 'post').map((row) => row.target_id);
        const [recipes, posts] = await Promise.all([
            recipeIds.length
                ? cloud.database.from('recipes').select('*').in('id', recipeIds)
                : Promise.resolve({ data: [] }),
            postIds.length ? cloud.database.from('posts').select('*').in('id', postIds) : Promise.resolve({ data: [] }),
        ]);
        const recipeMap = {};
        (await decorateRecipes(recipes.data || [])).forEach((row) => {
            recipeMap[row.id] = Object.assign({}, row, { kind: 'recipe', kindText: '菜谱' });
        });
        const postMap = {};
        (await decoratePosts(posts.data || [])).forEach((row) => {
            postMap[row.id] = Object.assign({}, row, { kind: 'post', kindText: '帖子' });
        });
        const list = (rows.data || [])
            .map((row) =>
                row.target_type === 'recipe' ? recipeMap[row.target_id] : postMap[row.target_id]
            )
            .filter(Boolean);
        return { data: list, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

/* ---------------- 作者主页 ---------------- */

async function getAuthor(uid) {
    try {
        const [recipes, posts, followState] = await Promise.all([
            cloud.database.from('recipes').select('*').eq('owner_id', uid).eq('audit_status', 2).order('created_at', { ascending: false }).limit(50),
            cloud.database.from('posts').select('*').eq('owner_id', uid).eq('audit_status', 2).order('created_at', { ascending: false }).limit(50),
            isFollowing(uid),
        ]);
        const recipeList = (await decorateRecipes(recipes.data || [])).map((row) => Object.assign({}, row, { kind: 'recipe' }));
        const postList = (await decoratePosts(posts.data || [])).map((row) => Object.assign({}, row, { kind: 'post' }));
        const counts = await countFollows(uid);
        const name = (recipes.data && recipes.data[0] && recipes.data[0].owner_name) ||
            (posts.data && posts.data[0] && posts.data[0].owner_name) || '美食爱好者';
        const viewTotal = (recipes.data || []).reduce((sum, row) => sum + (row.view_count || 0), 0);
        const collectTotal = (recipes.data || []).reduce((sum, row) => sum + (row.collect_count || 0), 0);
        return {
            data: {
                uid: uid,
                name: name,
                recipes: recipeList,
                posts: postList,
                following: followState,
                fans: counts.fans,
                followingCount: counts.following,
                viewTotal: viewTotal,
                collectTotal: collectTotal,
            },
            error: null,
        };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

/* ---------------- 买菜清单 ---------------- */

async function listShopping() {
    if (!currentUid()) return { data: [], error: null };
    try {
        const result = await cloud.database
            .from('shopping_items')
            .select('*')
            .eq('owner_id', currentUid())
            .order('created_at', { ascending: true })
            .limit(200);
        if (result.error) return { data: null, error: message(result.error) };
        return { data: result.data || [], error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function addShoppingItems(items, recipe) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    try {
        const rows = (items || []).map((item) => ({
            name: trimmed(item.name),
            dosage: trimmed(item.dosage),
            source_recipe_id: recipe ? recipe.id : null,
            source_recipe_name: recipe ? recipe.name : '',
        }));
        if (rows.length === 0) return { data: null, error: '没有可添加的食材' };
        const result = await cloud.database.from('shopping_items').insert(rows);
        if (result.error) return { data: null, error: message(result.error) };
        return { data: rows.length, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function addShoppingItem(name, dosage) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    try {
        const result = await cloud.database.from('shopping_items').insert({ name: trimmed(name), dosage: trimmed(dosage) });
        if (result.error) return { data: null, error: message(result.error) };
        return { data: true, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function toggleShoppingItem(id, checked) {
    try {
        const result = await cloud.database.from('shopping_items').update({ checked: checked }).eq('id', id).select('id');
        if (result.error) return { error: message(result.error) };
        if (!result.data || result.data.length === 0) return { error: '操作失败，这条记录可能已不存在' };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

async function removeShoppingItem(id) {
    try {
        const result = await cloud.database.from('shopping_items').delete().eq('id', id).select('id');
        if (result.error) return { error: message(result.error) };
        if (!result.data || result.data.length === 0) return { error: '删除失败，这条记录可能已不存在' };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

async function clearShopping() {
    if (!currentUid()) return { error: '请先登录' };
    try {
        const result = await cloud.database.from('shopping_items').delete().eq('owner_id', currentUid()).select('id');
        if (result.error) return { error: message(result.error) };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

/* ---------------- 消息 ---------------- */

async function listNotices() {
    try {
        const result = await cloud.database
            .from('notices')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(20);
        return { data: (result.data || []).map((row) => Object.assign({}, row, { timeText: formatRelative(row.created_at) })), error: null };
    } catch (error) {
        return { data: [], error: message(error) };
    }
}

async function listAuditMessages() {
    if (!currentUid()) return { data: [], error: null };
    try {
        const [recipes, posts] = await Promise.all([
            cloud.database
                .from('recipes')
                .select('id,name,audit_status,reject_reason,created_at')
                .eq('owner_id', currentUid())
                .in('audit_status', [2, 3])
                .order('created_at', { ascending: false })
                .limit(30),
            cloud.database
                .from('posts')
                .select('id,title,audit_status,reject_reason,created_at')
                .eq('owner_id', currentUid())
                .in('audit_status', [2, 3])
                .order('created_at', { ascending: false })
                .limit(30),
        ]);
        const list = [];
        (recipes.data || []).forEach((row) => {
            list.push({
                id: 'r' + row.id,
                target: 'recipe',
                targetId: row.id,
                title: row.name,
                passed: row.audit_status === 2,
                reason: row.reject_reason || '',
                timeText: formatRelative(row.created_at),
                createdAt: row.created_at,
            });
        });
        (posts.data || []).forEach((row) => {
            list.push({
                id: 'p' + row.id,
                target: 'post',
                targetId: row.id,
                title: row.title,
                passed: row.audit_status === 2,
                reason: row.reject_reason || '',
                timeText: formatRelative(row.created_at),
                createdAt: row.created_at,
            });
        });
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return { data: list, error: null };
    } catch (error) {
        return { data: [], error: message(error) };
    }
}

async function listInteractions() {
    if (!currentUid()) return { data: [], error: null };
    try {
        const [recipes, posts] = await Promise.all([
            cloud.database.from('recipes').select('id,name').eq('owner_id', currentUid()).limit(100),
            cloud.database.from('posts').select('id,title').eq('owner_id', currentUid()).limit(100),
        ]);
        const nameMap = {};
        (recipes.data || []).forEach((row) => {
            nameMap['recipe:' + row.id] = row.name;
        });
        (posts.data || []).forEach((row) => {
            nameMap['post:' + row.id] = row.title;
        });
        const keys = Object.keys(nameMap);
        if (keys.length === 0) return { data: [], error: null };
        const comments = await cloud.database
            .from('comments')
            .select('id,owner_name,content,target_type,target_id,created_at')
            .order('created_at', { ascending: false })
            .limit(100);
        const list = (comments.data || [])
            .filter((row) => nameMap[row.target_type + ':' + row.target_id])
            .map((row) => ({
                id: row.id,
                who: row.owner_name || '一位食客',
                content: row.content,
                targetText: nameMap[row.target_type + ':' + row.target_id],
                target: row.target_type,
                targetId: row.target_id,
                timeText: formatRelative(row.created_at),
            }));
        return { data: list, error: null };
    } catch (error) {
        return { data: [], error: message(error) };
    }
}

/* ---------------- 审核 ---------------- */

async function isAdmin() {
    if (!currentUid()) return false;
    try {
        const result = await cloud.database.from('app_admins').select('uid').eq('uid', currentUid()).limit(1);
        return !!(result.data && result.data.length > 0);
    } catch (error) {
        return false;
    }
}

async function claimAdmin() {
    try {
        const result = await cloud.database.rpc('claim_admin');
        if (result.error) return { data: false, error: message(result.error) };
        return { data: !!result.data, error: null };
    } catch (error) {
        return { data: false, error: message(error) };
    }
}

async function listPending() {
    try {
        const [recipes, posts] = await Promise.all([
            cloud.database.from('recipes').select('*').eq('audit_status', 1).order('created_at', { ascending: true }).limit(50),
            cloud.database.from('posts').select('*').eq('audit_status', 1).order('created_at', { ascending: true }).limit(50),
        ]);
        const recipeList = (await decorateRecipes(recipes.data || [])).map((row) =>
            Object.assign({}, row, { kind: 'recipe', kindText: '菜谱', title: row.name })
        );
        const postList = (await decoratePosts(posts.data || [])).map((row) =>
            Object.assign({}, row, { kind: 'post', kindText: '帖子' })
        );
        return { data: recipeList.concat(postList), error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function moderate(kind, id, passed, reason) {
    try {
        const result = await cloud.database.rpc('moderate_content', {
            p_type: kind,
            p_id: Number(id),
            p_status: passed ? 2 : 3,
            p_reason: reason || null,
        });
        if (result.error) return { error: message(result.error) };
        if (!result.data) return { error: '没有找到这条内容' };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

/* ---------------- 筛选条件候选值 ---------------- */

async function listCuisineOptions() {
    try {
        const result = await cloud.database.from('recipes').select('cuisine').eq('audit_status', 2).limit(200);
        const seen = {};
        const list = [];
        (result.data || []).forEach((row) => {
            if (row.cuisine && !seen[row.cuisine]) {
                seen[row.cuisine] = true;
                list.push(row.cuisine);
            }
        });
        return list;
    } catch (error) {
        return [];
    }
}

/* ---------------- 举报 ---------------- */

async function submitReport(targetType, targetId, reason, detail) {
    if (!currentUid()) return { data: null, error: '请先登录' };
    try {
        const result = await cloud.database.rpc('submit_report', {
            p_target_type: targetType,
            p_target_id: Number(targetId),
            p_reason: reason,
            p_detail: detail || null,
        });
        if (result.error) return { data: null, error: message(result.error) };
        return { data: result.data, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function listReports(status) {
    try {
        let query = cloud.database
            .from('reports')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);
        if (status === 0 || status === 1) query = query.eq('status', status);
        const result = await query;
        if (result.error) return { data: null, error: message(result.error) };
        const list = (result.data || []).map((row) =>
            Object.assign({}, row, {
                timeText: formatRelative(row.created_at),
                typeText: row.target_type === 'recipe' ? '菜谱' : row.target_type === 'post' ? '帖子' : '评论',
                statusText: row.status === 0 ? '待处理' : '已处理',
                resultText: row.status === 0 ? '' : row.result === 1 ? '违规下架' : '判定合规',
            })
        );
        return { data: list, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function handleReport(id, result, remark) {
    try {
        const res = await cloud.database.rpc('handle_report', {
            p_id: Number(id),
            p_result: result ? 1 : 0,
            p_remark: remark || null,
        });
        if (res.error) return { error: message(res.error) };
        if (!res.data) return { error: '工单不存在或已处理' };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

/* ---------------- 配置 ---------------- */

async function getConfig() {
    try {
        const result = await cloud.database.from('app_config').select('config_key,config_value');
        const map = {};
        (result.data || []).forEach((row) => {
            map[row.config_key] = row.config_value;
        });
        return { data: map, error: null };
    } catch (error) {
        return { data: {}, error: message(error) };
    }
}

async function getSubscribeTemplates() {
    const config = await getConfig();
    const raw = (config.data && config.data.subscribe_templates) || '';
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/* ---------------- 短视频 ---------------- */

async function uploadVideo(tempPath, size) {
    if (!currentUid()) return { data: null, error: '请先登录后再上传视频' };
    const limitMb = 20;
    if (size && size > limitMb * 1024 * 1024) {
        return { data: null, error: '视频不能超过 ' + limitMb + 'MB' };
    }
    try {
        const path = cloud.storage.sharedPath(
            currentUid(),
            'video/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.mp4'
        );
        const buffer = wx.getFileSystemManager().readFileSync(tempPath);
        const result = await cloud.storage.upload(path, buffer, {
            contentType: 'video/mp4',
            upsert: true,
        });
        if (result.error) return { data: null, error: message(result.error) };
        return { data: path, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

/* ---------------- 管理台 ---------------- */

async function listAllRecipes() {
    try {
        const result = await cloud.database
            .from('recipes')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);
        if (result.error) return { data: null, error: message(result.error) };
        return { data: await decorateRecipes(result.data || []), error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function listAllPosts() {
    try {
        const result = await cloud.database
            .from('posts')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);
        if (result.error) return { data: null, error: message(result.error) };
        return { data: await decoratePosts(result.data || []), error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function adminContent(kind, id, action) {
    try {
        const res = await cloud.database.rpc('admin_content_action', {
            p_type: kind,
            p_id: Number(id),
            p_action: action,
        });
        if (res.error) return { error: message(res.error) };
        if (!res.data) return { error: '没有找到这条内容' };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

async function listAuthors() {
    try {
        const [recipes, posts, comments, bans] = await Promise.all([
            cloud.database.from('recipes').select('owner_id,owner_name').limit(200),
            cloud.database.from('posts').select('owner_id,owner_name').limit(200),
            cloud.database.from('comments').select('owner_id,owner_name').limit(200),
            cloud.database.from('user_ban').select('uid,reason').limit(200),
        ]);
        const banMap = {};
        (bans.data || []).forEach((row) => {
            banMap[row.uid] = row.reason || '违规';
        });
        const map = {};
        []
            .concat(recipes.data || [])
            .concat(posts.data || [])
            .concat(comments.data || [])
            .forEach((row) => {
                if (!row.owner_id || row.owner_id === 'official') return;
                if (!map[row.owner_id]) {
                    map[row.owner_id] = { uid: row.owner_id, name: row.owner_name || '未设置昵称', count: 0 };
                }
                map[row.owner_id].count += 1;
                if (row.owner_name) map[row.owner_id].name = row.owner_name;
            });
        const list = Object.keys(map).map((uid) =>
            Object.assign({}, map[uid], { banned: !!banMap[uid], banReason: banMap[uid] || '' })
        );
        list.sort((a, b) => b.count - a.count);
        return { data: list, error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function adminUser(uid, action, reason) {
    try {
        const res = await cloud.database.rpc('admin_user_action', {
            p_uid: uid,
            p_action: action,
            p_reason: reason || null,
        });
        if (res.error) return { error: message(res.error) };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

async function listNoticesAll() {
    try {
        const result = await cloud.database
            .from('notices')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        if (result.error) return { data: null, error: message(result.error) };
        return { data: result.data || [], error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function adminNotice(action, id, title, content, active) {
    try {
        const res = await cloud.database.rpc('admin_notice_action', {
            p_action: action,
            p_id: id ? Number(id) : null,
            p_title: title || null,
            p_content: content || null,
            p_active: active === undefined ? null : !!active,
        });
        if (res.error) return { error: message(res.error) };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

async function listWords() {
    try {
        const result = await cloud.database
            .from('sensitive_words')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(300);
        if (result.error) return { data: null, error: message(result.error) };
        return { data: result.data || [], error: null };
    } catch (error) {
        return { data: null, error: message(error) };
    }
}

async function adminWord(action, id, word) {
    try {
        const res = await cloud.database.rpc('admin_word_action', {
            p_action: action,
            p_id: id ? Number(id) : null,
            p_word: word || null,
        });
        if (res.error) return { error: message(res.error) };
        return { error: null };
    } catch (error) {
        return { error: message(error) };
    }
}

/* ---------------- 申诉 ----------------
   自动审核 + 申诉链路由自建服务端实现（utils/config.js 的 selfhost 模式）。
   托管云模式没有对应接口，这里给出明确降级，避免页面调用 undefined。 */

const APPEAL_UNAVAILABLE = { data: null, error: '当前数据源暂未开通自动审核与申诉，请切换到 selfhost 模式' };

async function getAppealContext() {
    return APPEAL_UNAVAILABLE;
}

async function submitAppeal() {
    return APPEAL_UNAVAILABLE;
}

async function listMyAppeals() {
    return { data: [], error: null };
}

async function listAdminAppeals() {
    return { data: [], error: APPEAL_UNAVAILABLE.error, pending: 0 };
}

async function handleAdminAppeal() {
    return { error: APPEAL_UNAVAILABLE.error };
}

function normalizeAudit(raw) {
    if (!raw || !raw.decision) {
        return { decision: 'review', status: 1, score: 0, code: '', reasons: [], hint: '', checkedAt: '' };
    }
    return {
        decision: raw.decision,
        status: Number(raw.status) || 1,
        score: raw.score || 0,
        code: raw.code || '',
        reasons: raw.reasons || [],
        hint: raw.hint || '',
        checkedAt: raw.checked_at || '',
    };
}

module.exports = {
    PAGE_SIZE,
    message,
    normalizeAudit,
    getSession,
    signOut,
    currentUser,
    currentUid,
    displayName,
    resolveMedia,
    uploadImage,
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
    getSubscribeTemplates,
    uploadVideo,
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
