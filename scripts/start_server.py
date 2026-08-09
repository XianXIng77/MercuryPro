"""Start the unified MercuryPro FastAPI application."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "grok-engine" / "backend"
VENV_PYTHON = PROJECT_ROOT / "grok-engine" / "runtime" / ".venv" / (
    "Scripts/python.exe" if os.name == "nt" else "bin/python"
)


def main() -> None:
    if VENV_PYTHON.is_file() and Path(sys.executable).resolve() != VENV_PYTHON.resolve():
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), __file__, *sys.argv[1:]])

    import uvicorn

    load_dotenv(PROJECT_ROOT / ".env")
    sys.path.insert(0, str(BACKEND_DIR))
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "3000"))
    uvicorn.run(
        "app:app",
        app_dir=str(BACKEND_DIR),
        host=host,
        port=port,
        workers=1,
        reload=os.environ.get("FASTAPI_RELOAD", "").lower() in {"1", "true", "yes"},
    )


if __name__ == "__main__":
    main()
