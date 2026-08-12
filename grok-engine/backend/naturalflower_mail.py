"""Naturalflower pickup-link mailbox support for ChatGPT registration."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import parse_qs, quote, unquote, urlparse

import httpx

from mail_protocols.common import extract_verification_codes


_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_ALLOWED_HOST = "pickup.naturalflower.cn"


@dataclass(frozen=True)
class NaturalflowerMailbox:
    email: str
    pickup_url: str
    token: str


def _token_from_url(value: str) -> tuple[str, str]:
    raw = str(value or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme != "https" or parsed.hostname != _ALLOWED_HOST:
        raise ValueError(f"取件链接必须是 https://{_ALLOWED_HOST}/ 地址")
    query_token = (parse_qs(parsed.query).get("token") or [""])[0].strip()
    path_token = ""
    if parsed.path.startswith("/p/"):
        path_token = unquote(parsed.path[3:]).strip()
    token = query_token or path_token
    if not token or any(character.isspace() for character in token):
        raise ValueError("取件链接缺少有效 token")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return token, origin


def parse_naturalflower_mailboxes(text: str | None) -> list[NaturalflowerMailbox]:
    """Parse ``email pickup-url`` lines and reject ambiguous/duplicate entries."""
    entries: list[NaturalflowerMailbox] = []
    emails: set[str] = set()
    tokens: set[str] = set()
    for line_number, raw_line in enumerate(str(text or "").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        parts = re.split(r"\s+", line, maxsplit=1)
        if len(parts) != 2:
            raise ValueError(f"第 {line_number} 行格式错误，应为：邮箱 取件URL")
        email = parts[0].strip().lower()
        pickup_url = parts[1].strip()
        if not _EMAIL_RE.fullmatch(email):
            raise ValueError(f"第 {line_number} 行邮箱格式错误")
        try:
            token, _origin = _token_from_url(pickup_url)
        except ValueError as exc:
            raise ValueError(f"第 {line_number} 行{exc}") from exc
        if email in emails:
            raise ValueError(f"第 {line_number} 行邮箱重复：{email}")
        if token in tokens:
            raise ValueError(f"第 {line_number} 行取件 token 重复")
        emails.add(email)
        tokens.add(token)
        entries.append(NaturalflowerMailbox(email, pickup_url, token))
    if not entries:
        raise ValueError("请至少填写一行 Naturalflower 邮箱和取件 URL")
    return entries


def naturalflower_mailbox_for_index(
    text: str | None, index: int | None
) -> NaturalflowerMailbox:
    entries = parse_naturalflower_mailboxes(text)
    position = max(1, int(index or 1))
    if position > len(entries):
        raise ValueError(
            f"Naturalflower 邮箱数量不足：任务需要第 {position} 个，当前只有 {len(entries)} 个"
        )
    return entries[position - 1]


class NaturalflowerReceiver:
    """Poll one public pickup token and return a new six-digit verification code."""

    def __init__(
        self,
        mailbox: NaturalflowerMailbox,
        *,
        request_timeout: float = 20.0,
        client_factory: Callable[..., Any] = httpx.Client,
    ) -> None:
        self.email = mailbox.email
        self.pickup_url = mailbox.pickup_url
        self.token = mailbox.token
        _token, origin = _token_from_url(mailbox.pickup_url)
        self.api_base = f"{origin}/api/public/mailbox/{quote(self.token, safe='')}"
        self.request_timeout = max(3.0, float(request_timeout or 20.0))
        self.client_factory = client_factory
        self._baseline_ids: set[str] = set()

    def _request_json(self, suffix: str = "") -> dict[str, Any]:
        url = f"{self.api_base}{suffix}"
        headers = {
            "Accept": "application/json",
            "User-Agent": "MercuryPro/1.0 NaturalflowerMailbox",
        }
        try:
            with self.client_factory(
                timeout=self.request_timeout, follow_redirects=True
            ) as client:
                response = client.get(url, headers=headers)
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            raise RuntimeError(f"Naturalflower 取件请求失败：{str(exc)[:220]}") from exc
        if not isinstance(data, dict):
            raise RuntimeError("Naturalflower 取件接口返回格式错误")
        return data

    @staticmethod
    def _message_ids(data: dict[str, Any]) -> set[str]:
        messages = data.get("messages")
        if not isinstance(messages, list):
            return set()
        return {
            str(item.get("id"))
            for item in messages
            if isinstance(item, dict) and item.get("id") is not None
        }

    def validate(self) -> None:
        data = self._request_json()
        actual_email = str(data.get("email") or "").strip().lower()
        if not actual_email:
            raise RuntimeError("Naturalflower 取件链接不可用或未绑定邮箱")
        if actual_email != self.email:
            raise RuntimeError(
                f"Naturalflower 取件链接绑定邮箱不一致：填写 {self.email}，实际 {actual_email}"
            )
        self._baseline_ids = self._message_ids(data)

    def mark_code_request_started(self) -> None:
        """Keep the creation-time baseline so fast-arriving OpenAI mail is not lost.

        The browser emits ``email: submitted`` after a short post-submit wait.  A
        verification email may already have arrived by then, so refreshing the
        baseline here would incorrectly classify the new code as an old message.
        Resends are de-duplicated through ``exclude_codes`` in ``wait_for_code``.
        """
        return None

    def wait_for_code(
        self,
        timeout: float = 180,
        *,
        should_cancel=None,
        poll_interval: float | None = None,
        exclude_codes: set[str] | None = None,
    ) -> str:
        deadline = time.time() + max(1.0, float(timeout or 180))
        poll = max(1.0, min(10.0, float(poll_interval or 2.5)))
        excluded = {str(value).strip() for value in (exclude_codes or set())}
        consecutive_failures = 0

        while time.time() < deadline:
            if callable(should_cancel) and should_cancel():
                raise RuntimeError("cancelled while waiting for email code")
            try:
                index = self._request_json()
                actual_email = str(index.get("email") or "").strip().lower()
                if actual_email != self.email:
                    raise RuntimeError("Naturalflower 取件链接已失效或绑定邮箱不一致")
                messages = index.get("messages")
                if not isinstance(messages, list):
                    messages = []
                for item in messages:
                    if not isinstance(item, dict) or item.get("id") is None:
                        continue
                    message_id = str(item["id"])
                    if message_id in self._baseline_ids:
                        continue
                    detail = self._request_json(f"/messages/{quote(message_id, safe='')}")
                    text = "\n".join(
                        str(detail.get(key) or item.get(key) or "")
                        for key in (
                            "subject",
                            "text_body",
                            "html_body",
                            "content",
                            "text",
                            "body",
                            "sender_name",
                            "sender_address",
                        )
                    )
                    for code in extract_verification_codes(text):
                        clean = str(code).strip()
                        if len(clean) == 6 and clean.isdigit() and clean not in excluded:
                            return clean
                consecutive_failures = 0
            except Exception as exc:
                consecutive_failures += 1
                if consecutive_failures >= 3:
                    raise RuntimeError(
                        "Naturalflower 邮箱轮询连续失败 3 次：" f"{str(exc)[:220]}"
                    ) from exc

            slept = 0.0
            while slept < poll:
                if callable(should_cancel) and should_cancel():
                    raise RuntimeError("cancelled while waiting for email code")
                chunk = min(0.25, poll - slept)
                time.sleep(chunk)
                slept += chunk

        raise RuntimeError("timeout waiting for ChatGPT email verification code")


def create_naturalflower_receiver(
    mailbox: NaturalflowerMailbox | dict[str, Any],
) -> tuple[str, NaturalflowerReceiver]:
    if isinstance(mailbox, dict):
        email = str(mailbox.get("email") or "").strip().lower()
        pickup_url = str(mailbox.get("pickup_url") or "").strip()
        token, _origin = _token_from_url(pickup_url)
        mailbox = NaturalflowerMailbox(email, pickup_url, token)
    receiver = NaturalflowerReceiver(mailbox)
    receiver.validate()
    return receiver.email, receiver
