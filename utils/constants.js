const CUISINES = ['川菜', '湘菜', '粤菜', '鲁菜', '闽菜', '浙菜', '苏菜', '徽菜', '客家菜', '东北菜', '家常菜', '甜品'];
const TASTES = ['不吃辣', '微辣', '中辣', '重辣', '酸甜', '清淡', '咸鲜', '咸甜'];
const DIFFICULTIES = ['简单', '中等', '困难'];
const MEALS = ['早餐', '午餐', '晚餐', '夜宵'];

// 首页快捷标签：quick / takeaway 走布尔字段，其余走 tags 数组
const QUICK_TAGS = [
    { label: '快手菜', field: 'quick' },
    { label: '适合外卖', field: 'takeaway' },
    { label: '汤品', field: 'tag' },
    { label: '小吃', field: 'tag' },
    { label: '硬菜', field: 'tag' },
    { label: '减脂餐', field: 'tag' },
    { label: '下饭菜', field: 'tag' },
    { label: '家常菜', field: 'tag' },
];

const FORM_TAGS = ['适合外卖', '快手菜', '下饭菜', '硬菜', '减脂餐', '汤品', '小吃', '家常菜'];

const SORTS = [
    { key: 'latest', label: '最新' },
    { key: 'collect', label: '收藏最多' },
    { key: 'like', label: '点赞最高' },
];

const AUDIT = {
    DRAFT: 0,
    REVIEWING: 1,
    PASSED: 2,
    REJECTED: 3,
};

const AUDIT_TEXT = {
    0: '草稿',
    1: '审核中',
    2: '已通过',
    3: '已驳回',
};

module.exports = {
    CUISINES,
    TASTES,
    DIFFICULTIES,
    MEALS,
    QUICK_TAGS,
    FORM_TAGS,
    SORTS,
    AUDIT,
    AUDIT_TEXT,
};
