from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import mercury_logs  # noqa: E402


def _make_incident(
    root: Path, name: str, *, log_text: str | None = None, screenshot: bool = False
) -> Path:
    directory = root / name
    directory.mkdir(parents=True)
    if log_text is not None:
        (directory / "log.txt").write_text(log_text, encoding="utf-8")
    if screenshot:
        (directory / "screenshot.png").write_bytes(b"\x89PNG fake")
    return directory


class MercuryLogsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.root_patch = patch.object(mercury_logs, "_log_dir", lambda: self.root)
        self.root_patch.start()

    def tearDown(self) -> None:
        self.root_patch.stop()
        self.temp_dir.cleanup()

    def test_list_parses_folder_metadata(self) -> None:
        _make_incident(
            self.root,
            "20260816-185927.630_plus-trial_ineligible_kevinochoa27800ol-outlook.com",
            log_text=(
                "MercuryPro ChatGPT 注册诊断日志\n"
                "============================================\n"
                "时间: 2026-08-16 18:59:27 +0800\n"
                "阶段: plus-trial\n"
                "结果: ineligible\n"
                "邮箱: kevinochoa27800ol@outlook.com\n"
            ),
            screenshot=True,
        )
        _make_incident(
            self.root,
            "20260816-185710.170_registration-error_exception_heathersuarez10501blh-outlook.com",
            log_text="邮箱: heathersuarez10501blh@outlook.com\n",
        )
        _make_incident(self.root, "not-an-incident")

        import asyncio

        result = asyncio.run(
            mercury_logs.list_logs(email="", stage="", outcome="")
        )

        self.assertEqual(result["total"], 2)
        # 倒序:最新在前(185927 晚于 185710)
        self.assertEqual(result["items"][0]["stage"], "plus-trial")
        self.assertTrue(result["items"][0]["hasScreenshot"])
        self.assertEqual(result["items"][0]["time"], "2026-08-16 18:59:27")
        self.assertEqual(
            result["items"][0]["email"], "kevinochoa27800ol@outlook.com"
        )
        # 真实邮箱从 log.txt 解析,而非目录名里的清洗版本
        self.assertEqual(result["items"][1]["stage"], "registration-error")
        self.assertFalse(result["items"][1]["hasScreenshot"])
        self.assertEqual(
            result["items"][1]["email"], "heathersuarez10501blh@outlook.com"
        )
        self.assertIn("plus-trial", result["stages"])

    def test_list_filters_by_email_stage_outcome(self) -> None:
        import asyncio

        _make_incident(
            self.root,
            "20260816-010000.000_plus-trial_eligible_a-foo.com",
            log_text="邮箱: a@foo.com\n",
        )
        _make_incident(
            self.root,
            "20260816-020000.000_plus-trial_ineligible_b-foo.com",
            log_text="邮箱: b@foo.com\n",
        )
        _make_incident(
            self.root,
            "20260816-030000.000_registration-error_exception_c-foo.com",
            log_text="邮箱: c@foo.com\n",
        )

        only_eligible = asyncio.run(
            mercury_logs.list_logs(email="", stage="plus-trial", outcome="eligible")
        )
        self.assertEqual(only_eligible["total"], 1)
        self.assertEqual(only_eligible["items"][0]["email"], "a@foo.com")

        by_email = asyncio.run(mercury_logs.list_logs(email="B@FOO", stage="", outcome=""))
        self.assertEqual(by_email["total"], 1)
        self.assertEqual(by_email["items"][0]["email"], "b@foo.com")

        paged = asyncio.run(
            mercury_logs.list_logs(email="", stage="", outcome="", limit=1, offset=1)
        )
        self.assertEqual(len(paged["items"]), 1)
        self.assertEqual(paged["total"], 3)

    def test_log_text_returns_file_content(self) -> None:
        import asyncio

        directory = _make_incident(
            self.root, "20260816-010000.000_plus-trial_eligible_x", log_text="hello 日志"
        )

        response = asyncio.run(
            mercury_logs.get_log_text(directory.name)
        )
        self.assertIn("hello 日志", response.body.decode("utf-8"))

    def test_screenshot_returns_png_response(self) -> None:
        import asyncio

        directory = _make_incident(
            self.root, "20260816-010000.000_plus-trial_eligible_x", screenshot=True
        )

        response = asyncio.run(
            mercury_logs.get_log_screenshot(directory.name)
        )
        self.assertEqual(response.media_type, "image/png")

    def test_invalid_ids_are_rejected(self) -> None:
        import asyncio

        from fastapi import HTTPException

        for bad in ("..", "a/b", "log\\secret", "no-such-id"):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(mercury_logs.get_log_text(bad))
            self.assertEqual(ctx.exception.status_code, 404)

    def test_missing_files_return_404(self) -> None:
        import asyncio

        from fastapi import HTTPException

        directory = _make_incident(
            self.root, "20260816-010000.000_plus-trial_eligible_x"
        )
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(mercury_logs.get_log_text(directory.name))
        self.assertEqual(ctx.exception.status_code, 404)

        _make_incident(
            self.root, "20260816-020000.000_plus-trial_eligible_y", log_text="t"
        )
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(mercury_logs.get_log_screenshot("20260816-020000.000_plus-trial_eligible_y"))
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
