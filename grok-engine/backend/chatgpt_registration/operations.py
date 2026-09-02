"""ChatGPT registration operations operations."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class RegistrationContext:
    """Resolve adapter services from the live compatibility facade."""

    def __init__(self, values: Mapping[str, Any]):
        self.values = values

    def __getattr__(self, name: str) -> Any:
        try:
            return self.values[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


def _enqueue_import(ctx, sid):
    """Trigger auto-import in a background thread (simple version)."""

    def _import_one() -> None:
        with ctx._lock:
            sess = ctx._sessions.get(sid) or {}
        config = dict(sess.get("_post_registration") or {})
        if not config.get("auto_import_enabled"):
            return
        ctx._retry_import_now(sid, config)

    ctx.threading.Thread(target=_import_one, daemon=True).start()


def _retry_import_now(ctx, sid, config):
    """Execute auto-import for a session."""
    from account_pipeline import import_account
    from accounts import MERGED_AUTH, import_auth_payload

    target = str(config.get("target") or "sub2api").strip().lower()
    target_name = "CPA" if target == "cpa" else "Sub2API"
    output_format = "cpa" if target == "cpa" else "sub2api"
    with ctx._lock:
        sess = ctx._sessions.get(sid) or {}
    if not sess:
        return {"ok": False, "error": "session not found"}

    def set_result(result: dict[str, Any]) -> dict[str, Any]:
        ok = bool(result.get("ok"))
        error = str(result.get("error") or "")[:300]
        auto_import = {
            "enabled": True,
            "target": config.get("target", "sub2api"),
            "ok": ok,
            "imported": int(
                result.get("created") or result.get("updated") or (1 if ok else 0)
            ),
            "failed": 0 if ok else 1,
            "result": result,
            "manual_retry": True,
        }
        with ctx._lock:
            cur = ctx._sessions.get(sid) or sess
            cur["status"] = "imported" if ok else "error"
            success_message = (
                "Sub2API 导入成功，分组与可用模型已绑定"
                if target == "sub2api"
                else "CPA 导入成功"
            )
            cur["message"] = (
                success_message
                if ok
                else f"{target_name} 导入失败：{error or '未知错误'}"
            )
            cur["error"] = None if ok else error or f"{target_name} 导入失败"
            cur["auto_import"] = auto_import
            cur["updated_at"] = ctx._now()
            ctx._append_session_event(
                cur, cur["status"], cur["message"], at=cur["updated_at"]
            )
            ctx._sessions[sid] = cur
        if ok:
            try:
                from account_rotation import record_imported_session

                record_imported_session("chatgpt", dict(cur))
            except Exception:
                pass
        return result

    with ctx._lock:
        cur = ctx._sessions.get(sid) or sess
        cur["status"] = "auto_importing"
        cur["message"] = f"正在重新转换 Agent Identity JSON 并导入 {target_name}"
        cur["updated_at"] = ctx._now()
        ctx._append_session_event(
            cur, "auto_importing", cur["message"], at=cur["updated_at"]
        )
        ctx._sessions[sid] = cur
    try:
        if MERGED_AUTH.exists():
            merged = ctx.json.loads(MERGED_AUTH.read_text(encoding="utf-8"))
            if isinstance(merged, dict):
                for entry in merged.values():
                    identity = (
                        entry.get("agent_identity")
                        if isinstance(entry, dict)
                        and isinstance(entry.get("agent_identity"), dict)
                        else {}
                    )
                    if isinstance(entry, dict) and (
                        entry.get("email") == sess.get("email")
                        or identity.get("email") == sess.get("email")
                    ):
                        result = import_account(entry, config)
                        if result.get("ok"):
                            return set_result(result)
                        retryable_conversion_error = str(
                            result.get("error") or ""
                        ).lower()
                        if (
                            "private key" not in retryable_conversion_error
                            and "task_id" not in retryable_conversion_error
                        ):
                            return set_result(result)
                        break
        session_data = ctx._session_data_for(sess)
        if session_data.get("accessToken"):
            import chatgpt_session_to_auth as cs2a

            auth_dict = cs2a.session_to_auth_entry(
                session_data, proxy=str(sess.get("proxy") or ""), verify_task=True
            )
            entry = next(iter(auth_dict.values()), {})
            identity = (
                entry.get("agent_identity")
                if isinstance(entry.get("agent_identity"), dict)
                else {}
            )
            if not str(identity.get("task_id") or "").strip():
                return set_result(
                    {
                        "ok": False,
                        "error": "Agent Identity 任务注册未返回 task_id，已阻止保存和导入",
                    }
                )
            payload = {
                "key": identity.get("agent_runtime_id", ""),
                "auth_mode": "agent_identity",
                "email": identity.get("email") or sess.get("email"),
                "access_token": session_data.get("accessToken", ""),
                "agent_identity": identity,
            }
            local_result = import_auth_payload(
                payload, merge=True, output_format=output_format
            )
            if not local_result.get("ok"):
                return set_result(
                    {
                        "ok": False,
                        "error": local_result.get("error")
                        or "Agent Identity JSON 保存失败",
                    }
                )
            with ctx._lock:
                cur = ctx._sessions.get(sid) or sess
                rows = local_result.get("imported") or []
                cur["imported_account_ids"] = [
                    str(row.get("id") or "") for row in rows if row.get("id")
                ]
                cur["imported_accounts"] = [
                    {"id": row.get("id"), "email": row.get("email")} for row in rows
                ]
                cur["auth_json"] = local_result
                ctx._sessions[sid] = cur
            return set_result(import_account(entry, config))
    except Exception as exc:
        return set_result({"ok": False, "error": str(exc)[:300]})
    return set_result({"ok": False, "error": "未找到可导入的 Agent Identity JSON"})


def retry_registration_import(ctx, session_id, config):
    return ctx._retry_import_now(session_id, config)


def retry_registration_batch_import(ctx, batch_id, config):
    with ctx._lock:
        b = ctx._batches.get(batch_id) or {}
    results = []
    for sid in b.get("session_ids") or []:
        results.append(ctx._retry_import_now(sid, config))
    return {"ok": True, "batch_id": batch_id, "results": results}


def retry_registration_probe(ctx, session_id, config):
    return ctx._probe_registration_session(session_id, config)


def retry_registration_batch_probe(ctx, batch_id, config):
    with ctx._lock:
        batch = dict(ctx._batches.get(batch_id) or {})
    if not batch:
        return {"ok": False, "error": "registration batch not found"}
    with ctx._lock:
        current_batch = ctx._batches.get(batch_id) or batch
        current_batch["probe_status"] = "running"
        current_batch["probe_pause_requested"] = False
        current_batch["updated_at"] = ctx._now()
        ctx._batches[batch_id] = current_batch
    candidates = []
    with ctx._lock:
        for raw_sid in batch.get("session_ids") or []:
            sid = str(raw_sid)
            sess = ctx._sessions.get(sid) or {}
            if not ctx._session_data_for(sess).get("accessToken"):
                continue
            candidates.append(sid)
            current = ctx._sessions.get(sid) or sess
            current["probe"] = {
                "state": "queued",
                "model": str(config.get("model") or ctx.CHATGPT_DEFAULT_PROBE_MODEL),
            }
            current["updated_at"] = ctx._now()
            ctx._append_session_event(
                current, "probe_queued", "批次测活已排队", at=current["updated_at"]
            )
            ctx._sessions[sid] = current

    def run() -> None:
        from concurrent.futures import ThreadPoolExecutor, as_completed

        def probe_one(sid: str) -> dict[str, Any]:
            while True:
                with ctx._lock:
                    paused = bool(
                        (ctx._batches.get(batch_id) or {}).get("probe_pause_requested")
                    )
                if not paused:
                    break
                ctx.time.sleep(0.25)
            return ctx._probe_registration_session(sid, config)

        limit = max(
            1, min(ctx.MAX_CONCURRENCY, int(config.get("probe_concurrency") or 1))
        )
        with ThreadPoolExecutor(
            max_workers=limit, thread_name_prefix="cgpt-manual-probe"
        ) as pool:
            futures = [pool.submit(probe_one, sid) for sid in candidates]
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception:
                    pass
        with ctx._lock:
            current_batch = ctx._batches.get(batch_id) or batch
            current_batch["probe_status"] = "completed"
            current_batch["probe_pause_requested"] = False
            current_batch["updated_at"] = ctx._now()
            ctx._batches[batch_id] = current_batch

    if candidates:
        ctx.threading.Thread(
            target=run, daemon=True, name=f"cgpt-retry-probe-{batch_id[-8:]}"
        ).start()
    else:
        with ctx._lock:
            current_batch = ctx._batches.get(batch_id) or batch
            current_batch["probe_status"] = "completed"
            current_batch["updated_at"] = ctx._now()
            ctx._batches[batch_id] = current_batch
    return {"ok": True, "batch_id": batch_id, "scheduled": len(candidates)}


def pause_registration_batch_probe(ctx, batch_id):
    with ctx._lock:
        batch = ctx._batches.get(batch_id)
        if batch is None:
            return {"ok": False, "error": "registration batch not found"}
        batch["probe_pause_requested"] = True
        batch["probe_status"] = "paused"
        batch["updated_at"] = ctx._now()
    return {"ok": True, "batch_id": batch_id, "probe_status": "paused"}


def resume_registration_batch_probe(ctx, batch_id):
    with ctx._lock:
        batch = ctx._batches.get(batch_id)
        if batch is None:
            return {"ok": False, "error": "registration batch not found"}
        batch["probe_pause_requested"] = False
        batch["probe_status"] = "running"
        batch["updated_at"] = ctx._now()
    return {"ok": True, "batch_id": batch_id, "probe_status": "running"}


def _public_batch(batch):
    """Hide pickup bearer tokens from monitor responses while retaining resume state."""
    result = dict(batch)
    reg_config = result.get("reg_config")
    if isinstance(reg_config, dict):
        public_config = dict(reg_config)
        mailbox_text = str(public_config.get("naturalflower_mailboxes") or "")
        if mailbox_text:
            count = len([line for line in mailbox_text.splitlines() if line.strip()])
            public_config["naturalflower_mailboxes"] = f"[已隐藏 {count} 条取件链接]"
        result["reg_config"] = public_config
    return result


def list_registration_sessions(ctx):
    with ctx._lock:
        sessions = {
            sid: ctx._compact_session(dict(s)) for sid, s in ctx._sessions.items()
        }
        batches = {bid: _public_batch(b) for bid, b in ctx._batches.items()}
    ctx._persist_monitor_state()
    return {"sessions": sessions, "batches": batches}


def get_registration_session(ctx, session_id):
    with ctx._lock:
        sess = ctx._sessions.get(session_id)
        if sess is None:
            return None
        return ctx._compact_session(dict(sess))


def get_registration_access_token(ctx, session_id):
    """Load a saved AT only for an explicit per-session copy request."""
    with ctx._lock:
        sess = dict(ctx._sessions.get(session_id) or {})
    if not sess:
        return {"ok": False, "error": "ChatGPT 注册会话不存在"}
    session_data = ctx._session_data_for(sess)
    access_token = str(session_data.get("accessToken") or "").strip()
    if not access_token:
        return {"ok": False, "error": "该会话尚未生成 Access Token"}
    return {
        "ok": True,
        "session_id": session_id,
        "email": str(sess.get("email") or ""),
        "access_token": access_token,
    }


def _mailbox_link_for_email(email: str) -> tuple[str, str, str] | None:
    """Find a managed Microsoft mailbox and return its public inbox link."""
    normalized = str(email or "").strip().lower()
    local, separator, domain = normalized.partition("@")
    if not separator or not local or not domain:
        return None
    base_local = local.split("+", 1)[0]
    try:
        from mercury_mail import public_mailbox_link, registration_accounts_snapshot

        candidates = registration_accounts_snapshot()
    except Exception:
        return None
    for account in candidates:
        mailbox_email = str(account.get("email") or "").strip().lower()
        mailbox_local, mailbox_separator, mailbox_domain = mailbox_email.partition("@")
        if not mailbox_separator or mailbox_domain != domain:
            continue
        if mailbox_email != normalized and mailbox_local.split("+", 1)[0] != base_local:
            continue
        account_id = account.get("accountId")
        return (
            public_mailbox_link(account_id),
            str(account_id),
            mailbox_email,
        )
    return None


def _saved_account_rows(ctx, *, include_tokens: bool = False):
    """Read durable ChatGPT session files as account-management records."""
    rows = []
    try:
        paths = list(ctx.CHATGPT_SESSIONS_DIR.glob("*.json"))
    except OSError:
        paths = []
    for path in paths:
        try:
            payload = ctx.json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                continue
            access_token = str(payload.get("accessToken") or "").strip()
            if not access_token:
                continue
            user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
            email = str(user.get("email") or "").strip().lower()
            plus_trial = (
                dict(payload.get("mercuryPlusTrialEligibility"))
                if isinstance(payload.get("mercuryPlusTrialEligibility"), dict)
                else {"status": "unknown", "eligible": None, "reason": "尚未检测"}
            )
            checkout_probe = (
                dict(payload.get("mercuryCheckoutProbe"))
                if isinstance(payload.get("mercuryCheckoutProbe"), dict)
                else {"status": "unknown", "kind": "unknown", "reason": "尚未检测"}
            )
            raw_payment_methods = payload.get("mercuryPaymentMethods")
            if raw_payment_methods is None and isinstance(payload.get("mercuryPlusTrialEligibility"), dict):
                raw_payment_methods = payload.get("mercuryPlusTrialEligibility", {}).get("payment_methods")
            payment_methods = [
                str(m).strip().lower().replace("-", "_")
                for m in (raw_payment_methods if isinstance(raw_payment_methods, list) else [])
                if str(m).strip()
            ]
            seen_pm: set[str] = set()
            deduped_payment_methods: list[str] = []
            for m in payment_methods:
                if m not in seen_pm:
                    seen_pm.add(m)
                    deduped_payment_methods.append(m)
            payment_methods_status = str(
                payload.get("mercuryPaymentMethodsStatus")
                or plus_trial.get("payment_methods_status")
                or ("detected" if deduped_payment_methods else "unknown")
            ).strip().lower()
            if payment_methods_status not in {"detected", "unknown", "error", "none"}:
                payment_methods_status = "unknown"
            registration_password = str(
                payload.get("mercuryRegistrationPassword") or ""
            )
            stat = path.stat()
        except (OSError, ValueError, UnicodeDecodeError):
            continue
        mailbox = _mailbox_link_for_email(email)
        row = {
            "id": path.name,
            "email": email,
            "created_at": float(stat.st_mtime),
            "access_token_available": True,
            "plus_trial": plus_trial,
            "checkout_probe": checkout_probe,
            "payment_methods": deduped_payment_methods,
            "payment_methods_status": payment_methods_status,
            "password": registration_password,
            "password_available": bool(registration_password),
            "mailbox_link": mailbox[0] if mailbox else "",
            "mailbox_account_id": mailbox[1] if mailbox else "",
            "mailbox_email": mailbox[2] if mailbox else "",
        }
        if include_tokens:
            row["access_token"] = access_token
        rows.append(row)
    rows.sort(key=lambda item: float(item.get("created_at") or 0), reverse=True)
    return rows


def _registration_account_mail_type(email: str) -> str:
    domain = str(email or "").lower().partition("@")[2]
    if domain in {"icloud.com", "me.com"}:
        return "icloud"
    if domain in {"gmail.com", "googlemail.com"}:
        return "gmail"
    if domain in {"outlook.com", "hotmail.com", "live.com", "msn.com"}:
        return "microsoft"
    return "other"


def _registration_account_matches(
    account: dict[str, Any],
    *,
    keyword: str,
    mail_type: str,
    plus_trial: str,
    checkout: str,
    payment_method: str,
) -> bool:
    email = str(account.get("email") or "").lower()
    if keyword and keyword not in email:
        return False
    if mail_type != "all" and _registration_account_mail_type(email) != mail_type:
        return False

    plus_data = account.get("plus_trial") if isinstance(account.get("plus_trial"), dict) else {}
    plus_status = str(plus_data.get("status") or "unknown").lower()
    if plus_status not in {"eligible", "ineligible"}:
        plus_status = "unknown"
    if plus_trial != "all" and plus_status != plus_trial:
        return False

    checkout_data = account.get("checkout_probe") if isinstance(account.get("checkout_probe"), dict) else {}
    checkout_kind = str(checkout_data.get("kind") or "unknown").lower()
    if checkout_kind not in {"oaics", "cs_live", "cs_test"}:
        checkout_kind = (
            "disabled"
            if str(checkout_data.get("status") or "").lower() == "disabled"
            else "unknown"
        )
    if checkout != "all" and checkout_kind != checkout:
        return False

    if payment_method != "all":
        payment_status = str(account.get("payment_methods_status") or "unknown").lower()
        if payment_method == "unknown":
            return payment_status in {"unknown", "error"}
        methods = {
            str(value or "").lower().replace("-", "").replace("_", "").replace(" ", "")
            for value in (account.get("payment_methods") or [])
            if str(value or "").strip()
        }
        if payment_method == "none":
            # Empty methods are not proof that no method exists. Only an
            # explicit legacy/producer-confirmed `none` result matches here.
            if payment_status != "none":
                return False
            if methods:
                return False
        elif payment_method == "other":
            main_methods = {
                "applepay", "paypal", "gcash", "gopay", "card",
                "googlepay", "link", "alipay", "wechatpay",
            }
            if not any(value not in main_methods for value in methods):
                return False
        else:
            normalized_method = payment_method.replace("-", "").replace("_", "")
            if normalized_method not in methods:
                return False
    return True


def list_registration_accounts(
    ctx,
    page=1,
    page_size=20,
    keyword="",
    mail_type="all",
    plus_trial="all",
    checkout="all",
    payment_method="all",
):
    accounts = _saved_account_rows(ctx)
    page_size = max(1, min(100, int(page_size or 20)))
    requested_page = max(1, int(page or 1))
    filters = {
        "keyword": str(keyword or "").strip().lower(),
        "mail_type": str(mail_type or "all").strip().lower(),
        "plus_trial": str(plus_trial or "all").strip().lower(),
        "checkout": str(checkout or "all").strip().lower(),
        "payment_method": str(payment_method or "all").strip().lower(),
    }
    filtered = [
        account
        for account in accounts
        if _registration_account_matches(account, **filters)
    ]
    # Keep the newest saved account first before taking a page.
    filtered.sort(
        key=lambda item: float(item.get("created_at") or 0), reverse=True
    )
    total = len(filtered)
    pages = max(1, (total + page_size - 1) // page_size)
    current_page = min(requested_page, pages)
    offset = (current_page - 1) * page_size
    return {
        "ok": True,
        "accounts": filtered[offset : offset + page_size],
        "total": total,
        "page": current_page,
        "page_size": page_size,
        "pages": pages,
        "summary": {
            "total": len(accounts),
            "access_token_available": sum(
                1 for account in accounts if account.get("access_token_available")
            ),
            "plus_trial_eligible": sum(
                1
                for account in accounts
                if isinstance(account.get("plus_trial"), dict)
                and account["plus_trial"].get("status") == "eligible"
            ),
        },
    }


def get_registration_access_tokens(ctx, account_ids=None, all_accounts=False):
    requested = {str(value or "") for value in (account_ids or []) if str(value or "")}
    tokens = []
    for item in _saved_account_rows(ctx, include_tokens=True):
        if not all_accounts and str(item.get("id") or "") not in requested:
            continue
        tokens.append(
            {
                "id": item["id"],
                "email": item.get("email") or "",
                "access_token": item["access_token"],
            }
        )
    return {"ok": True, "tokens": tokens, "total": len(tokens)}


def get_registration_batch(ctx, batch_id):
    with ctx._lock:
        b = ctx._batches.get(batch_id)
        if b is None:
            return None
        result = _public_batch(b)
        sids = list(result.get("session_ids") or [])
        result["sessions"] = [
            ctx._compact_session(ctx._sessions[s]) for s in sids if s in ctx._sessions
        ]
        return result


def stop_registration_session(ctx, session_id):
    with ctx._lock:
        sess = ctx._sessions.get(session_id)
        if sess is None:
            return {"ok": False, "error": "session not found"}
        sess["cancel_requested"] = True
        sess["status"] = "cancelled"
        sess["message"] = "stopped by user"
        sess["updated_at"] = ctx._now()
        ctx._sessions[session_id] = sess
    return {"ok": True, "session_id": session_id}


def stop_registration_batch(ctx, batch_id):
    with ctx._lock:
        b = ctx._batches.get(batch_id)
        if b is None:
            return {"ok": False, "error": "batch not found"}
        b["cancel_requested"] = True
        b["status"] = "cancelled"
        b["updated_at"] = ctx._now()
        for sid in b.get("session_ids") or []:
            if sid in ctx._sessions:
                ctx._sessions[sid]["cancel_requested"] = True
                ctx._sessions[sid]["status"] = "cancelled"
                ctx._sessions[sid]["updated_at"] = ctx._now()
        ctx._batches[batch_id] = b
    return {"ok": True, "batch_id": batch_id}


def pause_registration_batch(ctx, batch_id):
    with ctx._lock:
        b = ctx._batches.get(batch_id)
        if b is None:
            return {"ok": False, "error": "batch not found"}
        b["pause_requested"] = True
        b["status"] = "paused"
        b["updated_at"] = ctx._now()
        ctx._batches[batch_id] = b
    return {"ok": True, "batch_id": batch_id}


def resume_registration_batch(ctx, batch_id, force=False):
    with ctx._lock:
        b = ctx._batches.get(batch_id)
        if b is None:
            return {"ok": False, "error": "batch not found"}
        b["pause_requested"] = False
        b["status"] = "running"
        b["updated_at"] = ctx._now()
        ctx._batches[batch_id] = b
    return {"ok": True, "batch_id": batch_id, "resumed": True}


def reset_registration_monitor(ctx):
    with ctx._lock:
        ctx._sessions.clear()
        ctx._batches.clear()
    ctx.clear_state("chatgpt")
    return {"ok": True}


def probe_local_solver(ctx, url=None, timeout=0.35):
    """ChatGPT mode doesn't use Turnstile solver. Always returns ready."""
    return {
        "ok": True,
        "ready": True,
        "url": url or "",
        "message": "chatgpt mode: no turnstile needed",
    }


def get_registration_performance_profile(ctx, provider="", local_solver_url=""):
    """Return machine performance profile (simplified for ChatGPT)."""
    try:
        from performance_tuning import machine_profile

        return machine_profile()
    except Exception:
        return {"cpu_cores": 4, "memory_gb": 8, "platform": "windows"}


def wait_pipeline_stagger(ctx, phase, delay_ms):
    """Stub for pipeline stagger; not heavily used in ChatGPT mode."""
    if delay_ms and float(delay_ms) > 0:
        ctx.time.sleep(min(float(delay_ms) / 1000.0, 10.0))
