"""Shared browser-registration selectors and multilingual UI semantics.

Site adapters should keep their own state machines, but reuse this module for
stable input discovery and for localized action labels.  This keeps adding a
new provider from requiring another copy of the same Playwright helpers.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any


EMAIL_INPUT_SELECTORS = (
    'input[type="email"]',
    'input[name="email"]',
    'input[id="email"]',
    'input[autocomplete="email"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="e-mail" i]',
)

NEW_PASSWORD_INPUT_SELECTORS = (
    'input[name="new-password"]',
    'input[name*="password" i]',
    'input[autocomplete="new-password"]',
    'input[type="password"]',
)

CURRENT_PASSWORD_INPUT_SELECTORS = (
    'input[name*="password" i]',
    'input[autocomplete="current-password"]',
    'input[type="password"]',
)

FIRST_NAME_INPUT_SELECTORS = (
    'input[name*="first" i]',
    'input[name*="given" i]',
    'input[autocomplete="given-name"]',
)

LAST_NAME_INPUT_SELECTORS = (
    'input[name*="last" i]',
    'input[name*="family" i]',
    'input[autocomplete="family-name"]',
)

FULL_NAME_INPUT_SELECTORS = (
    'input[name="name"]',
    'input[name*="fullName" i]',
    'input[name*="displayName" i]',
    'input[autocomplete="name"]',
)

ONE_TIME_CODE_INPUT_SELECTORS = (
    'input[name*="code" i]',
    'input[name="otp"]',
    'input[autocomplete="one-time-code"]',
    'input[id*="code" i]',
    'input[id*="otp" i]',
    'input[inputmode="numeric"]',
    'input[maxlength="6"]',
    'input[aria-label*="code" i]',
    'input[placeholder*="code" i]',
)


# These fragments cover the locales currently emitted by browser_geo.py plus
# common neighbouring locales. They deliberately describe intent rather than
# a specific site's DOM so xAI, OpenAI and future providers can share them.
ACTION_PATTERNS: dict[str, str] = {
    "email_signup": (
        r"sign\s*up\s*with\s*(?:an?\s*)?e-?mail(?:\s*address)?|"
        r"(?:使用|通过|用)?(?:邮箱|电子邮件|電子郵件|電郵).*(?:注册|註冊)|"
        r"(?:メール(?:アドレス)?|eメール)(?:で|を使って|を使用して)?(?:登録|サインアップ)|"
        r"(?:이메일)(?:로|을 사용하여)?\s*(?:가입|등록)|"
        r"mit\s+(?:e-?mail|e-?mail-adresse)\s+(?:registrieren|konto erstellen)|"
        r"(?:s['’]inscrire|inscription).*(?:e-?mail|adresse e-?mail)|"
        r"registrar(?:se)?\s+con\s+(?:correo(?:\s+electr[oó]nico)?|e-?mail)|"
        r"(?:cadastrar(?:-se)?|registrar(?:-se)?)\s+com\s+e-?mail|"
        r"registrati\s+con\s+(?:e-?mail|posta elettronica)|"
        r"registreren\s+met\s+e-?mail|"
        r"zarejestruj\s+si[ęe].*(?:e-?mail|poczt)|"
        r"зарегистрир(?:оваться|уйтесь).*(?:почт|e-?mail)|"
        r"e-?posta\s+ile\s+(?:kayıt|kaydol)|"
        r"daftar\s+dengan\s+email"
    ),
    "email_signin": (
        r"(?:sign|log)\s*in\s*with\s*(?:an?\s*)?e-?mail(?:\s*address)?|"
        r"(?:使用|通过|用)?(?:邮箱|电子邮件|電子郵件|電郵).*(?:登录|登入)|"
        r"(?:メール(?:アドレス)?|eメール)(?:で|を使って|を使用して)?(?:ログイン|サインイン)|"
        r"이메일(?:로|을 사용하여)?\s*(?:로그인|접속)|"
        r"mit\s+(?:e-?mail|e-?mail-adresse)\s+(?:anmelden|einloggen)|"
        r"(?:se connecter|connexion).*(?:e-?mail|adresse e-?mail)|"
        r"iniciar\s+sesi[oó]n\s+con\s+(?:correo(?:\s+electr[oó]nico)?|e-?mail)|"
        r"entrar\s+com\s+e-?mail|accedi\s+con\s+(?:e-?mail|posta elettronica)|"
        r"inloggen\s+met\s+e-?mail|zaloguj\s+si[ęe].*(?:e-?mail|poczt)|"
        r"войти.*(?:почт|e-?mail)|e-?posta\s+ile\s+giri[şs]|"
        r"masuk\s+dengan\s+email"
    ),
    "continue": (
        r"continue|next|submit|confirm|"
        r"继续|下一步|提交|确认|確認|"
        r"続行|次へ|送信|確認|"
        r"계속|다음|제출|확인|"
        r"weiter|fortfahren|n[aä]chste|best[aä]tigen|"
        r"continuer|suivant|envoyer|confirmer|"
        r"continuar|siguiente|enviar|confirmar|"
        r"continuar|pr[oó]ximo|enviar|confirmar|"
        r"continua|avanti|invia|conferma|"
        r"doorgaan|volgende|bevestigen|"
        r"dalej|nast[ęe]pny|potwierd[źz]|"
        r"продолжить|далее|подтвердить|"
        r"devam|ileri|onayla|lanjut|berikutnya|konfirmasi"
    ),
    "verify": (
        r"verify|confirm|continue|submit|"
        r"验证|驗證|确认|確認|继续|"
        r"認証|確認|続行|"
        r"인증|확인|계속|"
        r"verifizieren|best[aä]tigen|weiter|"
        r"v[ée]rifier|confirmer|continuer|"
        r"verificar|confirmar|continuar|"
        r"verifica|conferma|continua|"
        r"verifi[eë]ren|bevestigen|doorgaan|"
        r"zweryfikuj|potwierd[źz]|dalej|"
        r"проверить|подтвердить|продолжить|"
        r"doğrula|onayla|devam|verifikasi|konfirmasi|lanjut"
    ),
    "resend_code": (
        r"resend|send.*again|new\s+code|try\s+again|"
        r"重新发送|重新發送|重发|重發|重新获取|再次发送|发送新代码|"
        r"再送|もう一度送信|新しいコード|"
        r"다시\s*보내기|새\s*코드|"
        r"erneut\s+senden|neuen\s+code|"
        r"renvoyer|nouveau\s+code|"
        r"reenviar|enviar\s+de\s+nuevo|nuevo\s+c[oó]digo|"
        r"invia\s+di\s+nuovo|nuovo\s+codice|"
        r"opnieuw\s+verzenden|nieuwe\s+code|"
        r"wy[śs]lij\s+ponownie|nowy\s+kod|"
        r"отправить\s+повторно|новый\s+код|"
        r"yeniden\s+g[oö]nder|yeni\s+kod|kirim\s+ulang|kode\s+baru"
    ),
    "signup_submit": (
        r"complete\s+sign\s*up|sign\s*up|create\s+(?:an?\s+)?account|"
        r"注册|註冊|创建账号|建立帳戶|"
        r"登録|サインアップ|アカウントを作成|"
        r"가입|등록|계정\s*만들기|"
        r"registrieren|konto\s+erstellen|"
        r"s['’]inscrire|cr[ée]er\s+un\s+compte|"
        r"registrar(?:se)?|crear\s+una\s+cuenta|"
        r"cadastrar(?:-se)?|criar\s+conta|"
        r"registrati|crea\s+account|registreren|account\s+maken|"
        r"zarejestruj|utw[oó]rz\s+konto|зарегистрир|создать\s+аккаунт|"
        r"kayıt\s+ol|hesap\s+oluştur|daftar|buat\s+akun"
    ),
    "signin_submit": (
        r"sign\s*in|log\s*in|login|"
        r"登录|登入|ログイン|サインイン|로그인|"
        r"anmelden|einloggen|se\s+connecter|connexion|"
        r"iniciar\s+sesi[oó]n|entrar|accedi|inloggen|zaloguj|"
        r"войти|giri[şs]\s+yap|masuk"
    ),
    "oauth_approve": (
        r"allow|authorize|approve|accept|confirm|continue|grant|"
        r"允许|允許|授权|授權|同意|确认|確認|继续|"
        r"許可|承認|同意|続行|허용|승인|동의|계속|"
        r"zulassen|autorisieren|genehmigen|akzeptieren|best[aä]tigen|"
        r"autoriser|approuver|accepter|confirmer|"
        r"autorizar|aprobar|aceptar|confirmar|"
        r"autorizzare|approvare|accettare|confermare|"
        r"toestaan|autoriseren|goedkeuren|accepteren|"
        r"zezw[oó]l|autoryzuj|zaakceptuj|potwierd[źz]|"
        r"разрешить|авторизовать|одобрить|принять|подтвердить|"
        r"izin\s+ver|yetkilendir|onayla|kabul\s+et|izinkan|setujui|terima"
    ),
}


def action_pattern(name: str, *additional: str) -> str:
    """Return a regex for a semantic action, optionally adding site wording."""
    try:
        base = ACTION_PATTERNS[name]
    except KeyError as exc:
        raise ValueError(f"unknown browser registration action: {name}") from exc
    fragments = (base, *[value for value in additional if value])
    return "(?:" + ")|(?:".join(fragments) + ")"


def action_text_matches(name: str, text: str) -> bool:
    """Test localized visible text; useful for page-state detection and tests."""
    return bool(re.search(action_pattern(name), str(text or ""), re.I))


def first_visible(page: Any, selectors: Sequence[str], *, limit: int = 20) -> Any | None:
    """Return the first visible Playwright locator/element for selector fallbacks."""
    if page is None:
        return None
    for selector in selectors:
        try:
            locator = page.locator(selector)
            for index in range(min(limit, int(locator.count()))):
                candidate = locator.nth(index)
                if candidate.is_visible():
                    return candidate
        except Exception:
            pass
        try:
            elements = page.query_selector_all(selector)
            for candidate in elements[:limit]:
                if candidate.is_visible():
                    return candidate
            if not elements:
                candidate = page.query_selector(selector)
                if candidate and candidate.is_visible():
                    return candidate
        except Exception:
            continue
    return None


def _element_action_text(element: Any) -> str:
    values: list[str] = []
    try:
        value = element.text_content()
        if value:
            values.append(str(value))
    except Exception:
        pass
    for attribute in (
        "value",
        "aria-label",
        "title",
        "data-testid",
        "data-dd-action-name",
    ):
        try:
            value = element.get_attribute(attribute)
            if value:
                values.append(str(value))
        except Exception:
            pass
    return " ".join(values).strip()


def find_action(
    page: Any,
    pattern: str,
    *,
    include_disabled: bool = False,
    limit: int = 30,
) -> Any | None:
    """Find a visible button/link by multilingual accessible text."""
    if page is None:
        return None
    regex = re.compile(pattern, re.I)
    selector = (
        'button, a, [role="button"], [role="link"], '
        'input[type="button"], input[type="submit"]'
    )
    candidates: list[Any] = []
    try:
        locator = page.locator(selector)
        candidates = [
            locator.nth(index) for index in range(min(limit, int(locator.count())))
        ]
    except Exception:
        try:
            candidates = list(page.query_selector_all(selector))[:limit]
        except Exception:
            candidates = []
    for candidate in candidates:
        try:
            if not candidate.is_visible():
                continue
            enabled = bool(candidate.is_enabled())
            aria_disabled = candidate.get_attribute("aria-disabled") == "true"
            if not include_disabled and (not enabled or aria_disabled):
                continue
            if regex.search(_element_action_text(candidate)):
                return candidate
        except Exception:
            continue
    return None
