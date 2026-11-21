# 今天吃什么 · PC 管理后台（路线 A）

> 位置：`D:/dask/eat-what-admin`。**刻意放在小程序工程（`D:/dask/miaoda-code`）之外**：
> 里面的 `.venv` 有 `_rust.pyd` 等二进制（单个 >2MB）、`web/node_modules` 有 esbuild.exe（9.5MB），
> 放在小程序目录里会让预览打包校验失败。

自建 FastAPI 管理服务 + Vue3 管理界面。**不依赖托管云**，用标准 PostgreSQL / SQLite 存数据，服务端凭证连库，因此 PC 浏览器可以正常访问。

## 一、目录

```
eat-what-admin/
├── server/                     # FastAPI 服务（后台接口 + 小程序接口）
│   ├── admin_api/
│   │   ├── main.py             # 入口（含前端 dist、/uploads、/covers 托管）
│   │   ├── config.py           # 环境配置（DATABASE_URL / SECRET_KEY / WX_APPID）
│   │   ├── db.py               # 引擎与会话
│   │   ├── models.py           # 全部数据表（后台 13 张 + 小程序业务 6 张）
│   │   ├── security.py         # 密码哈希 + 双 scope JWT
│   │   ├── deps.py             # 后台登录态、小程序用户态、权限校验
│   │   ├── seed.py             # 演示数据（带 initialized 标记，只写一次）
│   │   ├── serializers.py
│   │   └── routers/            # auth / stats / audit / reports / content / users / system / miniapp
│   ├── migration/
│   │   └── cloud-dump.json     # 托管云导出的原始数据
│   ├── scripts/
│   │   └── import_cloud.py     # 导入脚本（replace / --merge）
│   ├── requirements.txt
│   ├── run.py
│   └── .env.example
├── web/                        # Vue3 + Ant Design Vue
│   ├── src/views/              # 12 个页面
│   ├── src/api.js              # 统一请求封装
│   ├── src/router.js           # 路由 + 权限守卫
│   └── vite.config.js
```

小程序的接口冒烟测试在 `D://dask//miaoda-code//tools//smoke-selfhost.js`（它要 require 小程序的数据层，所以留在小程序工程里，但已在 `packOptions.ignore` 中排除，不进包）。

## 二、启动

### 1. 后端（默认 SQLite，开箱即用）

```bash
cd server
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn admin_api.main:app --host 127.0.0.1 --port 8000
```

首次启动会自动建表。空库会写入一批演示数据；如果已经跑过 `scripts/import_cloud.py`，则直接使用导入的真实数据（`app_config.initialized` 标记会阻止演示数据覆盖）。接口文档：http://127.0.0.1:8000/docs

### 2. 前端

```bash
cd web
npm install
npm run dev
```

打开 http://127.0.0.1:5173 （`/api` 已代理到 8000）。

### 3. 演示账号

| 账号 | 密码 | 角色 | 能做什么 |
| --- | --- | --- | --- |
| admin | Admin@123456 | 超级管理员 | 全部模块 |
| ops | Ops@123456 | 运营管理员 | 审核、举报、内容、公告、词库、大盘 |
| auditor | Audit@123456 | 审核员 | 审核、举报、大盘 |

用 auditor 登录可以看到「菜谱管理」菜单不存在，直接访问 URL 也会被路由守卫挡回大盘——权限是前后端双层的。

## 三、切到 PostgreSQL

改 `server/.env`：

```env
DATABASE_URL=postgresql+psycopg://eat_what:密码@127.0.0.1:5432/eat_what
SECRET_KEY=换成一串随机长字符串
CORS_ORIGINS=https://admin.your-domain.com
```

然后 `pip install "psycopg[binary]"`，重启即可。表会自动创建，演示数据只在空库时写入。

> 不需要 `auth.uid()` 之类的云平台函数：权限全部由服务端 RBAC 控制，数据库只做存储。

## 四、已实现的模块

| 模块 | 能力 |
| --- | --- |
| 登录 | 账密登录、JWT、修改密码、停用账号拦截 |
| 数据大盘 | 内容/用户/待审总量、近 7 天投稿趋势、菜系分布、热门菜谱、活跃作者 |
| 审核中心 | 待审池（菜谱+帖子）、通过、驳回（理由必填）、审核日志 |
| 举报工单 | 待处理/已处理、判定合规、违规下架（自动改内容状态或删评论）、处理备注 |
| 菜谱管理 | 搜索、状态筛选、编辑基础信息、置顶、下架、恢复、删除 |
| 帖子管理 | 搜索、状态筛选、置顶、下架、恢复、删除 |
| 评论管理 | 全量搜索、删除（子回复一并删） |
| 用户管理 | 搜索、详情（内容量）、封禁（必填原因）、解封 |
| 公告管理 | 新建、编辑、展示/隐藏、删除 |
| 敏感词库 | 新增、批量导入、删除 |
| 账号与权限 | 新建/编辑/删除后台账号、角色对照表 |
| 操作日志 | 全量写操作留痕（操作人、动作、对象、详情、IP） |

## 五、小程序业务接口（/v1）与数据合并

同一个服务现在同时提供两套接口：

| 前缀 | 使用方 | 鉴权 |
| --- | --- | --- |
| `/api/**` | PC 后台 | 后台账号 JWT（`scope=admin`，8 小时） |
| `/v1/**` | 微信小程序 | 小程序用户 JWT（`scope=user`，90 天） |

两套令牌同一把密钥、不同 scope，**互不通用**：后台令牌打 `/v1/admin/*` 返回 401，用户令牌打 `/api/*` 返回 403。

### 5.1 小程序侧怎么切

只改 `utils/config.js` 一行：

```js
const DATA_MODE = 'selfhost';                 // 'cloud' | 'selfhost'
const SELFHOST_BASE = 'http://127.0.0.1:8000';
```

`utils/api.js` 是分发器：`cloud` → `api-cloud.js`（原托管云实现），`selfhost` → `api-selfhost.js`（`wx.request` 调 `/v1`）。两个实现同名同签名，**页面代码一行没改**。

### 5.2 /v1 接口清单

| 分组 | 接口 |
| --- | --- |
| 登录 | `POST /v1/auth/login`、`GET/PATCH /v1/me`、`POST /v1/me/claim-admin` |
| 菜谱 | `GET /v1/recipes`（筛选/搜索/排序/分页）、`GET /v1/recipes/random`、`GET /v1/recipes/{id}`、`POST /v1/recipes`、`DELETE /v1/recipes/{id}` |
| 帖子 | `GET /v1/posts`、`GET /v1/posts/{id}`、`POST /v1/posts`、`DELETE /v1/posts/{id}` |
| 互动 | `POST /v1/likes/toggle`、`POST /v1/collects/toggle`、`GET /v1/interactions/state`、`POST /v1/views` |
| 评论 | `GET /v1/comments`、`POST /v1/comments`、`DELETE /v1/comments/{id}` |
| 关注 | `GET /v1/follows/state`、`POST /v1/follows/toggle` |
| 我的 | `/v1/me/contents`、`/v1/me/favorites`、`/v1/me/audit-messages`、`/v1/me/interactions`、`/v1/users/{uid}` |
| 买菜清单 | `GET/POST /v1/shopping`、`POST /v1/shopping/batch`、`PATCH/DELETE /v1/shopping/{id}` |
| 其他 | `/v1/notices`、`/v1/config`、`/v1/meta/cuisines`、`POST /v1/reports`、`POST /v1/upload` |
| 小程序内置管理台 | `/v1/admin/pending`、`/v1/admin/moderate`、`/v1/admin/reports[/{id}/handle]`、`/v1/admin/contents[/action]`、`/v1/admin/authors`、`/v1/admin/users/{uid}/action`、`/v1/admin/notices[/action]`、`/v1/admin/words[/action]` |

错误码沿用云端那套字符串（`SIGN_IN_REQUIRED` / `SENSITIVE_WORD:xx` / `USER_BANNED` / `NOT_FOUND` …），所以 `utils/api.js` 里的错误文案映射不用改。

### 5.3 数据迁移

已经跑过一次，可重复执行：

```bash
cd server
.venv\Scripts\python -m scripts.import_cloud            # 清空业务表，按原 id 写入
.venv\Scripts\python -m scripts.import_cloud --merge    # 或只补缺失，不删旧数据
```

- 默认 replace 会清空 12 张业务表（含 `users`），**不动** `admins` / `roles` / `operation_logs`。
- 保留原始 id，收藏、点赞、举报的 `target_id` 不会错位。
- 迁移完会写 `app_config.initialized=1`；服务启动时的演示种子看到这个标记就跳过，不会再往空表里塞演示用户。
- 原始数据在 `migration/cloud-dump.json`（云端 `json_agg` 导出），换环境时带上这个文件即可。

### 5.4 回归测试

```bash
cd D:/dask/miaoda-code
node tools/smoke-selfhost.js
```

用 Node 模拟 `wx.request`，跑 31 项：登录、恢复会话、列表、详情、随机抽菜、点赞、评论增删、清单增删勾选、收藏、发布、敏感词拦截、审核、举报、作者主页、退出。全绿才算接口没问题。加 `SMOKE_DEVICE=xxx` 可指定测试账号。

### 5.5 联调注意

- 开发者工具要关掉「校验合法域名」（`project.config.json` 已设 `urlCheck: false`）。
- 真机预览不能用 `127.0.0.1`，改成电脑局域网 IP（`http://192.168.x.x:8000`），手机与电脑同一 WiFi。
- 正式发布必须是 **https 域名**，并在公众平台「服务器域名」里同时配 `request` 和 `uploadFile`。
- 生产把上传目录换成 COS/OSS；现在 `/uploads` 只是本地落盘。
- 配置了 `WX_APPID` / `WX_SECRET` 后，`/v1/auth/login` 会走 `jscode2session` 换 openid；没配则按设备号派生 uid（只适合开发调试，换设备就换账号）。

## 六、生产部署

```bash
cd web && npm run build       # 产物在 web/dist
cd ../server && uvicorn admin_api.main:app --host 0.0.0.0 --port 8000
```

后端会自动托管 `web/dist`（同域，免 CORS）。前面加一层 Nginx 做 HTTPS 即可。

上线前必须改：`SECRET_KEY`、数据库密码、`CORS_ORIGINS`、演示账号密码或直接删除演示账号。

## 七、已知边界

- 没有做图片裁剪/压缩：原图直接落盘，正式环境应在客户端压缩后再传，或接 CDN 转码。
- 没有做导出：日报导出需要额外的 xlsx 依赖，按需再加。
- 没有做批量审核：待审量上来后建议加多选 + 批量通过（接口层已支持逐条，前端加多选即可）。
- 角色是固定的三种，权限点是硬编码在 `seed.py` 的角色表里；要自定义角色，把 `roles.permissions` 做成可编辑即可，模型已经支持。
- 小程序与后台是两套身份：`app_admins` 是「谁能在小程序里审核」，`admins` 是「谁能登录 PC 后台」，同一个真人可能需要各绑一次。
- 私信、订阅消息的服务端推送仍未做（订阅消息模板 ID 还是空的），小程序里对应入口会明确提示未开通。
