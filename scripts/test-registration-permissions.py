"""Browser regression for registration permissions; all API responses are mocked.

Run the frontend on port 3011, then:
  python scripts/test-registration-permissions.py
Requires Playwright and Chrome (or PLAYWRIGHT_CHROMIUM_EXECUTABLE).
"""
import json
import os
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get("REGISTRATION_TEST_URL", "http://127.0.0.1:3011")
CHROME = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
ROOT = Path(__file__).resolve().parents[1]
REGISTRY = json.loads((ROOT / "src/data/menu-registry.json").read_text(encoding="utf-8"))
MENU = next(item for item in REGISTRY if item["key"] == "register")

def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        calls = Counter()
        writes = []
        state = {"permissions": ["register:view", "register:run"], "config": {"mail_provider": "hotmail_local"}, "deny_save": False, "service_online": True}
        sessions = [{"id": "fake-session", "status": "failed", "registration_target": "grok",
                     "events": [{"at": time.time(), "status": "failed", "message": "manual_click_required"}]}]

        def api(route):
            request = route.request
            path = urlparse(request.url).path
            calls[(request.method, path)] += 1
            status = 200
            payload = {}
            profile = {"menus": [MENU], "permissions": state["permissions"], "role": "user"}
            if path == "/api/auth/me":
                payload = {**profile, "user": {"email": "regression@example.com", "username": "回归测试", "role": "user"}}
            elif path == "/api/auth/menus":
                payload = profile
            elif path == "/api/grok/config":
                if "register:config" not in state["permissions"] or state["deny_save"] and request.method == "PUT":
                    status, payload = 403, {"detail": "当前操作需要权限：register:config"}
                elif request.method == "PUT":
                    state["config"] = request.post_data_json
                    writes.append(state["config"])
                    payload = {"ok": True, "config": state["config"]}
                else:
                    payload = state["config"]
            elif path == "/api/grok/sessions":
                if state["service_online"]:
                    payload = {"batches": [], "sessions": sessions}
                else:
                    status, payload = 503, {"detail": "Service unavailable"}
            elif path == "/api/grok/performance":
                payload = {"physical_cores": 4, "memory_available_gb": 8, "recommended_concurrency": 2}
            elif path == "/api/grok/mail/hotmail/accounts":
                if "register:resource" not in state["permissions"]:
                    status, payload = 403, {"detail": "当前操作需要权限：register:resource"}
                else:
                    payload = {"accounts": [], "total": 0, "available": 1}
            elif path == "/api/grok/register":
                payload = {"ok": True, "batch_id": "mock-batch"}
            elif path == "/api/browser-debug/status":
                payload = {"enabled": False, "viewer_available": False}
            else:
                raise AssertionError(f"Unexpected API request: {request.method} {path}")
            route.fulfill(status=status, json=payload)

        context.route(BASE_URL + "/api/**", api)
        # Block any remote content; this regression never contacts real registration services.
        context.route("https://**/*", lambda route: route.abort())
        page.add_init_script("""
          window.__permissionErrors = [];
          const seen = new WeakSet();
          new MutationObserver(() => {
            document.querySelectorAll('[role="alert"]').forEach(node => {
              if (node.textContent.includes('权限') && !seen.has(node)) {
                seen.add(node);
                window.__permissionErrors.push(node.textContent);
              }
            });
          }).observe(document, {childList: true, subtree: true});
        """)
        page.goto(BASE_URL + "/register")
        save = page.get_by_role("button", name="保存配置", exact=True)
        expect(save).to_be_enabled()
        def assert_save_denied():
            before_put = calls[("PUT", "/api/grok/config")]
            before_config = json.dumps(state["config"], sort_keys=True)
            before_errors = len(page.evaluate("window.__permissionErrors"))
            expect(save).to_be_enabled()
            save.click()
            alert = page.get_by_role("alert")
            expect(alert).to_have_count(1)
            expect(alert).to_have_text("无权限")
            alert.get_by_role("button", name="关闭提示", exact=True).click()
            expect(alert).to_have_count(0)
            assert page.evaluate("window.__permissionErrors")[before_errors:] == ["无权限"]
            assert calls[("PUT", "/api/grok/config")] == before_put
            assert json.dumps(state["config"], sort_keys=True) == before_config
            page.evaluate("window.__permissionErrors = []")

        assert_save_denied()
        expect(page.get_by_role("button", name="重新读取配置", exact=True)).to_be_disabled()
        expect(page.get_by_text("当前账号无权读取或保存系统配置。", exact=False)).to_be_visible()
        expect(page.get_by_text("内置注册引擎 在线", exact=False)).to_be_visible()
        page.get_by_role("button", name="邮箱配置", exact=True).click()
        expect(save).to_be_enabled()
        expect(page.get_by_text("当前账号无邮箱资源管理权限，无法查看或管理邮箱账户池。")).to_be_visible()
        assert_save_denied()
        page.get_by_role("button", name="注册配置", exact=True).click()
        page.wait_for_timeout(5600)
        assert calls[("GET", "/api/grok/config")] == 0
        assert calls[("GET", "/api/grok/mail/hotmail/accounts")] == 0
        assert page.evaluate("window.__permissionErrors") == []
        print("PASS: restricted load, tab changes and polling make no unauthorized requests/toasts")

        # Permission feedback stays clickable even when the engine is offline.
        state["service_online"] = False
        expect(page.get_by_text("内置注册引擎 未就绪", exact=False)).to_be_visible()
        assert_save_denied()
        state["service_online"] = True
        expect(page.get_by_text("内置注册引擎 在线", exact=False)).to_be_visible()
        print("PASS: denied save clicks show one exact toast and make no PUT, including offline")

        # Execute a transient visible-browser task without saving system configuration.
        page.get_by_role("button", name="打开验证浏览器", exact=True).click()
        expect(page.get_by_text("已启动一个可视注册任务", exact=False)).to_be_visible()
        assert calls[("POST", "/api/grok/register")] == 1
        assert calls[("PUT", "/api/grok/config")] == 0
        print("PASS: execution without configuration permission does not save mailbox settings")

        # Grant configuration and resource permissions to the same mounted page.
        state["permissions"] += ["register:config", "register:resource"]
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(save).to_be_enabled()
        page.get_by_role("button", name="邮箱配置", exact=True).click()
        expect(page.get_by_text("微软邮箱账户池", exact=True)).to_be_visible()
        save.click()
        expect(page.get_by_text("注册配置已保存到 MercuryPro。", exact=False)).to_be_visible()
        assert len(writes) == 1
        assert calls[("GET", "/api/grok/config")] >= 1
        assert calls[("GET", "/api/grok/mail/hotmail/accounts")] >= 1
        print("PASS: live permission grant restores loading and saving")

        # Revocation stops polls and clears the pool while preserving the page.
        state["permissions"] = ["register:view", "register:run"]
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(save).to_be_enabled()
        expect(page.get_by_text("当前账号无邮箱资源管理权限，无法查看或管理邮箱账户池。")).to_be_visible()
        assert_save_denied()
        before = calls.copy()
        page.wait_for_timeout(5600)
        assert calls[("GET", "/api/grok/config")] == before[("GET", "/api/grok/config")]
        assert calls[("GET", "/api/grok/mail/hotmail/accounts")] == before[("GET", "/api/grok/mail/hotmail/accounts")]
        assert page.evaluate("window.__permissionErrors") == []
        print("PASS: live revocation stops unauthorized background work")

        artifacts = ROOT / "browser-screenshots"
        artifacts.mkdir(exist_ok=True)
        page.screenshot(path=str(artifacts / "registration-permissions-desktop.png"))
        page.set_viewport_size({"width": 390, "height": 844})
        expect(save).to_be_enabled()
        expect(page.get_by_text("当前账号无权读取或保存系统配置。", exact=False)).to_be_visible()
        assert_save_denied()
        page.screenshot(path=str(artifacts / "registration-permissions-mobile.png"))
        print("PASS: revoked and mobile save remain clickable with permission feedback")

        # Genuine server-side denial after an otherwise valid grant is still reported once.
        page.set_viewport_size({"width": 1440, "height": 1000})
        state["permissions"] += ["register:config"]
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(page.get_by_text("当前账号无权读取或保存系统配置。", exact=False)).to_have_count(0)
        expect(save).to_be_enabled()
        state["deny_save"] = True
        save.click()
        expect(page.get_by_role("alert").filter(has_text="当前操作需要权限：register:config")).to_have_count(1)
        assert calls[("PUT", "/api/grok/config")] == 2
        assert page_errors == [], page_errors
        print("PASS: real server denial appears once; no JavaScript errors")
        browser.close()

if __name__ == "__main__":
    run()

