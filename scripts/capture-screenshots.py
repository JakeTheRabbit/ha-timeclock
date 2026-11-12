"""Recapture README screenshots from the in-browser demo build.

Run the demo first (from timeclock/webapp):  NEXT_PUBLIC_DEMO=1 next dev -p 3123
then:  uv run --with playwright python scripts/capture-screenshots.py [base_url]

Uses the system Chrome (channel="chrome"), so no browser download. Phone shots
are 420x900, desktop 1200x900, both at 2x. Demo data resets on reload.
"""

import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3123/ha-timeclock").rstrip("/")
OUT = Path(__file__).resolve().parent.parent / "screenshots"
PHONE = {"width": 420, "height": 900}
DESKTOP = {"width": 1200, "height": 900}


# Dev-server badge and toasts are noise in a screenshot.
HIDE = "nextjs-portal, [data-sonner-toaster] { display: none !important; }"


def go(page: Page, path: str, wait_text: str | None = None) -> None:
    page.goto(f"{BASE}{path}", wait_until="networkidle")
    if wait_text:
        page.get_by_text(wait_text, exact=False).first.wait_for(timeout=20_000)
    page.wait_for_timeout(800)  # let live timers / charts settle


def shot(page: Page, name: str, full: bool = False) -> None:
    page.add_style_tag(content=HIDE)
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=full)
    print("saved", name)


def pick_employee(page: Page, name: str) -> None:
    page.get_by_role("combobox").first.click()
    page.get_by_role("option", name=name).click()
    page.wait_for_timeout(1200)


def phone_shots(page: Page) -> None:
    go(page, "/", "Clock in")
    shot(page, "home")
    go(page, "/clock/", "Clock in")
    page.get_by_role("button", name="Clock in").first.click()
    page.wait_for_timeout(1500)
    page.get_by_role("button", name="Rest break").first.click()
    page.wait_for_timeout(1500)
    shot(page, "clock")
    go(page, "/my-hours/")
    shot(page, "my-hours", full=True)
    go(page, "/leave/", "Request leave")
    shot(page, "leave", full=True)
    go(page, "/roster/")
    shot(page, "roster", full=True)
    if page.goto(f"{BASE}/me/").ok:
        page.wait_for_timeout(1500)
        shot(page, "me", full=True)
    # Signed-out kiosk last (sign-out survives until reload).
    go(page, "/pin/")
    signout = page.get_by_role("button", name="Sign out")
    if signout.count():
        signout.first.click()
        page.wait_for_timeout(1500)
    shot(page, "pin")


def desktop_shots(page: Page) -> None:
    go(page, "/manager/", "On the clock")
    shot(page, "manager", full=True)
    go(page, "/manager/review/", "Approve days")
    page.wait_for_timeout(2000)
    shot(page, "review")
    go(page, "/manager/entries/")
    pick_employee(page, "Priya Nair")
    shot(page, "entries")
    # Second card: a finished day with a break (the first is a running shift).
    page.get_by_role("button", name="Edit day").nth(1).click()
    page.wait_for_timeout(1200)
    shot(page, "day-editor")
    page.keyboard.press("Escape")
    go(page, "/manager/pay-periods/")
    page.wait_for_timeout(2000)
    shot(page, "pay-periods", full=True)
    go(page, "/manager/insights/")
    page.wait_for_timeout(2500)
    shot(page, "insights", full=True)
    go(page, "/manager/audit/")
    page.wait_for_timeout(1500)
    shot(page, "audit")
    go(page, "/admin/employees/")
    page.wait_for_timeout(1500)
    shot(page, "admin-employees", full=True)
    go(page, "/admin/settings/")
    page.wait_for_timeout(1500)
    shot(page, "admin-settings", full=True)
    if page.goto(f"{BASE}/admin/devices/").ok:
        page.wait_for_timeout(1500)
        shot(page, "admin-devices")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        for viewport, fn in ((PHONE, phone_shots), (DESKTOP, desktop_shots)):
            ctx = browser.new_context(viewport=viewport, device_scale_factor=2, color_scheme="dark")
            page = ctx.new_page()
            fn(page)
            ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
