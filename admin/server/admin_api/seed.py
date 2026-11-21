from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .models import (
    Admin,
    AppConfig,
    Comment,
    Notice,
    Post,
    Recipe,
    RecipeMaterial,
    RecipeStep,
    Report,
    Role,
    SensitiveWord,
    User,
)
from .security import hash_password

ROLES = [
    {
        "code": "super",
        "name": "超级管理员",
        "permissions": [
            "stats:view",
            "audit:review",
            "report:handle",
            "content:manage",
            "user:manage",
            "notice:manage",
            "word:manage",
            "admin:manage",
        ],
    },
    {
        "code": "ops",
        "name": "运营管理员",
        "permissions": [
            "stats:view",
            "audit:review",
            "report:handle",
            "content:manage",
            "notice:manage",
            "word:manage",
        ],
    },
    {"code": "auditor", "name": "审核员", "permissions": ["stats:view", "audit:review", "report:handle"]},
]

RECIPES = [
    ("宫保鸡丁", "川菜", "四川", "微辣", "简单", 25, True, True, "午餐", "裹着酸甜微辣的酱汁，一碗米饭不够。",
     ["下饭菜", "快手菜", "适合外卖"],
     [("鸡腿肉", "300g"), ("油炸花生米", "50g"), ("干辣椒", "8个"), ("生抽", "2勺")],
     ["鸡腿肉切丁腌制 10 分钟。", "调好碗汁备用。", "热锅滑炒鸡丁后盛出。", "爆香辣椒花椒，回锅淋汁，拌入花生米。"]),
    ("辣椒炒肉", "湘菜", "湖南", "重辣", "简单", 20, True, True, "晚餐", "湖南人的命门菜，锅气就是全部秘密。",
     ["下饭菜", "快手菜", "适合外卖"],
     [("五花肉", "250g"), ("螺丝椒", "200g"), ("豆豉", "1勺"), ("生抽", "2勺")],
     ["五花肉切薄片，椒切滚刀块。", "干锅煸椒至虎皮盛出。", "煸肉出油后下豆豉蒜片。", "回锅青椒大火 20 秒出锅。"]),
    ("番茄炒蛋", "家常菜", "全国", "酸甜", "简单", 10, True, True, "早餐", "永远吃不腻的那道菜。",
     ["快手菜", "减脂餐", "适合外卖"],
     [("番茄", "3个"), ("鸡蛋", "4个"), ("白糖", "1小匙"), ("盐", "适量")],
     ["番茄去皮切块。", "鸡蛋打散炒至半凝固。", "番茄加糖炒出汁。", "回锅鸡蛋翻匀收汁。"]),
    ("白切鸡", "粤菜", "广东", "清淡", "中等", 50, True, False, "晚餐", "皮爽肉滑，一碟姜葱酱油就够。",
     ["硬菜", "家常菜"],
     [("三黄鸡", "1只"), ("姜", "1块"), ("小葱", "3根"), ("香油", "1勺")],
     ["水加姜葱烧开，三提三放。", "微沸浸煮 18 分钟再焖 10 分钟。", "捞出冰水浸透。", "斩件配姜葱蘸料。"]),
    ("麻婆豆腐", "川菜", "四川", "中辣", "简单", 20, True, True, "晚餐", "麻辣鲜香烫，豆腐嫩到用勺推。",
     ["下饭菜", "快手菜", "适合外卖"],
     [("嫩豆腐", "400g"), ("牛肉末", "100g"), ("豆瓣酱", "2勺"), ("花椒粉", "1小匙")],
     ["豆腐盐水浸 5 分钟。", "炒酥牛肉末加豆瓣酱。", "加水下豆腐小火煮。", "两次勾芡撒花椒粉。"]),
    ("清蒸鲈鱼", "粤菜", "广东", "清淡", "简单", 30, False, False, "晚餐", "鱼够新鲜，蒸八分钟就够。",
     ["硬菜", "减脂餐"],
     [("鲈鱼", "1条"), ("姜", "1块"), ("小葱", "2根"), ("蒸鱼豉油", "3勺")],
     ["鱼划刀抹盐。", "铺姜葱水开蒸 8 分钟。", "倒腥水换新葱丝。", "淋豉油浇热油。"]),
]

POSTS = [
    ("第一次做宫保鸡丁就成功了", "碗汁提前调好真的能救场，花生米一定最后放。", "checkin"),
    ("楼下那家开了十年的牛肉粉", "清汤不是红汤，加酸豆角和糊辣，早上七点就排队。", "normal"),
    ("十五分钟搞定一碗葱油拌面", "熬到葱发黑那一刻厨房全是香的。", "normal"),
    ("周末在家做了一桌湘菜", "辣椒炒肉 + 小炒黄牛肉，米饭煮了三锅。", "normal"),
]


def seed(db: Session):
    if db.query(Role).count() == 0:
        for item in ROLES:
            db.add(Role(code=item["code"], name=item["name"], permissions=item["permissions"]))
        db.commit()

    if db.query(Admin).count() == 0:
        db.add_all(
            [
                Admin(username="admin", password_hash=hash_password("Admin@123456"), name="超级管理员", role_code="super"),
                Admin(username="ops", password_hash=hash_password("Ops@123456"), name="运营小王", role_code="ops"),
                Admin(username="auditor", password_hash=hash_password("Audit@123456"), name="审核员小李", role_code="auditor"),
            ]
        )
        db.commit()

    # 已经导入过真实数据（或跑过一次种子）就不再注入演示内容，
    # 否则空表会被重新填上演示用户和演示举报，指向真实内容。
    if db.query(AppConfig).filter(AppConfig.config_key == "initialized").first() is not None:
        return

    if db.query(User).count() == 0:
        users = [
            ("u_1001", "吃遍成都", "chengdu@demo.com"),
            ("u_1002", "湘妹子阿雅", "aya@demo.com"),
            ("u_1003", "减脂中", "fit@demo.com"),
            ("u_1004", "夜宵猎手", "night@demo.com"),
            ("u_1005", "厨房小白", "newbie@demo.com"),
        ]
        for index, (uid, nickname, email) in enumerate(users):
            db.add(
                User(
                    uid=uid,
                    nickname=nickname,
                    email=email,
                    created_at=datetime.now() - timedelta(days=index * 3 + 1),
                )
            )
        db.commit()

    if db.query(Recipe).count() == 0:
        base = datetime.now() - timedelta(days=12)
        for index, item in enumerate(RECIPES):
            name, cuisine, region, taste, difficulty, cost, takeaway, quick, meal, summary, tags, materials, steps = item
            owner = "official" if index % 2 == 0 else "u_1001"
            row = Recipe(
                name=name,
                cuisine=cuisine,
                region=region,
                taste=taste,
                difficulty=difficulty,
                cost_time=cost,
                fit_takeaway=takeaway,
                fit_quick=quick,
                meal_type=meal,
                summary=summary,
                tags=tags,
                owner_id=owner,
                owner_name="今天吃什么编辑部" if owner == "official" else "吃遍成都",
                cover_img=f"/assets/covers/dish{index + 1}.jpg",
                audit_status=2,
                is_official=owner == "official",
                weight=100 - index * 5,
                like_count=180 + index * 23,
                collect_count=120 + index * 17,
                view_count=1800 + index * 320,
                created_at=base + timedelta(days=index),
            )
            db.add(row)
            db.flush()
            for sort, (m_name, dosage) in enumerate(materials, start=1):
                db.add(RecipeMaterial(recipe_id=row.id, name=m_name, dosage=dosage, sort=sort))
            for sort, content in enumerate(steps, start=1):
                db.add(RecipeStep(recipe_id=row.id, sort=sort, content=content))

        # 两条待审内容，方便直接体验审核流程
        pending = Recipe(
            name="蒜香黄油虾",
            cuisine="家常菜",
            region="全国",
            taste="咸鲜",
            difficulty="简单",
            cost_time=20,
            fit_quick=True,
            meal_type="晚餐",
            summary="黄油加蒜末，虾壳都想嚼碎。",
            tags=["快手菜"],
            owner_id="u_1005",
            owner_name="厨房小白",
            cover_img="/assets/covers/dish10.jpg",
            audit_status=1,
            created_at=datetime.now() - timedelta(hours=6),
        )
        db.add(pending)
        db.commit()

    if db.query(Post).count() == 0:
        base = datetime.now() - timedelta(days=6)
        for index, (title, content, post_type) in enumerate(POSTS):
            owner = "official" if index % 2 == 0 else "u_1002"
            db.add(
                Post(
                    title=title,
                    content=content,
                    post_type=post_type,
                    media=[f"/assets/covers/dish{index + 2}.jpg"],
                    owner_id=owner,
                    owner_name="今天吃什么编辑部" if owner == "official" else "湘妹子阿雅",
                    audit_status=2,
                    rel_recipe_id=1 if post_type == "checkin" else None,
                    like_count=40 + index * 15,
                    collect_count=12 + index * 6,
                    view_count=600 + index * 180,
                    created_at=base + timedelta(days=index),
                )
            )
        db.add(
            Post(
                title="这家店的招牌菜想复刻一下",
                content="味道很特别，但是店家好像在做推广，评论区全是联系方式。",
                media=[],
                owner_id="u_1004",
                owner_name="夜宵猎手",
                audit_status=1,
                created_at=datetime.now() - timedelta(hours=3),
            )
        )
        db.commit()

    if db.query(Comment).count() == 0:
        db.add_all(
            [
                Comment(owner_id="u_1002", owner_name="湘妹子阿雅", target_type="recipe", target_id=1, content="花生米最后放这点很关键，学到了。"),
                Comment(owner_id="u_1003", owner_name="减脂中", target_type="recipe", target_id=1, content="糖可以减半吗？"),
                Comment(owner_id="u_1001", owner_name="吃遍成都", target_type="post", target_id=1, content="看着就很下饭。"),
                Comment(owner_id="u_1005", owner_name="厨房小白", target_type="post", target_id=2, content="求具体地址！"),
            ]
        )
        db.commit()

    if db.query(Report).count() == 0:
        db.add_all(
            [
                Report(
                    reporter_id="u_1003",
                    reporter_name="减脂中",
                    target_type="post",
                    target_id=5,
                    target_owner_id="u_1004",
                    target_title="这家店的招牌菜想复刻一下",
                    reason="广告引流",
                    detail="评论区在留联系方式",
                    status=0,
                ),
                Report(
                    reporter_id="u_1001",
                    reporter_name="吃遍成都",
                    target_type="recipe",
                    target_id=2,
                    target_owner_id="u_1001",
                    target_title="辣椒炒肉",
                    reason="其他",
                    detail="重复投稿",
                    status=1,
                    result=0,
                    handle_remark="内容正常，重复投稿已提醒",
                    handled_by="审核员小李",
                    handled_at=datetime.now() - timedelta(days=1),
                ),
            ]
        )
        db.commit()

    if db.query(Notice).count() == 0:
        db.add_all(
            [
                Notice(title="欢迎来到今天吃什么", content="首页点「抽一道」就能随机抽菜；看到想吃的，复制菜名去外卖平台搜同款。"),
                Notice(title="社区规范更新", content="请勿发布广告引流、联系方式类内容，违规内容将被下架。", is_active=False),
            ]
        )
        db.commit()

    if db.query(SensitiveWord).count() == 0:
        words = ["加微信", "微信号", "微信联系", "加QQ", "私聊我", "代购", "刷单", "返现", "点击链接", "二维码", "广告合作", "微商"]
        for word in words:
            db.add(SensitiveWord(word=word))
        db.commit()

    if db.query(AppConfig).filter(AppConfig.config_key == "initialized").first() is None:
        db.add(AppConfig(config_key="initialized", config_value="1", remark="初始化标记：演示数据只写一次"))
        db.commit()
