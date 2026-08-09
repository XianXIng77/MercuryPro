"""Gemini-backed mail assistant APIs migrated from the Express backend."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse


router = APIRouter(prefix="/api/ai", tags=["AI Mail Assistant"])
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")


def _schema_object(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "OBJECT", "properties": properties, "required": required}


async def _generate_json(prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent"
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                url,
                headers={
                    "User-Agent": "aistudio-build",
                    "x-goog-api-key": api_key,
                },
                json=payload,
            )
        response.raise_for_status()
        result = response.json()
        text = result["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise ValueError("Gemini returned a non-object JSON response")
        return parsed
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        raise RuntimeError(f"Gemini 请求失败：{exc}") from exc


def _fallback_tags(emails: list[dict[str, Any]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for email in emails:
        text = " ".join(
            str(email.get(key) or "") for key in ("subject", "snippet", "body")
        )
        tags: list[str] = []
        folder = "收件箱"
        if any(word in text for word in ("发票", "账单", "付款", "Invoice")):
            tags.append("账单明细")
            folder = "财务账单"
        if any(word in text for word in ("紧急", "ASAP", "重要", "审核")):
            tags.append("紧急高优")
        if any(word in text for word in ("跟进", "需求", "项目", "会议")):
            tags.extend(("待处理", "工作项目"))
            folder = "工作项目"
        if any(word in text for word in ("订阅", "优惠", "Newsletter", "活动")):
            tags.append("营销订阅")
        if not tags:
            tags.append("普通沟通")
        results.append(
            {
                "id": email.get("id"),
                "tags": tags,
                "recommendedFolder": folder,
                "summary": email.get("snippet") or email.get("subject"),
                "urgency": "high" if "紧急高优" in tags else "normal",
            }
        )
    return results


@router.post("/auto-tag")
async def auto_tag(
    payload: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    emails = payload.get("emails")
    if not isinstance(emails, list) or not emails:
        return JSONResponse(
            status_code=400, content={"error": "Missing emails array"}
        )
    normalized = [email for email in emails if isinstance(email, dict)]
    if not os.environ.get("GEMINI_API_KEY", "").strip():
        return {"results": _fallback_tags(normalized), "source": "fallback"}

    mail_data = [
        {
            "id": email.get("id"),
            "subject": email.get("subject"),
            "sender": email.get("sender"),
            "snippet": email.get("snippet")
            or str(email.get("body") or "")[:200],
        }
        for email in normalized
    ]
    prompt = (
        "请对以下邮件列表进行智能分析，为每封邮件自动生成准确的标签（如：紧急高优、待处理、"
        "账单明细、客户跟进、工作项目、营销订阅、个人私信、通知提议等）及推荐存入的文件夹"
        "分类（如：工作项目、财务账单、差旅规划、个人私人、收件箱），并提供一句话摘要。\n\n"
        f"邮件数据:\n{json.dumps(mail_data, ensure_ascii=False)}"
    )
    schema = _schema_object(
        {
            "results": {
                "type": "ARRAY",
                "items": _schema_object(
                    {
                        "id": {"type": "STRING"},
                        "tags": {"type": "ARRAY", "items": {"type": "STRING"}},
                        "recommendedFolder": {"type": "STRING"},
                        "summary": {"type": "STRING"},
                        "urgency": {
                            "type": "STRING",
                            "description": "high, normal, low",
                        },
                    },
                    ["id", "tags", "recommendedFolder", "summary"],
                ),
            }
        },
        ["results"],
    )
    try:
        parsed = await _generate_json(prompt, schema)
        results = parsed.get("results")
        return {"results": results if isinstance(results, list) else [], "source": "gemini"}
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


@router.post("/assistant")
async def assistant(
    payload: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    action = payload.get("action")
    email = payload.get("email")
    if not isinstance(email, dict):
        return JSONResponse(
            status_code=400, content={"error": "Email content is required"}
        )

    if not os.environ.get("GEMINI_API_KEY", "").strip():
        if action == "summarize":
            return {
                "summary": f"【摘要】{email.get('subject', '')} - 涉及项目与沟通要点，请及时关注相关要求。",
                "keyPoints": ["关注邮件主要事项", "如需跟进请及时回复"],
            }
        if action == "reply":
            return {
                "replies": [
                    "好的，收到！我会尽快处理并回复您详细进展。",
                    "感谢通知，相关材料已核对无误，随时保持沟通。",
                    "抱歉目前时间上有冲突，建议调整至下周再议，谢谢！",
                ]
            }
        return {"result": "已完成智能处理。"}

    if action == "summarize":
        prompt = (
            "请对这封邮件进行中文深度总结，提炼出核心要点和待办事项:\n"
            f"主题: {email.get('subject', '')}\n"
            f"发件人: {email.get('sender', '')}\n"
            f"正文: {email.get('body', '')}"
        )
        schema = _schema_object(
            {
                "summary": {"type": "STRING"},
                "keyPoints": {"type": "ARRAY", "items": {"type": "STRING"}},
                "actionRequired": {"type": "BOOLEAN"},
            },
            ["summary", "keyPoints"],
        )
    elif action == "reply":
        prompt = (
            "基于以下邮件内容，为收件人提供 3 种不同语气的中文快捷回复选项"
            "（礼貌肯定、专业跟进、婉拒改期）:\n"
            f"主题: {email.get('subject', '')}\n正文: {email.get('body', '')}"
        )
        schema = _schema_object(
            {"replies": {"type": "ARRAY", "items": {"type": "STRING"}}},
            ["replies"],
        )
    else:
        return JSONResponse(status_code=400, content={"error": "Unknown action"})

    try:
        return await _generate_json(prompt, schema)
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})
