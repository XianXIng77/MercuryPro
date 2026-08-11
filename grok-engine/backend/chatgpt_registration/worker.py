"""Single-session ChatGPT registration worker."""

from __future__ import annotations

from typing import Any


def _run_registration(ctx, sid, proxy, receiver, browser_runtime=None):
    """Execute the ChatGPT registration flow for one session."""
    with ctx._lock:
        sess = ctx._sessions.get(sid)
    if not sess:
        return
    with ctx._lock:
        ctx._sessions[sid] = sess

    def _check_cancel() -> None:
        with ctx._lock:
            cur = ctx._sessions.get(sid) or sess
        if ctx._session_cancel_requested(cur):
            raise ctx._RegCancelled(cur.get("message") or "cancelled by user")

    def update(status: str, message: str, **kwargs: Any) -> None:
        _check_cancel()
        with ctx._lock:
            cur = ctx._sessions.get(sid) or sess
            if ctx._session_cancel_requested(cur) and status not in (
                "cancelled",
                "stopped",
                "error",
                "imported",
            ):
                raise ctx._RegCancelled(cur.get("message") or "cancelled by user")
            now = ctx._now()
            cur["status"] = status
            cur["message"] = message
            cur["updated_at"] = now
            cur.update(kwargs)
            ctx._append_session_event(cur, status, message, at=now)
            ctx._sessions[sid] = cur

    email = str(sess.get("email") or "").strip().lower()
    headless = bool(sess.get("_headless", True))
    pipeline_cfg = dict(sess.get("_post_registration") or {})
    step_delay_ms = max(0, min(30000, int(pipeline_cfg.get("step_delay_ms") or 3000)))
    hotmail_account_id = str(sess.get("_hotmail_account_id") or "")
    hotmail_alias_index = sess.get("_hotmail_alias_index")
    try:
        hotmail_alias_index = (
            int(hotmail_alias_index) if hotmail_alias_index is not None else None
        )
    except (TypeError, ValueError):
        hotmail_alias_index = None
    hotmail_marked_used = False

    if not email:
        update("error", "missing email for registration session", error="missing email")
        return
    try:
        _check_cancel()
        update("starting", f"starting ChatGPT registration; email={email}")
        from chatgpt_browser import register_chatgpt_account

        proxy_dict = ctx._proxy_for_browser(proxy) if proxy else None
        used_codes: set[str] = set()
        code_lock = ctx.threading.Lock()
        code_state: dict[str, Any] = {
            "code": None,
            "error": "",
            "thread": None,
            "event": ctx.threading.Event(),
            "generation": 0,
        }

        def _start_code_prefetch(force_refresh: bool = False) -> None:
            with code_lock:
                if force_refresh:
                    if code_state.get("code"):
                        used_codes.add(str(code_state["code"]))
                    code_state["generation"] = (
                        int(code_state.get("generation") or 0) + 1
                    )
                    code_state["code"] = None
                    code_state["error"] = ""
                    code_state["thread"] = None
                    code_state["event"] = ctx.threading.Event()
                current = code_state.get("thread")
                if isinstance(current, ctx.threading.Thread) and current.is_alive():
                    return
                if code_state.get("code"):
                    return
                generation = int(code_state.get("generation") or 0)

                def _prefetch() -> None:
                    code = None
                    error = ""
                    try:
                        code = receiver.wait_for_code(
                            timeout=180,
                            should_cancel=lambda: ctx._session_cancel_requested(
                                ctx._sessions.get(sid)
                            ),
                            poll_interval=2.5,
                            exclude_codes=set(used_codes),
                        )
                    except Exception as exc:
                        error = str(exc)[:300]
                    with code_lock:
                        if generation != int(code_state.get("generation") or 0):
                            return
                        code_state["code"] = code
                        code_state["error"] = error
                        code_state["event"].set()

                thread = ctx.threading.Thread(
                    target=_prefetch, daemon=True, name=f"cgpt-mail-code-{sid[-8:]}"
                )
                code_state["thread"] = thread
                thread.start()

        def _get_code(force_refresh: bool = False) -> str | None:
            _check_cancel()
            if force_refresh and hasattr(receiver, "mark_code_request_started"):
                receiver.mark_code_request_started()
            _start_code_prefetch(force_refresh)
            deadline = ctx.time.time() + 185
            while ctx.time.time() < deadline:
                _check_cancel()
                with code_lock:
                    event = code_state["event"]
                    code = code_state.get("code")
                    thread = code_state.get("thread")
                if code:
                    return str(code)
                if event.wait(timeout=0.25):
                    with code_lock:
                        code = code_state.get("code")
                        error = str(code_state.get("error") or "")
                    if code:
                        return str(code)
                    if error:
                        if (
                            error
                            == "timeout waiting for ChatGPT email verification code"
                        ):
                            return None
                        raise RuntimeError(f"邮箱验证码预取失败: {error}")
                    return None
                if isinstance(thread, ctx.threading.Thread) and (not thread.is_alive()):
                    break
            with code_lock:
                error = str(code_state.get("error") or "")
            if error:
                if error == "timeout waiting for ChatGPT email verification code":
                    return None
                raise RuntimeError(f"邮箱验证码预取失败: {error}")
            return None

        def _on_progress(msg: str) -> None:
            nonlocal hotmail_marked_used
            try:
                update("registering", msg)
                progress = str(msg or "").strip().lower()
                if progress.startswith("[chatgpt] email: submitted") and hasattr(
                    receiver, "mark_code_request_started"
                ):
                    receiver.mark_code_request_started()
                if any(
                    (
                        marker in progress
                        for marker in (
                            "[chatgpt] email: submitted",
                            "[chatgpt] password: submitted",
                            "[chatgpt] verification: waiting_for_form",
                        )
                    )
                ):
                    _start_code_prefetch(False)
                if (
                    hotmail_account_id
                    and (not hotmail_marked_used)
                    and str(msg or "")
                    .strip()
                    .lower()
                    .startswith("[chatgpt] completion: done")
                ):
                    from hotmail_local import mark_used

                    if mark_used(
                        hotmail_account_id,
                        alias_index=hotmail_alias_index,
                        registration_target="chatgpt",
                    ):
                        hotmail_marked_used = True
            except ctx._RegCancelled:
                raise

        def _should_cancel() -> bool:
            return ctx._session_cancel_requested(ctx._sessions.get(sid))

        update("registering", "launching browser for ChatGPT signup")
        result = register_chatgpt_account(
            email=email,
            password=str(sess.get("password") or ""),
            get_verification_code=_get_code,
            proxy=proxy_dict,
            headless=headless,
            timeout_sec=300.0,
            should_cancel=_should_cancel,
            on_progress=_on_progress,
            operation_delay_ms=step_delay_ms,
            checkout_probe_enabled=bool(
                pipeline_cfg.get("checkout_probe_enabled")
            ),
            checkout_proxy=str(pipeline_cfg.get("checkout_proxy") or ""),
            browser_runtime=browser_runtime,
        )
        if not result.get("ok"):
            error_msg = result.get("error", "registration failed")
            if result.get("cancelled"):
                update("cancelled", error_msg, error="cancelled")
            elif "account_deactivated" in str(
                error_msg
            ).lower() or "账号已删除或停用" in str(error_msg):
                update(
                    "account_error",
                    error_msg,
                    error=error_msg,
                    error_type="account_deactivated",
                )
            else:
                update("protocol_error", error_msg, error=error_msg)
            return
        if hotmail_account_id and (not hotmail_marked_used):
            from hotmail_local import mark_used

            hotmail_marked_used = mark_used(
                hotmail_account_id,
                alias_index=hotmail_alias_index,
                registration_target="chatgpt",
            )
        session_data = result.get("session")
        if (
            not isinstance(session_data, dict)
            or not str(session_data.get("accessToken") or "").strip()
        ):
            error_msg = "ChatGPT Session 缺少 accessToken，已停止转换和导入"
            update("error", error_msg, error="session_missing_access_token")
            return
        plus_trial = (
            dict(result.get("plus_trial"))
            if isinstance(result.get("plus_trial"), dict)
            else {
                "status": "unknown",
                "eligible": None,
                "reason": "注册流程未返回 Plus 试用资格结果",
            }
        )
        checkout_probe = (
            dict(result.get("checkout_probe"))
            if isinstance(result.get("checkout_probe"), dict)
            else {
                "status": "unknown",
                "kind": "unknown",
                "reason": "注册流程未返回结账类型检测结果",
            }
        )
        session_data = dict(session_data)
        session_data["mercuryPlusTrialEligibility"] = plus_trial
        session_data["mercuryCheckoutProbe"] = checkout_probe
        password_was_set = any(
            isinstance(step, dict)
            and str(step.get("step") or "") == "password"
            and str(step.get("status") or "") == "submitted"
            for step in (result.get("steps") or [])
        )
        if password_was_set:
            registration_password = str(sess.get("password") or "").strip()
            if registration_password:
                session_data["mercuryRegistrationPassword"] = registration_password
        try:
            session_file = ctx._save_original_chatgpt_session(
                session_data, email=email, session_id=sid
            )
        except Exception:
            error_msg = "ChatGPT 原始 Session 保存失败，已停止转换和导入"
            update("error", error_msg, error="session_save_failed")
            return
        trial_status = str(plus_trial.get("status") or "unknown").lower()
        trial_label = {
            "eligible": "有资格",
            "ineligible": "无资格",
        }.get(trial_status, "未知")
        checkout_kind = str(checkout_probe.get("kind") or "unknown").lower()
        checkout_status = str(checkout_probe.get("status") or "unknown").lower()
        checkout_label = (
            checkout_kind
            if checkout_kind in {"oaics", "cs_live"}
            else "未检测" if checkout_status == "disabled" else "未知"
        )
        update(
            "completed",
            f"OpenAI 注册完成，Session 与 Access Token 已保存到本地；Plus 试用资格：{trial_label}；结账类型：{checkout_label}",
            session_data=session_data,
            session_file=session_file,
            plus_trial=plus_trial,
            checkout_probe=checkout_probe,
            auto_import={
                "enabled": False,
                "ok": None,
                "skipped": True,
                "reason": "access_token_only",
            },
        )
    except ctx._RegCancelled:
        update("cancelled", "registration cancelled", error="cancelled")
    except Exception as e:
        msg = str(e)[:300]
        update("error", f"注册流程失败：{msg}", error=msg)
    finally:
        hotmail_account_id = str(sess.get("_hotmail_account_id") or "")
        if hotmail_account_id:
            with ctx._lock:
                final_session = dict(ctx._sessions.get(sid) or {})
                final_status = str(final_session.get("status") or "").lower()
                completed = (
                    hotmail_marked_used
                    or final_status == "imported"
                    or bool(final_session.get("session_data"))
                )
            if not completed:
                if final_status in {"cancelled", "stopped", "stopping"}:
                    from hotmail_local import release_account

                    release_account(
                        hotmail_account_id,
                        alias_index=hotmail_alias_index,
                        registration_target="chatgpt",
                    )
                else:
                    from hotmail_local import mark_failed

                    mark_failed(
                        hotmail_account_id,
                        str(
                            final_session.get("error")
                            or final_session.get("message")
                            or "注册失败"
                        ),
                        alias_index=hotmail_alias_index,
                        registration_target="chatgpt",
                    )
        with ctx._lock:
            if sid in ctx._sessions:
                ctx._sessions[sid].pop("_receiver", None)
