"""内容自动审核引擎（规则版）。

三条设计原则：
1. 确定性：同样的文本永远得出同样的结论，用户申诉时能解释清楚"为什么被驳回"。
2. 可解释：结论带回命中规则、命中片段和分数，驳回理由直接下发给用户。
3. 可降级：拿不准的内容转人工（review），不硬判，避免误杀正常内容。

判定流程：多类规则并行扫描 -> 累计风险分 -> 分数映射为 pass / review / reject。

规则来源：
- 敏感词库（sensitive_words 表，level=1 视为严重违规，直接驳回）
- 内置规则集（联系方式导流、广告营销、医疗功效、辱骂、标题党、灌水）
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

ENGINE_VERSION = "rule-v1"

DECISION_PASS = "pass"
DECISION_REVIEW = "review"
DECISION_REJECT = "reject"

# 结论 -> 内容的 audit_status（0 草稿 / 1 审核中 / 2 已通过 / 3 已驳回）
STATUS_BY_DECISION = {DECISION_PASS: 2, DECISION_REVIEW: 1, DECISION_REJECT: 3}

# 分数阈值：达到 REJECT_SCORE 直接驳回，达到 REVIEW_SCORE 转人工
REJECT_SCORE = 60
REVIEW_SCORE = 25

# 单条规则权重 >= 该值视为"硬红线"，不看总分直接驳回
HARD_RULE_WEIGHT = 70

MAX_REASON_LEN = 250


@dataclass(frozen=True)
class Rule:
    code: str
    label: str
    weight: int
    patterns: tuple[str, ...]
    hint: str = ""


@dataclass
class Signal:
    code: str
    label: str
    weight: int
    hits: list[str] = field(default_factory=list)


# ---------------- 内置规则集 ----------------
# 说明：词表刻意保持"类目化"，不做穷举，方便后续在后台词库里补。
# 命中的是"意图"，不是具体某个词，减少维护成本。

RULES: tuple[Rule, ...] = (
    Rule(
        code="FORBIDDEN",
        label="内容涉及违规品或违法交易",
        weight=100,
        patterns=(
            r"赌博|博彩|六合彩|百家乐|赌球|下注|老虎机|棋牌室",
            r"毒品|冰毒|大麻|摇头丸|吸毒",
            r"枪支|弹药|仿真枪|管制刀具",
            r"代开发票|办假证|办理证件|假证|假文凭",
            r"裸聊|约炮|援交|一夜情|成人片|色情服务",
            r"传销|拉人头|资金盘",
        ),
        hint="社区只聊吃，违法和违禁品相关内容一律不放行。",
    ),
    Rule(
        code="CONTACT_INFO",
        label="内容里留了联系方式或外部链接",
        weight=85,
        patterns=(
            r"1[3-9]\d{9}",
            r"(?:微信|weixin|wx|vx|薇信|威信)\s*[:：]?\s*[a-zA-Z0-9_-]{5,}",
            r"qq\s*[:：]?\s*\d{5,12}",
            r"加微信|加我微信|加个微信|私聊|私信我|私我|扫码|扫二维码|二维码|加群|进群",
            r"https?://|www\.",
        ),
        hint="请勿在内容中留手机号、微信号、QQ、二维码或站外链接。",
    ),
    Rule(
        code="ADVERTISING",
        label="内容带有广告或引流倾向",
        weight=55,
        patterns=(
            r"代购|微商|刷单|返现|优惠券|秒杀|招商|加盟|代理|分销|带货|拼团",
            r"引流|私域|推广合作|广告合作|商务合作|shop|下单|购买链接|淘宝|拼多多",
            r"公众号|抖音号|小红书号|快手号",
        ),
        hint="分享美食可以，但不要在社区里做生意。",
    ),
    Rule(
        code="MEDICAL_CLAIM",
        label="内容宣称了医疗或保健功效",
        weight=55,
        patterns=(
            r"包治|根治|降三高|降血压|降血糖|治百病|药效|偏方|排毒|壮阳|特效药|减肥药",
            r"抗癌|防癌|增强免疫力治",
        ),
        hint="食物不是药，涉及疗效的表述容易被判定为虚假宣传。",
    ),
    Rule(
        code="ABUSIVE",
        label="内容含辱骂或人身攻击",
        weight=70,
        patterns=(
            r"傻[逼比屄]|脑残|去死|滚蛋|垃圾人|贱人|草泥马|他妈的|妈的|狗东西",
        ),
        hint="对菜可以挑剔，对人请客气。",
    ),
    Rule(
        code="CLICKBAIT",
        label="标题或正文存在夸张诱导表述",
        weight=20,
        patterns=(
            r"震惊|必看|不看后悔|99%的人|速看|惊呆|吓尿|史上最|全网最",
        ),
        hint="少一点标题党，多一点真做法。",
    ),
)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def normalize(text: str) -> str:
    """归一化：全角转半角、去空白与零宽字符、转小写。

    目的：挡住"加 微 信"、"加微·信"这类简单绕过。
    """
    if not text:
        return ""
    out = []
    for ch in text:
        code = ord(ch)
        if code == 0x3000:
            out.append(" ")
        elif 0xFF01 <= code <= 0xFF5E:
            out.append(chr(code - 0xFEE0))
        else:
            out.append(ch)
    blob = "".join(out)
    blob = blob.replace("\u200b", "").replace("\u200c", "").replace("\u200d", "").replace("\ufeff", "")
    for noise in (" ", "\t", "\n", "\r", "·", "•", "-", "_", "*", "~", "|", "/", "\\", "，", ",", "。", "."):
        blob = blob.replace(noise, "")
    return blob.lower()


def mask(hit: str) -> str:
    """命中片段脱敏，避免把用户手机号原样回显在驳回理由里。"""
    digits = re.sub(r"\D", "", hit)
    if len(digits) >= 7:
        return digits[:3] + "****" + digits[-2:]
    if len(hit) <= 2:
        return hit[:1] + "*"
    return hit[:2] + "***"


def _scan_text(blob: str, rules: Iterable[Rule]) -> list[Signal]:
    found: list[Signal] = []
    for rule in rules:
        hits: list[str] = []
        for pattern in rule.patterns:
            for match in re.finditer(pattern, blob, flags=re.IGNORECASE):
                text = match.group(0)
                if text and text not in hits:
                    hits.append(text)
                if len(hits) >= 3:
                    break
            if len(hits) >= 3:
                break
        if hits:
            found.append(Signal(code=rule.code, label=rule.label, weight=rule.weight, hits=hits))
    return found


def _spam_signal(text: str) -> Signal | None:
    """灌水检测：重复刷屏、纯符号、过短正文。"""
    raw = (text or "").strip()
    if not raw:
        return None
    blob = normalize(raw)
    if len(blob) >= 8:
        most = max(blob.count(ch) for ch in set(blob))
        if most / len(blob) >= 0.6:
            return Signal(code="SPAM", label="内容疑似重复刷屏", weight=60, hits=[mask(blob[:6])])
    if len(blob) >= 6 and not re.search(r"[\u4e00-\u9fa5a-z0-9]", blob):
        return Signal(code="SPAM", label="内容缺少有效文字", weight=60, hits=[mask(blob[:6])])
    if 0 < len(blob) < 4:
        return Signal(code="TOO_SHORT", label="内容过短，说明不足", weight=30, hits=[mask(blob)])
    return None


def audit(db, fields: dict[str, str], media: list[str] | None = None, source: str = "auto") -> dict:
    """审核一条内容。

    fields: 字段名 -> 文本，例如 {"标题": title, "正文": content}
            字段名会写进命中说明，方便用户定位改哪里。
    media:  图片/视频路径列表，仅做数量与站外链接的粗检。
    """
    blob = "\n".join(normalize(value) for value in fields.values() if value)
    signals: list[Signal] = []

    if blob.strip():
        signals.extend(_scan_text(blob, RULES))

        # 敏感词库：level=1 视为严重违规
        try:
            from .models import SensitiveWord

            for row in db.query(SensitiveWord).filter(SensitiveWord.level == 1).all():
                word = (row.word or "").strip()
                if word and normalize(word) and normalize(word) in blob:
                    signals.append(
                        Signal(code="SENSITIVE_WORD", label=f"内容包含违禁词「{word}」", weight=100, hits=[word])
                    )
                    break
        except Exception:  # 数据库不可用时不影响其余规则
            pass

        for name, value in fields.items():
            # 灌水/过短只判正文类字段：标题可以很短，食材/步骤是拼接串，长度没有意义
            if name not in ("正文", "简介"):
                continue
            spam = _spam_signal(value or "")
            if spam:
                spam.label = f"{name}{spam.label}"
                signals.append(spam)

    media = media or []
    if len(media) > 9:
        signals.append(Signal(code="TOO_MANY_MEDIA", label="图片超过 9 张", weight=30, hits=[str(len(media))]))

    # 同一条规则只计一次分，避免重复命中把分数刷爆
    seen: dict[str, Signal] = {}
    for signal in signals:
        if signal.code not in seen:
            seen[signal.code] = signal

    score = min(100, sum(item.weight for item in seen.values()))
    hard = any(item.weight >= HARD_RULE_WEIGHT for item in seen.values())

    if hard or score >= REJECT_SCORE:
        decision = DECISION_REJECT
    elif score >= REVIEW_SCORE:
        decision = DECISION_REVIEW
    else:
        decision = DECISION_PASS

    ordered = sorted(seen.values(), key=lambda item: item.weight, reverse=True)
    reasons = [item.label for item in ordered if item.weight >= REVIEW_SCORE] or [
        item.label for item in ordered[:1]
    ]
    if decision == DECISION_PASS:
        reasons = []
    hits = [hit for item in ordered for hit in item.hits][:5]

    return {
        "decision": decision,
        "status": STATUS_BY_DECISION[decision],
        "score": score,
        "code": ordered[0].code if ordered else "OK",
        "reasons": reasons,
        "hits": hits,
        "hint": _hint_for(ordered[0].code) if ordered else "",
        "engine": ENGINE_VERSION,
        "source": source,
        "checked_at": _now(),
    }


def _hint_for(code: str) -> str:
    for rule in RULES:
        if rule.code == code:
            return rule.hint
    if code == "SENSITIVE_WORD":
        return "内容里有社区不允许出现的词，请换个说法。"
    if code == "TOO_MANY_MEDIA":
        return "一条内容最多放 9 张图。"
    if code == "SPAM":
        return "内容看起来像重复刷屏，请认真写两句。"
    if code == "TOO_SHORT":
        return "多写两句，让别人知道这道菜好在哪。"
    return ""


def decision_text(verdict: dict) -> str:
    """把审核结论压成一句用户能看懂的话，用于 reject_reason。"""
    reasons = verdict.get("reasons") or []
    if verdict.get("decision") != DECISION_REJECT:
        return ""
    head = "；".join(reasons[:2]) if reasons else "内容不符合社区规范"
    hint = verdict.get("hint") or ""
    text = head + ("。" + hint if hint else "")
    return text[:MAX_REASON_LEN]


def public_verdict(verdict: dict) -> dict:
    """下发给客户端的精简结构（不带内部字段）。"""
    return {
        "decision": verdict.get("decision") or DECISION_PASS,
        "status": verdict.get("status", 2),
        "score": verdict.get("score", 0),
        "code": verdict.get("code", "OK"),
        "reasons": verdict.get("reasons") or [],
        "hint": verdict.get("hint") or "",
        "engine": verdict.get("engine") or ENGINE_VERSION,
        "checked_at": verdict.get("checked_at") or _now(),
    }


# ---------------- 与数据层衔接的小工具 ----------------


def apply_verdict(row, verdict: dict) -> None:
    """把审核结论写回内容行（不动数据库事务，由调用方 commit）。"""
    row.audit_status = verdict.get("status", 2)
    row.reject_reason = decision_text(verdict) if verdict.get("decision") == DECISION_REJECT else ""


def save_record(db, target_type: str, target_id: int, owner_id: str, verdict: dict) -> None:
    """落一条审核流水，用于后台追溯和申诉时对照。"""
    from .models import AuditRecord

    db.add(
        AuditRecord(
            target_type=target_type,
            target_id=int(target_id),
            owner_id=owner_id or "",
            decision=verdict.get("decision") or DECISION_PASS,
            score=int(verdict.get("score") or 0),
            code=verdict.get("code") or "OK",
            reasons=verdict.get("reasons") or [],
            hits=verdict.get("hits") or [],
            engine=verdict.get("engine") or ENGINE_VERSION,
            source=verdict.get("source") or "auto",
        )
    )
