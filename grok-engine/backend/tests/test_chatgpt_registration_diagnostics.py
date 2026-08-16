from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from chatgpt_registration import diagnostics  # noqa: E402
from chatgpt_registration.diagnostics import (  # noqa: E402
    capture_registration_incident,
    create_incident_dir,
)



class FakePage:
    """Minimal Playwright-like page double."""

    def __init__(self, url: str = "https://chatgpt.com/checkout/cs_test") -> None:
        self.url = url
        self.screenshot_calls: list[bool] = []

    def locator(self, _selector: str):
        return self

    def inner_text(self) -> str:
        return "Amount due today US$0.00"

    def screenshot(self, *, path: str, full_page: bool, timeout: int) -> None:
        self.screenshot_calls.append(full_page)
        target = Path(path)
        target.write_bytes(b"fake-png-" + bytes([len(self.screenshot_calls)]))


class DiagnosticsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_default_log_dir_points_at_repo_root_log(self) -> None:
        self.assertEqual(
            diagnostics.DEFAULT_LOG_DIR,
            diagnostics._PROJECT_ROOT / "log",
        )
        self.assertTrue(
            diagnostics._PROJECT_ROOT.name in {"mercurypro"}
            or (diagnostics._PROJECT_ROOT / "package.json").exists()
        )

    def test_folder_name_has_timestamp_stage_outcome_and_email(self) -> None:
        name = diagnostics._folder_name(
            1755234625.123, "plus-trial", "eligible", "User@Example.com"
        )
        self.assertRegex(name, r"^\d{8}-\d{6}\.123_plus-trial_eligible_user-example\.com$")

    def test_unsafe_folder_parts_are_sanitized(self) -> None:
        name = diagnostics._folder_name(
            1755234625.0, "注册/../error", "爆红！！", "a b@c d.com"
        )
        self.assertNotIn("/", name)
        self.assertNotIn(" ", name)
        self.assertRegex(name, r"^\d{8}-\d{6}\.000_")

    def test_capture_writes_log_and_screenshot_into_one_folder(self) -> None:
        record = capture_registration_incident(
            stage="registration-error",
            outcome="error",
            email="person@example.com",
            session_id="cgpt_test",
            reason="找不到邮箱输入框",
            page=FakePage(),
            steps=[
                {"step": "email", "status": "filling", "at": 1755234600.0},
                {"step": "flow", "status": "error", "at": 1755234625.0},
            ],
            extra={"url": "https://chatgpt.com/auth/login"},
            root=self.root,
        )

        self.assertTrue(record["ok"])
        folder = Path(record["dir"])
        self.assertEqual(self.root, folder.parent)
        children = sorted(p.name for p in folder.iterdir())
        self.assertEqual(["log.txt", "screenshot.png"], children)

        log_text = (folder / "log.txt").read_text(encoding="utf-8")
        self.assertIn("person@example.com", log_text)
        self.assertIn("cgpt_test", log_text)
        self.assertIn("找不到邮箱输入框", log_text)
        self.assertIn("注册诊断日志", log_text)
        # Local timestamp with timezone must be recorded
        self.assertRegex(log_text, r"时间: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}")
        self.assertIn("步骤时间线", log_text)
        self.assertIn("email: filling", log_text)
        self.assertIn("页面文本快照", log_text)
        self.assertIn("Amount due today", log_text)
        self.assertIn("screenshot.png", log_text)
        self.assertGreater((folder / "screenshot.png").stat().st_size, 0)

    def test_capture_without_page_writes_log_only(self) -> None:
        record = capture_registration_incident(
            stage="registration-error",
            outcome="worker_exception",
            email="person@example.com",
            reason="RuntimeError: boom",
            root=self.root,
        )

        self.assertTrue(record["ok"])
        folder = Path(record["dir"])
        self.assertEqual(["log.txt"], [p.name for p in folder.iterdir()])
        self.assertIn("（无可用浏览器页面）", (folder / "log.txt").read_text(encoding="utf-8"))

    def test_screenshot_falls_back_to_viewport_when_full_page_fails(self) -> None:
        class HalfBrokenPage(FakePage):
            def screenshot(self, *, path: str, full_page: bool, timeout: int) -> None:
                self.screenshot_calls.append(full_page)
                if full_page:
                    raise RuntimeError("full-page capture failed")
                Path(path).write_bytes(b"viewport-png")

        record = capture_registration_incident(
            stage="plus-trial",
            outcome="eligible",
            email="person@example.com",
            page=HalfBrokenPage(),
            root=self.root,
        )
        self.assertTrue(record["ok"])
        folder = Path(record["dir"])
        self.assertEqual(b"viewport-png", (folder / "screenshot.png").read_bytes())

    def test_capture_never_raises(self) -> None:
        class ExplodingPage:
            url = "https://chatgpt.com/"

            def locator(self, _selector):
                raise RuntimeError("page gone")

            def screenshot(self, **_kwargs):
                raise RuntimeError("browser crashed")

        record = capture_registration_incident(
            stage="registration-error",
            outcome="error",
            email="person@example.com",
            page=ExplodingPage(),
            root=self.root,  # still writable; only page calls explode
        )
        self.assertTrue(record["ok"])

        broken_root = self.root / "file-used-as-dir"
        broken_root.write_text("occupied", encoding="utf-8")
        record = capture_registration_incident(
            stage="registration-error",
            outcome="error",
            root=broken_root / "log",
        )
        self.assertFalse(record["ok"])
        self.assertIn("诊断日志写入失败", record["reason"])

    def test_incident_dirs_do_not_collide_within_same_millisecond(self) -> None:
        first = create_incident_dir(
            stage="plus-trial", outcome="eligible", email="a@example.com",
            at=1755234625.5, root=self.root,
        )
        second = create_incident_dir(
            stage="plus-trial", outcome="eligible", email="b@example.com",
            at=1755234625.5, root=self.root,
        )
        self.assertNotEqual(first, second)

    def test_step_timestamps_render_as_hhmmss(self) -> None:
        lines = diagnostics._format_steps(
            [{"step": "flow", "status": "error", "at": 1755234625.0, "error": "boom"}]
        )
        self.assertEqual(1, len(lines))
        self.assertRegex(lines[0], r"^\[\d{2}:\d{2}:\d{2}\] flow: error \(error=boom\)$")

    def test_env_var_overrides_log_root(self) -> None:
        import os

        with tempfile.TemporaryDirectory() as env_tmp:
            old = os.environ.get("MERCURY_REGISTRATION_LOG_DIR")
            try:
                os.environ["MERCURY_REGISTRATION_LOG_DIR"] = env_tmp
                directory = create_incident_dir(
                    stage="checkout-kind", outcome="oaics", email="a@example.com"
                )
                self.assertEqual(Path(env_tmp), directory.parent)
            finally:
                if old is None:
                    os.environ.pop("MERCURY_REGISTRATION_LOG_DIR", None)
                else:
                    os.environ["MERCURY_REGISTRATION_LOG_DIR"] = old

    def test_log_text_truncates_oversized_page_snapshot(self) -> None:
        class HugePage(FakePage):
            def inner_text(self) -> str:
                return "x" * 10_000

        record = capture_registration_incident(
            stage="registration-error",
            outcome="error",
            page=HugePage(),
            root=self.root,
        )
        log_text = (Path(record["dir"]) / "log.txt").read_text(encoding="utf-8")
        self.assertLessEqual(log_text.count("x"), diagnostics._MAX_PAGE_TEXT_CHARS + 10)


if __name__ == "__main__":
    unittest.main()
