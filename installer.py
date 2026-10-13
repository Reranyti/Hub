"""Установщик / деинсталлятор Game & Project Hub (окно на pywebview, тот же стиль, что у приложения).

Один и тот же файл работает в двух режимах:
  GameProjectHub-Setup.exe          - установка
  uninstall.exe  (или --uninstall)  - удаление
Для автоматизации: --silent, --dir <папка>, --no-shortcuts, --no-registry, --keep-data,
  --components all|none|<id,id> (только в полной версии), --remove-exclusive (при удалении)
Полная версия (GameProjectHub-Setup-Full.exe) содержит эксклюзивные версии проектов внутри себя.
Установка идёт в профиль пользователя, права администратора не нужны.
"""
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import winreg
import zipfile
from pathlib import Path

import webview

from version import APP_FOLDER, APP_NAME, APP_VERSION, DATA_FOLDER, EXE_NAME

RES = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
FROZEN = getattr(sys, "frozen", False)
NOWIN = getattr(subprocess, "CREATE_NO_WINDOW", 0)
DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP

UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\GameProjectHub"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
WEBVIEW2_GUID = r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
DEFAULT_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Programs" / APP_FOLDER
DATA_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / DATA_FOLDER



def _load_components():
    """Компоненты полной версии: эксклюзивные версии проектов, зашитые в установщик (components.json + exclusive.zip)."""
    try:
        manifest = json.loads((RES / "components.json").read_text(encoding="utf-8"))
        return manifest.get("components", []) if (RES / "exclusive.zip").exists() else []
    except (OSError, ValueError):
        return []


COMPONENTS = _load_components()
ARGS = sys.argv[1:]
UNINSTALL_MODE = "--uninstall" in ARGS or Path(sys.executable).stem.lower() == "uninstall"

progress = {"percent": 0, "label": "", "file": "", "done": False, "error": "", "exe": ""}


# ---------- Системные помощники ----------
def _set(percent=None, label=None, file=None):
    if percent is not None:
        progress["percent"] = percent
    if label is not None:
        progress["label"] = label
    if file is not None:
        progress["file"] = file


def _installed_dir():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
            path = Path(winreg.QueryValueEx(key, "InstallLocation")[0])
            return path if (path / EXE_NAME).exists() else None
    except OSError:
        return None


def _webview2_present():
    for hive, base in ((winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node"), (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE"),
                       (winreg.HKEY_CURRENT_USER, r"Software")):
        try:
            with winreg.OpenKey(hive, base + "\\" + WEBVIEW2_GUID) as key:
                if winreg.QueryValueEx(key, "pv")[0] not in ("", "0.0.0.0"):
                    return True
        except OSError:
            continue
    return False


def _powershell(script, **env):
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        env={**os.environ, **env}, capture_output=True, text=True, timeout=40, creationflags=NOWIN,
    )
    return result.stdout.strip()


def _special_folders():
    out = _powershell("[Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('Programs')").splitlines()
    desktop = Path(out[0]) if len(out) > 0 and out[0] else Path.home() / "Desktop"
    programs = Path(out[1]) if len(out) > 1 and out[1] else None
    return desktop, programs


def _make_shortcut(lnk, target, workdir, icon, args=""):
    lnk.parent.mkdir(parents=True, exist_ok=True)
    _powershell(
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:HUB_LNK); "
        "$s.TargetPath = $env:HUB_TARGET; $s.WorkingDirectory = $env:HUB_WD; $s.IconLocation = $env:HUB_ICON; "
        "$s.Arguments = $env:HUB_ARGS; $s.Save()",
        HUB_LNK=str(lnk), HUB_TARGET=str(target), HUB_WD=str(workdir), HUB_ICON=str(icon), HUB_ARGS=args,
    )


def _kill_app():
    subprocess.run(["taskkill", "/F", "/IM", EXE_NAME], capture_output=True, creationflags=NOWIN)
    time.sleep(0.8)


def _dir_size_mb(path):
    return round(sum(f.stat().st_size for f in Path(path).rglob("*") if f.is_file()) / 1048576)


def _payload_size_mb():
    try:
        with zipfile.ZipFile(RES / "payload.zip") as archive:
            return max(1, round(sum(i.file_size for i in archive.infolist()) / 1048576))
    except (OSError, zipfile.BadZipFile):
        return 150


def _safe_target(path):
    """Не позволяем установить/удалить что-то в корне диска или в системных папках."""
    path = Path(path).resolve()
    return len(path.parts) >= 3 and path != Path.home()


def _install_components(ids):
    """Проверяет целостность (SHA-256) и раскладывает выбранные эксклюзивные версии в папку данных приложения."""
    chosen = [c for c in COMPONENTS if c["id"] in set(ids or [])]  # идентификаторы берём только из манифеста
    if not chosen:
        return []
    base = DATA_DIR / "exclusive"
    with zipfile.ZipFile(RES / "exclusive.zip") as archive:
        total, done = sum(len(c["files"]) for c in chosen), 0
        for comp in chosen:
            for name, expected in comp["files"].items():
                digest = hashlib.sha256()
                with archive.open(name) as source:
                    for chunk in iter(lambda: source.read(1 << 20), b""):
                        digest.update(chunk)
                if digest.hexdigest() != expected:
                    raise ValueError(f"Файл повреждён: {Path(name).name}. Скачайте установщик заново.")
                done += 1
                _set(60 + int(10 * done / total), "Проверяю целостность", Path(name).name)
        for index, comp in enumerate(chosen, 1):
            destination = base / comp["id"]
            shutil.rmtree(destination, ignore_errors=True)
            root = destination.resolve()
            for name in comp["files"]:
                target = (destination / name[len(comp["id"]) + 1:]).resolve()
                if root not in target.parents:
                    raise ValueError("Небезопасный путь внутри установщика.")
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(name) as source, open(target, "wb") as out:
                    shutil.copyfileobj(source, out)
            _set(70 + int(16 * index / len(chosen)), "Устанавливаю эксклюзив", comp["name"])
    return [c["id"] for c in chosen]


# ---------- Установка ----------
def do_install(opts):
    try:
        target = Path(opts["dir"]).expanduser()
        if not _safe_target(target):
            raise ValueError("Выберите обычную папку, не корень диска.")
        # если папка не пустая и это не наша прежняя установка, ставим во вложенную папку: чужие файлы не трогаем
        if target.exists() and any(target.iterdir()) and not (target / EXE_NAME).exists():
            target = target / APP_FOLDER
        payload = RES / "payload.zip"
        if not payload.exists():
            raise FileNotFoundError("В установщике нет файлов приложения (payload.zip).")

        _set(2, "Закрываю запущенную копию")
        _kill_app()
        if (target / EXE_NAME).exists():  # обновление: чистим старые файлы приложения
            shutil.rmtree(target / "_internal", ignore_errors=True)
            (target / EXE_NAME).unlink(missing_ok=True)

        target.mkdir(parents=True, exist_ok=True)
        selected = [c for c in (opts.get("components") or []) if any(c == k["id"] for k in COMPONENTS)]
        span = 55 if selected else 80  # доля шкалы на копирование самого приложения
        with zipfile.ZipFile(payload) as archive:
            names = archive.namelist()
            for i, name in enumerate(names, 1):
                archive.extract(name, target)
                if i % 12 == 0 or i == len(names):
                    _set(5 + int(span * i / len(names)), "Копирую файлы", Path(name).name)
        exe = target / EXE_NAME
        if selected:
            _install_components(selected)

        _set(88, "Настраиваю удаление программы")
        if FROZEN:
            shutil.copy2(sys.executable, target / "uninstall.exe")

        if opts.get("shortcuts", True) and not opts.get("no_shortcuts"):
            _set(91, "Создаю ярлыки")
            desktop, programs = _special_folders()
            if opts.get("desktop", True):
                _make_shortcut(desktop / f"{APP_NAME.replace('&', 'and')}.lnk", exe, target, exe)
            if opts.get("startmenu", True) and programs:
                _make_shortcut(programs / APP_FOLDER / f"{APP_NAME.replace('&', 'and')}.lnk", exe, target, exe)

        if not opts.get("no_registry"):
            _set(95, "Регистрирую в Windows")
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
                uninstaller = f'"{target / "uninstall.exe"}"'
                for name, value in {
                    "DisplayName": APP_NAME, "DisplayVersion": APP_VERSION, "InstallLocation": str(target),
                    "DisplayIcon": str(exe), "UninstallString": f"{uninstaller} --uninstall",
                    "QuietUninstallString": f"{uninstaller} --uninstall --silent",
                    "InstallDate": datetime.date.today().strftime("%Y%m%d"),
                }.items():
                    winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
                winreg.SetValueEx(key, "NoModify", 0, winreg.REG_DWORD, 1)
                winreg.SetValueEx(key, "NoRepair", 0, winreg.REG_DWORD, 1)
                winreg.SetValueEx(key, "EstimatedSize", 0, winreg.REG_DWORD, _dir_size_mb(target) * 1024)
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as run:
                if opts.get("autostart"):
                    winreg.SetValueEx(run, "GameProjectHub", 0, winreg.REG_SZ, f'"{exe}" --minimized')
                else:
                    try:
                        winreg.DeleteValue(run, "GameProjectHub")
                    except OSError:
                        pass

        progress["exe"] = str(exe)
        _set(100, "Готово", "")
        progress["done"] = True
    except Exception as error:  # показываем причину в окне
        progress["error"] = str(error) or error.__class__.__name__


# ---------- Удаление ----------
def do_uninstall(opts):
    try:
        target = _installed_dir() or Path(sys.executable).resolve().parent
        if not (target / EXE_NAME).exists() or not _safe_target(target):
            raise FileNotFoundError("Не удалось найти установленную программу.")

        _set(8, "Закрываю программу")
        _kill_app()

        _set(30, "Удаляю ярлыки")
        desktop, programs = _special_folders()
        link = f"{APP_NAME.replace('&', 'and')}.lnk"
        (desktop / link).unlink(missing_ok=True)
        if programs:
            shutil.rmtree(programs / APP_FOLDER, ignore_errors=True)

        _set(55, "Чищу записи в реестре")
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY)
        except OSError:
            pass
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as run:
                winreg.DeleteValue(run, "GameProjectHub")
        except OSError:
            pass

        if opts.get("remove_data") and DATA_DIR.exists():
            _set(75, "Удаляю мои данные")
            shutil.rmtree(DATA_DIR, ignore_errors=True)
        elif opts.get("remove_exclusive") and (DATA_DIR / "exclusive").exists():
            _set(75, "Удаляю эксклюзивные версии")  # данные пользователя (игры, настройки) остаются
            shutil.rmtree(DATA_DIR / "exclusive", ignore_errors=True)

        _set(90, "Удаляю файлы программы")
        # сам uninstall.exe занят, поэтому папку добивает отдельный процесс через несколько секунд
        # строкой, а не списком: внешние кавычки снимает сам cmd, иначе вложенные кавычки ломаются
        subprocess.Popen(f'cmd /c "ping 127.0.0.1 -n 5 >nul & rmdir /s /q "{target}""',
                         creationflags=NOWIN | DETACHED, close_fds=True)
        _set(100, "Готово", "")
        progress["done"] = True
    except Exception as error:
        progress["error"] = str(error) or error.__class__.__name__


# ---------- API окна ----------
class Api:
    def info(self):
        existing = _installed_dir()
        return {
            "mode": "uninstall" if UNINSTALL_MODE else "install",
            "version": APP_VERSION,
            "name": APP_NAME,
            "default_dir": str(existing or DEFAULT_DIR),
            "update": bool(existing) and not UNINSTALL_MODE,
            "webview2": _webview2_present(),
            "size_mb": _payload_size_mb(),
            "has_data": DATA_DIR.exists(),
            "full": bool(COMPONENTS),
            "components": [{"id": c["id"], "name": c["name"], "desc": c.get("desc", ""), "size_mb": c.get("size_mb", 0)} for c in COMPONENTS],
            "exclusive_installed": (DATA_DIR / "exclusive").exists(),
        }

    def pick_folder(self):
        result = webview.windows[0].create_file_dialog(webview.FileDialog.FOLDER)
        return result[0] if result else ""

    def start(self, opts):
        progress.update(percent=0, label="Начинаю", file="", done=False, error="", exe="")
        worker = do_uninstall if UNINSTALL_MODE else do_install
        threading.Thread(target=worker, args=(opts,), daemon=True).start()
        return True

    def progress(self):
        return dict(progress)

    def launch(self):
        if progress["exe"] and Path(progress["exe"]).exists():
            subprocess.Popen([progress["exe"]], cwd=str(Path(progress["exe"]).parent), creationflags=DETACHED, close_fds=True)
        return True

    def open_link(self, url):
        if url.startswith("https://"):
            os.startfile(url)
        return True

    def minimize(self):
        webview.windows[0].minimize()

    def close(self):
        webview.windows[0].destroy()


def run_silent():
    opts = {"dir": str(DEFAULT_DIR), "desktop": True, "startmenu": True, "autostart": False,
            "no_shortcuts": "--no-shortcuts" in ARGS, "no_registry": "--no-registry" in ARGS,
            "remove_data": "--keep-data" not in ARGS and "--remove-data" in ARGS,
            "remove_exclusive": "--remove-exclusive" in ARGS}
    if "--components" in ARGS:
        value = ARGS[ARGS.index("--components") + 1]
        opts["components"] = [c["id"] for c in COMPONENTS] if value == "all" else [] if value == "none" else value.split(",")
    else:
        opts["components"] = [c["id"] for c in COMPONENTS]  # полная версия по умолчанию ставит всё
    if "--dir" in ARGS:
        opts["dir"] = ARGS[ARGS.index("--dir") + 1]
    (do_uninstall if UNINSTALL_MODE else do_install)(opts)
    return 1 if progress["error"] else 0


def main():
    if "--silent" in ARGS:
        sys.exit(run_silent())
    webview.create_window(
        f"{APP_NAME}: " + ("удаление" if UNINSTALL_MODE else "установка (полная версия)" if COMPONENTS else "установка"),
        url=str(RES / "installer_web" / "index.html"),
        js_api=Api(), width=880, height=580, resizable=False, frameless=True, easy_drag=False,
        background_color="#0c0c0e",
    )
    webview.start()


if __name__ == "__main__":
    main()
