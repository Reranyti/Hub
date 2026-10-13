"""Game & Project Hub: окно (pywebview) + Python-бэкенд (данные, Steam, файлы)."""
import base64
import datetime
import glob
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
import zipfile
from pathlib import Path

import psutil
import webview

FROZEN = getattr(sys, "frozen", False)  # True, когда запущено из собранного .exe
BASE = Path(__file__).resolve().parent
RESOURCES = Path(getattr(sys, "_MEIPASS", BASE))  # здесь лежит папка web
# Из .exe данные хранятся в профиле пользователя (в Program Files писать нельзя), из исходников рядом с кодом
DATA_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "GameProjectHub" if FROZEN else BASE
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATA_FILE = DATA_DIR / "data.json"
SETTINGS_FILE = DATA_DIR / "settings.json"  # здесь хранится Steam API-ключ, только локально
TRACK_FILE = DATA_DIR / "tracking.json"  # авто-учёт времени (пишет только фоновый трекер)
META_FILE = DATA_DIR / "meta.json"  # жанры, описания и т.п. из магазина Steam (пишет только фоновый загрузчик)
WISH_FILE = DATA_DIR / "wishlist.json"  # вишлист Steam с ценами
AUTHOR_FILE = DATA_DIR / "author.json"  # кэш проектов автора с GitHub
AUTHOR_LOGIN = "Reranyti"
AUTHOR_GAMES_FILE = DATA_DIR / "author_games.json"  # установленные игры автора
AUTHOR_GAMES_DIR = DATA_DIR / "games"
AUTHOR_MODS_FILE = DATA_DIR / "author_mods.json"  # установленные моды автора: {репозиторий: {tag, mods_dir, files}}
_author_progress = {}  # репозиторий -> ход скачивания

STEAM_API = "https://api.steampowered.com"
SKIP_APP_NAMES = ("Steamworks Common Redistributables", "Proton", "Steam Linux Runtime")

NOWIN_FLAG = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_ach_cache = {}  # appid -> (время, ответ): достижения кэшируем на 10 минут

# Анализ папки проекта
SCAN_IGNORE = {".git", "node_modules", "venv", ".venv", "__pycache__", "dist", "build", "target", "bin", "obj", ".idea",
               ".vscode", "Library", "Temp", "Packages", ".next", ".gradle", "Binaries", "Intermediate", "Saved"}
EXT_LANG = {".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript",
            ".html": "HTML", ".css": "CSS", ".cs": "C#", ".cpp": "C++", ".c": "C", ".java": "Java", ".kt": "Kotlin",
            ".rs": "Rust", ".go": "Go", ".lua": "Lua", ".gd": "GDScript", ".rb": "Ruby", ".php": "PHP",
            ".swift": "Swift", ".dart": "Dart", ".ino": "Arduino", ".gml": "GameMaker", ".sh": "Shell",
            ".ps1": "PowerShell"}
TECH_MARKERS = [("package.json", "Node.js"), ("requirements.txt", "Python"), ("pyproject.toml", "Python"),
                ("Cargo.toml", "Rust"), ("go.mod", "Go"), ("pom.xml", "Java"), ("build.gradle", "Gradle"),
                ("CMakeLists.txt", "CMake"), ("Dockerfile", "Docker"), ("project.godot", "Godot"),
                ("platformio.ini", "PlatformIO")]

TRACK_INTERVAL = 15  # секунд между проверками запущенных процессов
DEFAULT_PREFS = {"break_hours": 0, "day_limit_hours": 0, "notify": True, "steam_autosync": True, "discount_alert": 50}
_sessions = {}  # id игры -> {"since": время старта подряд, "n": сколько напоминаний о перерыве уже было}
_day_notified = ""
_meta_lock = threading.Lock()
_meta_rev = 0
_wish_lock = threading.Lock()
_track_lock = threading.Lock()
_running_ids = set()
_icon_cache = None  # {ключ каталога: data-URI иконки}, считается один раз

# Где искать .exe игр, чтобы взять из них настоящую иконку (только локальные файлы)
CATALOG_EXE = {
    "minecraft_java": ["C:/Program Files (x86)/Minecraft Launcher/MinecraftLauncher.exe",
                       "C:/XboxGames/Minecraft Launcher/Content/Minecraft.exe"],
    "minecraft_bedrock": ["C:/XboxGames/Minecraft for Windows/Content/Minecraft.Windows.exe"],
    "osu": ["%LOCALAPPDATA%/osu!/osu!.exe", "%LOCALAPPDATA%/osulazer/current/osu!.exe"],
    "roblox": ["%LOCALAPPDATA%/Roblox/Versions/*/RobloxPlayerBeta.exe",
               "%LOCALAPPDATA%/Roblox/Versions/*/RobloxPlayerLauncher.exe"],
    "valorant": ["C:/Riot Games/VALORANT/live/VALORANT.exe", "C:/Riot Games/Riot Client/RiotClientServices.exe"],
    "lol": ["C:/Riot Games/League of Legends/LeagueClient.exe"],
    "genshin": ["C:/Program Files/Genshin Impact/launcher.exe", "D:/Genshin Impact/launcher.exe",
                "C:/Program Files/Genshin Impact/Genshin Impact Game/GenshinImpact.exe"],
}

# Каталог особых игр (не из Steam). detect - папки, по которым понятно, что игра есть на ПК.
CATALOG = [
    {"key": "minecraft_java", "name": "Minecraft: Java Edition", "genre": "Песочница · Java", "emoji": "⛏",
     "hue": 118, "process": "javaw.exe", "process_cmd": "minecraft", "template": "minecraft", "edition": "java",
     "detect": ["%APPDATA%/.minecraft"]},
    {"key": "minecraft_bedrock", "name": "Minecraft: Bedrock Edition", "genre": "Песочница · Bedrock", "emoji": "🧱",
     "hue": 150, "process": "Minecraft.Windows.exe", "process_cmd": "", "template": "minecraft", "edition": "bedrock",
     "detect": ["%LOCALAPPDATA%/Packages/Microsoft.MinecraftUWP_8wekyb3d8bbwe"]},
    {"key": "osu", "name": "osu!", "genre": "Ритм-игра", "emoji": "🎵", "hue": 330,
     "process": "osu!.exe", "process_cmd": "", "template": "osu", "edition": "",
     "detect": ["%LOCALAPPDATA%/osu!"]},
    {"key": "roblox", "name": "Roblox", "genre": "Платформа игр", "emoji": "🟥", "hue": 0,
     "process": "RobloxPlayerBeta.exe", "process_cmd": "", "template": "roblox", "edition": "",
     "detect": ["%LOCALAPPDATA%/Roblox"]},
    {"key": "valorant", "name": "VALORANT", "genre": "Тактический шутер", "emoji": "🎯", "hue": 350,
     "process": "VALORANT-Win64-Shipping.exe", "process_cmd": "", "template": "valorant", "edition": "",
     "detect": ["C:/Riot Games/VALORANT"]},
    {"key": "lol", "name": "League of Legends", "genre": "MOBA", "emoji": "⚔", "hue": 210,
     "process": "League of Legends.exe", "process_cmd": "", "template": "lol", "edition": "",
     "detect": ["C:/Riot Games/League of Legends"]},
    {"key": "fortnite", "name": "Fortnite", "genre": "Battle Royale", "emoji": "🪂", "hue": 270,
     "process": "FortniteClient-Win64-Shipping.exe", "process_cmd": "", "template": "", "edition": "",
     "detect": []},
    {"key": "genshin", "name": "Genshin Impact", "genre": "Action RPG", "emoji": "✨", "hue": 190,
     "process": "GenshinImpact.exe", "process_cmd": "", "template": "", "edition": "",
     "detect": ["C:/Program Files/Genshin Impact", "D:/Genshin Impact"]},
    {"key": "tlauncher", "name": "Minecraft (TLauncher)", "genre": "Песочница · Java", "emoji": "🧊",
     "hue": 95, "process": "javaw.exe", "process_cmd": "minecraft", "template": "minecraft", "edition": "java",
     "detect": ["%APPDATA%/.tlauncher"]},
]


def _read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write_json(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _new_id():
    return uuid.uuid4().hex[:12]


def _load_data():
    data = _read_json(DATA_FILE, {})
    data.setdefault("games", [])
    data.setdefault("projects", [])
    missing = [g for g in data["games"] if not g.get("id")]
    for game in missing:
        game["id"] = _new_id()
    if missing:
        _write_json(DATA_FILE, data)
    return data


# ---------- Настройки и уведомления ----------
def _prefs():
    saved = _read_json(SETTINGS_FILE, {}).get("prefs", {})
    return {**DEFAULT_PREFS, **{k: v for k, v in saved.items() if k in DEFAULT_PREFS}}


def _notify(title, text):
    """Всплывающее уведомление Windows (через PowerShell, отдельного приложения не нужно)."""
    script = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null; "
        "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); "
        "$t = $x.GetElementsByTagName('text'); "
        "$t.Item(0).AppendChild($x.CreateTextNode($env:HUB_TITLE)) | Out-Null; "
        "$t.Item(1).AppendChild($x.CreateTextNode($env:HUB_TEXT)) | Out-Null; "
        "$toast = [Windows.UI.Notifications.ToastNotification]::new($x); "
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("
        "'{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                       env={**os.environ, "HUB_TITLE": title, "HUB_TEXT": text}, capture_output=True, timeout=20,
                       creationflags=NOWIN_FLAG)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def _check_reminders(running, games_by_id, tracking, day):
    """Напоминание о перерыве (игра идёт подряд долго) и о дневном лимите времени."""
    global _day_notified
    prefs = _prefs()
    if not prefs["notify"]:
        return
    now = time.time()
    brk = float(prefs["break_hours"] or 0)
    for game_id in running:
        session = _sessions.setdefault(game_id, {"since": now, "n": 0})
        hours = (now - session["since"]) / 3600
        if brk > 0 and hours >= brk * (session["n"] + 1):
            session["n"] += 1
            name = games_by_id.get(game_id, {}).get("name", "игра")
            _notify("Пора сделать перерыв", f"{name}: вы играете уже {hours:.1f} ч подряд.")
    limit = float(prefs["day_limit_hours"] or 0)
    if limit > 0 and _day_notified != day:
        today = sum(entry.get("days", {}).get(day, 0) for entry in tracking.values()) / 3600
        if today >= limit:
            _day_notified = day
            _notify("Дневной лимит игр", f"Сегодня уже {today:.1f} ч в играх (лимит {limit:g} ч).")


# ---------- Авто-учёт времени ----------
def _tick(elapsed):
    """Один проход трекера: кто из отслеживаемых игр сейчас запущен, и прибавить им время."""
    global _running_ids
    games = [g for g in _read_json(DATA_FILE, {}).get("games", []) if g.get("id") and g.get("process")]
    if not games:
        _running_ids = set()
        _sessions.clear()
        return
    need_cmd = any(g.get("process_cmd") for g in games)
    attrs = ["name", "cmdline"] if need_cmd else ["name"]
    procs = []
    for proc in psutil.process_iter(attrs):
        info = proc.info
        procs.append(((info.get("name") or "").lower(), " ".join(info.get("cmdline") or []).lower()))

    running = set()
    for game in games:
        name = game["process"].lower()
        cmd = (game.get("process_cmd") or "").lower()
        if any(n == name and (not cmd or cmd in c) for n, c in procs):
            running.add(game["id"])
    _running_ids = running
    for game_id in list(_sessions):  # игра закрылась: серия «подряд» обрывается
        if game_id not in running:
            del _sessions[game_id]
    if not running:
        return

    now = datetime.datetime.now()
    day = now.date().isoformat()
    with _track_lock:
        tracking = _read_json(TRACK_FILE, {})
        for game_id in running:
            entry = tracking.setdefault(game_id, {"seconds": 0, "days": {}})
            entry["seconds"] = round(entry["seconds"] + elapsed, 1)
            entry["days"][day] = round(entry["days"].get(day, 0) + elapsed, 1)
            entry["last"] = now.isoformat(timespec="seconds")
        _write_json(TRACK_FILE, tracking)
        _check_reminders(running, {g["id"]: g for g in games}, tracking, day)


def _tracker_loop():
    last = time.time()
    while True:
        time.sleep(TRACK_INTERVAL)
        now = time.time()
        elapsed = min(now - last, TRACK_INTERVAL * 3)  # после сна ПК не начисляем лишнее
        last = now
        try:
            _tick(elapsed)
        except Exception:  # трекер не должен падать из-за одного сбоя
            pass


# ---------- Проекты автора: скачать и играть (любая версия) ----------
MAX_DOWNLOAD = 800 * 1048576
MOD_WORDS = re.compile(r"pack|mod|forge|fabric|neoforge|lib", re.IGNORECASE)
SKIP_EXE = re.compile(r"unins|uninstall|crash|redist|dxsetup|updater|setup|vc_|helper", re.IGNORECASE)


def _github_json(path):
    request = urllib.request.Request("https://api.github.com/" + path,
                                     headers={"User-Agent": "GameProjectHub", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


HUB_REPO = "Hub"
EXCLUSIVE_PREFIX = {"Lotos-Outer": "lotos-"}  # проект -> префикс тега в релизах Hub, где лежат его эксклюзивные версии
AUTHOR_SCHEMA = 3  # при смене формата кэш списка проектов считается устаревшим


def _versions_from_releases(releases, tag_prefix="", exclusive=False):
    versions = []
    for release in releases:
        if release.get("draft"):
            continue
        raw_tag = release.get("tag_name") or release.get("name") or ""
        if not raw_tag or (tag_prefix and not raw_tag.startswith(tag_prefix)):
            continue
        tag = raw_tag[len(tag_prefix):]
        assets = release.get("assets", [])

        def entry(kind, files, main):
            return {"kind": kind, "tag": tag, "title": (release.get("name") or "")[:90], "asset": main["name"],
                    "url": main["browser_download_url"], "size": main["size"], "published": release.get("published_at") or "",
                    "exclusive": exclusive,
                    "files": [{"name": a["name"], "url": a["browser_download_url"], "size": a["size"]} for a in files]}

        zips = [a for a in assets if a["name"].lower().endswith(".zip")]
        games = [a for a in zips if "win" in a["name"].lower()] or [a for a in zips if not MOD_WORDS.search(a["name"])]
        if games:
            main = max(games, key=lambda a: a["size"])
            versions.append(entry("game", [main], main))
            continue
        jars = [a for a in assets if a["name"].lower().endswith(".jar")]
        packs = [a for a in zips if MOD_WORDS.search(a["name"])]
        files = jars if any(a["size"] > 1048576 for a in jars) else packs  # мод вместе с его библиотекой
        if files:
            main = max(files, key=lambda a: a["size"])
            item = entry("mod", files, main)
            item["asset"] = ", ".join(a["name"] for a in files)
            item["size"] = sum(a["size"] for a in files)
            versions.append(item)
    return versions


def _list_versions(repo):
    """Все версии проекта, в которые можно сыграть: релизы самого проекта плюс эксклюзивные версии из релизов Hub."""
    try:
        versions = _versions_from_releases(_github_json(f"repos/{AUTHOR_LOGIN}/{repo}/releases?per_page=50"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return []
    prefix = EXCLUSIVE_PREFIX.get(repo)
    if prefix:
        try:
            exclusive = _versions_from_releases(_github_json(f"repos/{AUTHOR_LOGIN}/{HUB_REPO}/releases?per_page=50"), prefix, True)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            exclusive = []
        taken = {v["tag"] for v in exclusive}
        versions = exclusive + [v for v in versions if v["tag"] not in taken]  # одинаковая версия: берём эксклюзивную
    seen, unique = set(), []
    for item in sorted(versions, key=lambda v: v["published"], reverse=True):  # новейшие первыми
        if item["tag"] not in seen:
            seen.add(item["tag"])
            unique.append(item)
    return unique


def _download_file(url, dest, on_progress):
    if not url.startswith(f"https://github.com/{AUTHOR_LOGIN}/"):
        raise ValueError("Загрузка разрешена только из репозиториев автора.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "GameProjectHub"})
    with urllib.request.urlopen(request, timeout=30) as response, open(dest, "wb") as out:
        total = int(response.headers.get("Content-Length") or 0)
        if total > MAX_DOWNLOAD:
            raise ValueError("Файл слишком большой.")
        done = 0
        while True:
            chunk = response.read(262144)
            if not chunk:
                break
            done += len(chunk)
            if done > MAX_DOWNLOAD:
                raise ValueError("Файл слишком большой.")
            out.write(chunk)
            if total:
                on_progress(done / total)


def _safe_extract(archive, target):
    root = target.resolve()
    for member in archive.infolist():
        destination = (target / member.filename).resolve()
        if destination != root and root not in destination.parents:
            raise ValueError("В архиве небезопасные пути.")
    archive.extractall(target)


def _find_game_exe(folder, repo):
    candidates = []
    for path in folder.rglob("*.exe"):
        if len(path.relative_to(folder).parts) <= 3 and not SKIP_EXE.search(path.stem):
            candidates.append(path)
    if not candidates:
        return None
    named = [p for p in candidates if repo.lower() in p.stem.lower()]
    return max(named or candidates, key=lambda p: p.stat().st_size)


def _author_games():
    """{репозиторий: {"last": версия, "versions": {версия: {dir, exe, process, icon}}}}"""
    records = _read_json(AUTHOR_GAMES_FILE, {})
    for repo, rec in list(records.items()):
        if "versions" not in rec:  # запись из первой версии приложения: одна установленная версия
            records[repo] = {"last": rec.get("tag", ""), "versions": {rec.get("tag", ""): rec}}
    return records


def _safe_tag(tag):
    return re.sub(r"[^\w.\-]+", "_", tag)


def _author_worker(repo, play):
    progress = _author_progress[f"{repo}@{play['tag']}"]
    try:
        safe_tag = _safe_tag(play["tag"])
        if play["kind"] == "mod":
            files = play.get("files") or [{"name": play["asset"], "url": play["url"]}]
            jars = [f for f in files if f["name"].lower().endswith(".jar")]
            if not jars:  # сборка-архив для лаунчера: в mods её не положишь, сохраняем в «Загрузки»
                folder = Path.home() / "Downloads" / f"{repo} {safe_tag}"
                for index, item in enumerate(files):
                    _download_file(item["url"], folder / Path(item["name"]).name,
                                   lambda f, i=index: progress.update(percent=int((i + f) / len(files) * 100)))
                progress.update(state="done", percent=100, path=str(folder))
                return
            mods_dir = Path(play["mods_dir"])
            staging = DATA_DIR / "downloads" / repo / safe_tag
            shutil.rmtree(staging, ignore_errors=True)
            for index, item in enumerate(jars):
                _download_file(item["url"], staging / Path(item["name"]).name,
                               lambda f, i=index: progress.update(percent=int((i + f) / len(jars) * 90)))
            progress.update(label="Устанавливаю", percent=95)
            mods_dir.mkdir(parents=True, exist_ok=True)
            backup = mods_dir / ".hub-old"
            names = [Path(item["name"]).name for item in jars]
            for name in names:  # прежние версии этого же мода (lotusblight-1.6.0.jar для lotusblight-2.0.jar) уходят в запасник
                prefix = re.split(r"-\d", name, maxsplit=1)[0].lower()
                for old in mods_dir.glob("*.jar"):
                    if old.name != name and old.name.lower().startswith(prefix + "-"):
                        backup.mkdir(exist_ok=True)
                        shutil.move(str(old), str(backup / old.name))
            for name in names:
                shutil.copy2(staging / name, mods_dir / name)
            shutil.rmtree(staging, ignore_errors=True)
            records = _read_json(AUTHOR_MODS_FILE, {})
            records[repo] = {"tag": play["tag"], "mods_dir": str(mods_dir), "files": names}
            _write_json(AUTHOR_MODS_FILE, records)
            progress.update(state="done", percent=100, path=str(mods_dir))
            return
        base = AUTHOR_GAMES_DIR / repo
        archive_path = base / f"{safe_tag}.zip"
        _download_file(play["url"], archive_path, lambda f: progress.update(percent=int(f * 90)))
        progress.update(label="Распаковываю", percent=92)
        version_dir = base / safe_tag
        shutil.rmtree(version_dir, ignore_errors=True)
        with zipfile.ZipFile(archive_path) as archive:
            _safe_extract(archive, version_dir)
        archive_path.unlink(missing_ok=True)
        exe = _find_game_exe(version_dir, repo)
        if not exe:
            shutil.rmtree(version_dir, ignore_errors=True)
            raise FileNotFoundError("В сборке не найден запускаемый файл.")
        icon = (_extract_icons([str(exe)]) or [""])[0]
        records = _author_games()
        rec = records.setdefault(repo, {"last": play["tag"], "versions": {}})
        rec["versions"][play["tag"]] = {"dir": str(version_dir), "exe": str(exe), "process": exe.name,
                                        "icon": f"data:image/png;base64,{icon}" if len(icon) > 100 else ""}
        rec["last"] = play["tag"]
        _write_json(AUTHOR_GAMES_FILE, records)
        progress.update(state="done", percent=100, path=str(exe))
    except Exception as error:
        progress.update(state="error", error=str(error) or error.__class__.__name__)


# ---------- Метаданные игр из магазина Steam (фоном, без ключа) ----------
def _store_json(params):
    url = "https://store.steampowered.com/api/appdetails?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "GameProjectHub/1.0", "Accept-Language": "ru"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.loads(response.read().decode("utf-8"))


def _fetch_meta(appid):
    entry = _store_json({"appids": appid, "l": "russian", "cc": "ru"}).get(str(appid), {})
    if not entry.get("success"):
        return {"missing": True, "ts": time.time()}
    data = entry["data"]
    year = re.search(r"(?:19|20)\d{2}", data.get("release_date", {}).get("date", ""))
    return {
        "name": data.get("name", ""),
        "genres": [g["description"] for g in data.get("genres", [])],
        "cats": [c["description"] for c in data.get("categories", [])],
        "year": int(year.group(0)) if year else 0,
        "score": (data.get("metacritic") or {}).get("score", 0),
        "dev": ", ".join(data.get("developers", [])[:2]),
        "desc": html.unescape(data.get("short_description", ""))[:320],
        "free": bool(data.get("is_free")),
        "ts": time.time(),
    }


def _meta_todo():
    wanted = [str(g["appid"]) for g in _read_json(DATA_FILE, {}).get("games", []) if g.get("appid")]
    wanted += [str(i["appid"]) for i in _read_json(WISH_FILE, {}).get("items", [])]
    have = _read_json(META_FILE, {})
    return [a for a in dict.fromkeys(wanted) if a not in have]


def _meta_loop():
    """Подтягивает по одной игре раз в ~1.7 с: у магазина Steam лимит около 200 запросов за 5 минут."""
    global _meta_rev
    time.sleep(20)  # даём приложению спокойно стартовать
    while True:
        try:
            todo = _meta_todo()
            if not todo:
                time.sleep(60)
                continue
            try:
                entry = _fetch_meta(todo[0])
            except urllib.error.HTTPError as error:
                time.sleep(150 if error.code == 429 else 30)
                continue
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
                time.sleep(30)
                continue
            with _meta_lock:
                meta = _read_json(META_FILE, {})
                meta[todo[0]] = entry
                _write_json(META_FILE, meta)
                _meta_rev += 1
            time.sleep(1.7)
        except Exception:
            time.sleep(30)


# Если .exe не нашёлся, берём иконку из ярлыка в меню «Пуск» (по имени ярлыка)
CATALOG_LNK = {
    "minecraft_java": r"^Minecraft( Launcher)?$", "minecraft_bedrock": r"Minecraft (for Windows|Bedrock)",
    "tlauncher": r"^TLauncher$", "osu": r"^osu", "roblox": r"^Roblox( Player)?$",
    "valorant": r"VALORANT", "lol": r"League of Legends", "fortnite": r"^Fortnite", "genshin": r"Genshin",
}


def _start_menu_shortcuts():
    roots = [Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
             Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Microsoft/Windows/Start Menu/Programs"]
    found = []
    for root in roots:
        for folder, _dirs, files in os.walk(root):
            found.extend(Path(folder) / name for name in files if name.lower().endswith(".lnk"))
    return found


def _git(folder, *args):
    try:
        out = subprocess.run(["git", "-C", str(folder), *args], capture_output=True, text=True, encoding="utf-8",
                             errors="ignore", timeout=8, creationflags=NOWIN_FLAG)
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _community_achievements(steamid, appid):
    """Достижения по открытому профилю, без API-ключа (XML страницы статистики Steam)."""
    url = f"https://steamcommunity.com/profiles/{steamid}/stats/{appid}/?xml=1"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "ru"})
    with urllib.request.urlopen(request, timeout=25) as response:
        xml = response.read().decode("utf-8", "ignore")
    privacy = re.search(r"<privacyState>(\w+)</privacyState>", xml)
    if privacy and privacy.group(1) != "public":
        return None
    items = []
    for closed, block in re.findall(r'<achievement closed="(\d)">(.*?)</achievement>', xml, re.S):
        def tag(name):
            found = re.search(rf"<{name}>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{name}>", block, re.S)
            return html.unescape(found.group(1).strip()) if found else ""
        items.append({"id": tag("apiname"), "name": tag("name"), "desc": tag("description"), "achieved": closed == "1",
                      "time": int(tag("unlockTimestamp") or 0), "icon": tag("iconOpen"), "icon_gray": tag("iconClosed"),
                      "hidden": False})
    return items


def _find_icon_source(key, shortcuts):
    for pattern in CATALOG_EXE.get(key, []):
        matches = glob.glob(os.path.expandvars(pattern))
        if matches:
            return matches[0]
    regex = CATALOG_LNK.get(key)
    if regex:
        for lnk in shortcuts:
            if re.search(regex, lnk.stem, re.IGNORECASE):
                return str(lnk)
    return None


def _extract_icons(paths):
    """Иконки .exe в PNG (base64) через стандартный .NET в Windows PowerShell. Пустая строка, если не вышло."""
    if not paths:
        return []
    script = (
        "Add-Type -AssemblyName System.Drawing; $sh = New-Object -ComObject WScript.Shell; "
        "foreach ($p in ($env:HUB_ICON_PATHS -split '[|]')) { try { "
        # у ярлыка берём иконку его цели; если цель не нашлась, пусто (лучше наш значок, чем общий значок ярлыка)
        "if ($p -like '*.lnk') { $l = $sh.CreateShortcut($p); $loc = ($l.IconLocation -split ',')[0]; $t = $l.TargetPath; "
        "if ($loc -and (Test-Path $loc) -and ($loc -match '[.](exe|ico)$')) { $p = $loc } "
        "elseif ($t -and (Test-Path $t) -and ($t -match '[.]exe$')) { $p = $t } else { throw 'no target' } } "
        "$i = [System.Drawing.Icon]::ExtractAssociatedIcon($p); $ms = New-Object System.IO.MemoryStream; "
        "$i.ToBitmap().Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); "
        "[Convert]::ToBase64String($ms.ToArray()) } catch { '' } }"
    )
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            env={**os.environ, "HUB_ICON_PATHS": "|".join(paths)}, capture_output=True, text=True,
            timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout.splitlines()
    except (OSError, subprocess.SubprocessError):
        return [""] * len(paths)
    out += [""] * (len(paths) - len(out))
    return out[:len(paths)]


def _catalog_icons():
    global _icon_cache
    if _icon_cache is None:
        shortcuts = _start_menu_shortcuts()
        found = {entry["key"]: _find_icon_source(entry["key"], shortcuts) for entry in CATALOG}
        found = {key: path for key, path in found.items() if path}
        encoded = _extract_icons(list(found.values()))
        _icon_cache = {key: f"data:image/png;base64,{data}" for key, data in zip(found, encoded) if len(data) > 100}
    return _icon_cache


def _epic_items():
    manifests = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Epic" / "EpicGamesLauncher" / "Data" / "Manifests"
    items = []
    for file in manifests.glob("*.item"):
        try:
            manifest = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        categories = manifest.get("AppCategories") or ["games"]
        if "games" not in categories or not manifest.get("DisplayName"):
            continue
        items.append({"name": manifest["DisplayName"],
                      "process": Path(manifest.get("LaunchExecutable") or "").name})
    return items


def _http_json(path, params):
    url = f"{STEAM_API}/{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": "GameProjectHub/1.0"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.loads(response.read().decode("utf-8"))


def _steam_root():
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            path = Path(winreg.QueryValueEx(key, "SteamPath")[0])
            if path.exists():
                return path
    except OSError:
        pass
    fallback = Path(r"C:\Program Files (x86)\Steam")
    return fallback if fallback.exists() else None


def _merge_games(data, incoming):
    """Обновляет игры по appid (или по названию), новые добавляет. Возвращает (добавлено, обновлено)."""
    by_appid = {str(g["appid"]): g for g in data["games"] if g.get("appid")}
    by_name = {g.get("name", "").lower(): g for g in data["games"]}
    added = updated = 0
    for game in incoming:
        appid = str(game["appid"])
        existing = by_appid.get(appid) or by_name.get(game["name"].lower())
        if existing:
            existing["appid"] = appid
            existing["source"] = "steam"
            if "hours" in game:
                existing["hours"] = game["hours"]
            if "installed" in game:
                existing["installed"] = game["installed"]
            for field in ("last_played", "recent"):
                if field in game:
                    existing[field] = game[field]
            updated += 1
        else:
            item = {
                "id": _new_id(),
                "name": game["name"],
                "genre": "Steam",
                "status": "В библиотеке",
                "hours": game.get("hours", 0),
                "rating": 0,
                "notes": "",
                "appid": appid,
                "source": "steam",
                "installed": game.get("installed", False),
                "last_played": game.get("last_played", 0),
                "recent": game.get("recent", 0),
            }
            data["games"].append(item)
            by_appid[appid] = item
            added += 1
    return added, updated


class Api:
    # ---- данные ----
    def load(self):
        settings = _read_json(SETTINGS_FILE, {})
        return {
            "data": _load_data(),
            "settings": {
                "steamid": settings.get("steamid", ""),
                "has_key": bool(settings.get("key")),
                "last_sync": settings.get("last_sync", ""),
            },
            "prefs": _prefs(),
            "tools": {"code": bool(shutil.which("code")), "git": bool(shutil.which("git"))},
        }

    def save_data(self, data):
        _write_json(DATA_FILE, data)
        return True

    # ---- файлы и ссылки ----
    def pick_folder(self):
        window = webview.windows[0]
        folder_type = webview.FileDialog.FOLDER
        result = window.create_file_dialog(folder_type)
        return result[0] if result else ""

    def open_path(self, path):
        if path and Path(path).exists():
            os.startfile(path)
            return True
        return False

    def open_link(self, url):
        url = (url or "").strip()
        if not url:
            return False
        if "://" not in url:
            url = "https://" + url
        if not url.lower().startswith(("http://", "https://")):
            return False
        webbrowser.open(url)
        return True

    # ---- Steam ----
    def detect_steam_user(self):
        """SteamID64 последнего аккаунта, входившего в Steam на этом ПК."""
        root = _steam_root()
        if not root:
            return ""
        try:
            text = (root / "config" / "loginusers.vdf").read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return ""
        for match in re.finditer(r'"(\d{17})"\s*\{(.*?)\}', text, re.DOTALL):
            if re.search(r'"MostRecent"\s*"1"', match.group(2)):
                return match.group(1)
        found = re.search(r'"(\d{17})"', text)
        return found.group(1) if found else ""

    def save_steam_settings(self, key, steamid):
        settings = _read_json(SETTINGS_FILE, {})
        if key and key.strip():
            settings["key"] = key.strip()
        settings["steamid"] = (steamid or "").strip()
        _write_json(SETTINGS_FILE, settings)
        return {"steamid": settings["steamid"], "has_key": bool(settings.get("key"))}

    def forget_steam_key(self):
        settings = _read_json(SETTINGS_FILE, {})
        settings.pop("key", None)
        _write_json(SETTINGS_FILE, settings)
        return True

    def _resolve_steamid(self, key, raw):
        raw = (raw or "").strip().rstrip("/")
        if re.fullmatch(r"\d{17}", raw):
            return raw
        profile = re.search(r"steamcommunity\.com/profiles/(\d{17})", raw)
        if profile:
            return profile.group(1)
        vanity = re.search(r"steamcommunity\.com/id/([^/?#]+)", raw)
        name = vanity.group(1) if vanity else raw
        if not name:
            return ""
        reply = _http_json("ISteamUser/ResolveVanityURL/v1/",
                           {"key": key, "vanityurl": name}).get("response", {})
        return reply.get("steamid", "") if reply.get("success") == 1 else ""

    def steam_import(self):
        """Импорт всей библиотеки через Steam Web API (нужны ключ и публичный профиль)."""
        settings = _read_json(SETTINGS_FILE, {})
        key = settings.get("key")
        if not key:
            return {"ok": False, "error": "Сначала введите Steam API-ключ."}
        try:
            steamid = self._resolve_steamid(key, settings.get("steamid", ""))
            if not steamid:
                return {"ok": False, "error": "Не удалось определить SteamID. Проверьте ID или ник профиля."}
            reply = _http_json("IPlayerService/GetOwnedGames/v1/", {
                "key": key, "steamid": steamid, "include_appinfo": 1,
                "include_played_free_games": 1, "format": "json",
            }).get("response", {})
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                return {"ok": False, "error": "Steam отклонил API-ключ. Проверьте, что он введён верно."}
            return {"ok": False, "error": f"Ошибка Steam: HTTP {error.code}."}
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return {"ok": False, "error": "Нет связи со Steam. Проверьте интернет."}

        games = reply.get("games")
        if not games:
            return {"ok": False, "error": "Steam не вернул игры. Профиль и «Сведения об играх» "
                                          "должны быть публичными (Настройки приватности в Steam)."}

        incoming = [{"appid": g["appid"], "name": g.get("name") or f"App {g['appid']}",
                     "hours": round(g.get("playtime_forever", 0) / 60, 1),
                     "last_played": g.get("rtime_last_played", 0),
                     "recent": round(g.get("playtime_2weeks", 0) / 60, 1)} for g in games]
        data = _load_data()
        added, updated = _merge_games(data, incoming)
        _write_json(DATA_FILE, data)
        settings["steamid"] = steamid
        settings["last_sync"] = datetime.datetime.now().isoformat(timespec="seconds")
        _write_json(SETTINGS_FILE, settings)
        return {"ok": True, "data": data, "added": added, "updated": updated, "steamid": steamid,
                "last_sync": settings["last_sync"]}

    def steam_scan_local(self):
        """Установленные игры из файлов Steam (ключ не нужен)."""
        root = _steam_root()
        if not root:
            return {"ok": False, "error": "Steam не найден на этом компьютере."}

        libraries = {root / "steamapps"}
        vdf = root / "steamapps" / "libraryfolders.vdf"
        try:
            for path in re.findall(r'"path"\s*"([^"]+)"', vdf.read_text(encoding="utf-8", errors="ignore")):
                libraries.add(Path(path.replace("\\\\", "\\")) / "steamapps")
        except OSError:
            pass

        incoming = []
        for library in libraries:
            for manifest in library.glob("appmanifest_*.acf"):
                try:
                    text = manifest.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                appid = re.search(r'"appid"\s*"(\d+)"', text)
                name = re.search(r'"name"\s*"([^"]+)"', text)
                if not appid or not name or name.group(1).startswith(SKIP_APP_NAMES):
                    continue
                incoming.append({"appid": appid.group(1), "name": name.group(1), "installed": True})

        if not incoming:
            return {"ok": False, "error": "Установленных игр Steam не найдено."}
        data = _load_data()
        added, updated = _merge_games(data, incoming)
        _write_json(DATA_FILE, data)
        return {"ok": True, "data": data, "added": added, "updated": updated}

    def launch_steam(self, appid):
        if re.fullmatch(r"\d+", str(appid)):
            os.startfile(f"steam://run/{appid}")
            return True
        return False

    # ---- поддержка автора ----
    def author_support(self):
        """Ссылки для поддержки автора из support.json (в профиле пользователя файл важнее встроенного)."""
        data = {}
        for path in (DATA_DIR / "support.json", RESOURCES / "web" / "support.json"):
            loaded = _read_json(path, None)
            if isinstance(loaded, dict) and loaded.get("links"):
                data = loaded
                break
        links = [{"title": str(item["title"])[:40], "url": item["url"], "note": str(item.get("note", ""))[:140]}
                 for item in data.get("links", [])
                 if isinstance(item, dict) and item.get("title") and str(item.get("url", "")).startswith("https://")]
        return {"links": links}

    # ---- игры автора: скачать, играть, удалить (любая версия) ----
    def author_status(self):
        installed = {}
        for repo, rec in _author_games().items():
            versions = {tag: {"exists": Path(v["exe"]).exists(), "process": v["process"], "icon": v.get("icon", "")}
                        for tag, v in rec["versions"].items()}
            last = versions.get(rec["last"]) or next(iter(versions.values()), {})
            installed[repo] = {"last": rec["last"], "versions": versions, "process": last.get("process", ""), "icon": last.get("icon", "")}
        return {"installed": installed, "progress": {k: dict(v) for k, v in _author_progress.items()}}

    def author_install(self, repo, tag=None, mods_dir=None):
        cached = _read_json(AUTHOR_FILE, {})
        versions = next((r.get("versions") or [] for r in cached.get("repos", []) if r["name"] == repo), [])
        play = next((v for v in versions if v["tag"] == tag), None) if tag else (versions[0] if versions else None)
        if not play:
            return {"ok": False, "error": "Для этого проекта нет готовой сборки."}
        play = dict(play)
        if play["kind"] == "mod" and any(f["name"].lower().endswith(".jar") for f in play.get("files", [])):
            path = mods_dir or self.author_mods_info()["path"]
            if not path or not Path(path).is_absolute() or Path(path).name.lower() != "mods":
                return {"ok": False, "error": "Не выбрана папка mods. Укажите папку Minecraft или саму mods."}
            play["mods_dir"] = str(Path(path))
        key = f"{repo}@{play['tag']}"
        current = _author_progress.get(key)
        if current and current["state"] == "running":
            return {"ok": True}
        _author_progress[key] = {"state": "running", "percent": 0, "label": "Скачиваю", "error": "", "path": ""}
        threading.Thread(target=_author_worker, args=(repo, play), daemon=True).start()
        return {"ok": True}

    def author_mods_info(self):
        """Куда ставить моды: сохранённая папка или .minecraft/mods; найден ли Forge 1.20.1; что уже установлено."""
        minecraft = Path(os.environ.get("APPDATA", "")) / ".minecraft"
        saved = _read_json(SETTINGS_FILE, {}).get("author_mods_dir", "")
        path = saved or (str(minecraft / "mods") if minecraft.is_dir() else "")
        base = Path(path).parent if path else minecraft
        versions = base / "versions"
        forge = versions.is_dir() and any("forge" in p.name.lower() and "1.20.1" in p.name for p in versions.iterdir())
        return {"path": path, "forge": forge, "installed": _read_json(AUTHOR_MODS_FILE, {})}

    def author_set_mods_dir(self, folder):
        """Папка, выбранная пользователем: это либо сама mods, либо корень игры (.minecraft), где mods будет создана."""
        chosen = Path(folder or "")
        if not chosen.is_absolute() or not chosen.parent.exists():
            return ""
        target = chosen if chosen.name.lower() == "mods" else chosen / "mods"
        settings = _read_json(SETTINGS_FILE, {})
        settings["author_mods_dir"] = str(target)
        _write_json(SETTINGS_FILE, settings)
        return str(target)

    def author_uninstall_mod(self, repo):
        records = _read_json(AUTHOR_MODS_FILE, {})
        record = records.pop(repo, None)
        if record:
            for name in record["files"]:
                (Path(record["mods_dir"]) / Path(name).name).unlink(missing_ok=True)
            _write_json(AUTHOR_MODS_FILE, records)
        return True

    def author_launch(self, repo, tag=None):
        records = _author_games()
        rec = records.get(repo)
        tag = tag or (rec or {}).get("last")
        version = (rec or {}).get("versions", {}).get(tag)
        if not version or not Path(version["exe"]).exists():
            return False
        exe = Path(version["exe"])
        subprocess.Popen([str(exe)], cwd=str(exe.parent), creationflags=0x00000008 | 0x00000200, close_fds=True)
        rec["last"] = tag
        _write_json(AUTHOR_GAMES_FILE, records)
        return True

    def author_uninstall(self, repo, tag=None):
        records = _author_games()
        rec = records.get(repo)
        if rec:
            tags = [tag] if tag else list(rec["versions"])
            for item in tags:
                version = rec["versions"].pop(item, None)
                if version:
                    folder = Path(version["dir"]).resolve()
                    if AUTHOR_GAMES_DIR.resolve() in folder.parents:
                        shutil.rmtree(folder, ignore_errors=True)
                _author_progress.pop(f"{repo}@{item}", None)
            if rec["versions"]:
                if rec["last"] not in rec["versions"]:
                    rec["last"] = next(iter(rec["versions"]))
            else:
                records.pop(repo)
            _write_json(AUTHOR_GAMES_FILE, records)
        return True

    def reveal_download(self, repo, tag):
        path = Path(_author_progress.get(f"{repo}@{tag}", {}).get("path", ""))
        if path.exists() and path.parent == Path.home() / "Downloads":
            subprocess.Popen(["explorer", "/select,", str(path)])
            return True
        return False

    # ---- проекты автора (GitHub) ----
    def author_projects(self):
        """Публичные репозитории автора. Кэш на 6 часов; без сети отдаём прежний кэш."""
        cached = _read_json(AUTHOR_FILE, {})
        if cached.get("repos") and cached.get("schema") == AUTHOR_SCHEMA and all("versions" in r for r in cached["repos"]) and time.time() - cached.get("ts", 0) < 6 * 3600:
            return {"ok": True, **cached}
        try:
            request = urllib.request.Request(
                f"https://api.github.com/users/{AUTHOR_LOGIN}/repos?per_page=100&sort=updated",
                headers={"User-Agent": "GameProjectHub", "Accept": "application/vnd.github+json"})
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            return {"ok": bool(cached.get("repos")), **cached}
        repos = [{"name": r["name"], "desc": r.get("description") or "", "lang": r.get("language") or "",
                  "stars": r.get("stargazers_count", 0), "url": r["html_url"], "homepage": r.get("homepage") or "",
                  "updated": r.get("pushed_at") or r.get("updated_at") or "", "versions": _list_versions(r["name"])}
                 for r in raw if not r.get("fork") and not r.get("archived")]
        result = {"repos": repos, "ts": time.time(), "schema": AUTHOR_SCHEMA}
        _write_json(AUTHOR_FILE, result)
        return {"ok": True, **result}

    # ---- настройки ----
    def set_prefs(self, prefs):
        clean = {}
        for key, default in DEFAULT_PREFS.items():
            value = prefs.get(key, default)
            if isinstance(default, bool):
                clean[key] = bool(value)
            else:
                try:
                    clean[key] = max(0, min(100, float(value)))
                except (TypeError, ValueError):
                    clean[key] = default
        settings = _read_json(SETTINGS_FILE, {})
        settings["prefs"] = clean
        _write_json(SETTINGS_FILE, settings)
        return clean

    def test_notify(self):
        return _notify("Game & Project Hub", "Уведомления работают.")

    # ---- метаданные игр ----
    def get_meta(self):
        with _meta_lock:
            meta = _read_json(META_FILE, {})
        return {"rev": _meta_rev, "meta": meta, "pending": len(_meta_todo())}

    def meta_rev(self):
        return _meta_rev

    # ---- вишлист ----
    def get_wishlist(self):
        with _wish_lock:
            return _read_json(WISH_FILE, {"items": [], "ts": 0})

    def refresh_wishlist(self):
        settings = _read_json(SETTINGS_FILE, {})
        steamid = settings.get("steamid", "")
        if not re.fullmatch(r"\d{17}", steamid or ""):
            return {"ok": False, "error": "Нужен ID профиля: откройте «Steam» и сделайте импорт."}
        params = {"steamid": steamid}
        if settings.get("key"):
            params["key"] = settings["key"]
        try:
            reply = _http_json("IWishlistService/GetWishlist/v1/", params).get("response", {})
        except urllib.error.HTTPError as error:
            return {"ok": False, "error": "Steam не отдал вишлист: возможно, профиль или вишлист закрыты."
                    if error.code in (401, 403) else f"Ошибка Steam: HTTP {error.code}."}
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return {"ok": False, "error": "Нет связи со Steam. Проверьте интернет."}
        raw = reply.get("items", [])

        with _wish_lock:
            old = {str(i["appid"]): i for i in _read_json(WISH_FILE, {}).get("items", [])}
        items = [{"appid": str(i["appid"]), "added": i.get("date_added", 0), "priority": i.get("priority", 0),
                  "alerted": old.get(str(i["appid"]), {}).get("alerted", 0),
                  "price": old.get(str(i["appid"]), {}).get("price")} for i in raw]

        ids = [i["appid"] for i in items]
        prices = {}
        try:
            for start in range(0, len(ids), 40):
                chunk = ids[start:start + 40]
                data = _store_json({"appids": ",".join(chunk), "filters": "price_overview", "cc": "ru"})
                for appid in chunk:
                    overview = (data.get(appid, {}).get("data") or {})
                    overview = overview.get("price_overview") if isinstance(overview, dict) else None
                    prices[appid] = {
                        "final": overview["final"], "initial": overview["initial"], "discount": overview["discount_percent"],
                        "final_text": overview["final_formatted"], "initial_text": overview["initial_formatted"],
                    } if overview else None
                time.sleep(1.2)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, OSError):
            pass  # цены обновим в следующий раз, список всё равно сохраняем
        for item in items:
            if item["appid"] in prices:
                item["price"] = prices[item["appid"]]

        deals = []
        threshold = float(_prefs()["discount_alert"] or 0)
        meta = _read_json(META_FILE, {})
        for item in items:
            discount = (item["price"] or {}).get("discount", 0)
            if threshold > 0 and discount >= threshold and item["alerted"] < discount:
                item["alerted"] = discount
                deals.append((discount, meta.get(item["appid"], {}).get("name") or f"игра #{item['appid']}"))
            elif discount < threshold:
                item["alerted"] = 0  # скидка закончилась: снова сообщим при следующей
        result = {"items": items, "ts": time.time()}
        with _wish_lock:
            _write_json(WISH_FILE, result)
        if deals and _prefs()["notify"]:
            deals.sort(reverse=True)
            _notify("Скидки из вишлиста", "; ".join(f"{name} −{d}%" for d, name in deals[:3]))
        return {"ok": True, **result, "deals": [{"name": n, "discount": d} for d, n in deals]}

    # ---- достижения Steam ----
    def steam_achievements(self, appid):
        appid = str(appid)
        if not re.fullmatch(r"\d+", appid):
            return {"ok": False, "error": "Некорректная игра."}
        cached = _ach_cache.get(appid)
        if cached and time.time() - cached[0] < 600:
            return cached[1]
        settings = _read_json(SETTINGS_FILE, {})
        key, steamid = settings.get("key"), settings.get("steamid", "") or self.detect_steam_user()
        if not re.fullmatch(r"\d{17}", steamid or ""):
            return {"ok": False, "error": "Не удалось определить ваш профиль Steam: откройте «Steam» и укажите ID."}
        no_stats = "У этой игры нет достижений или в Steam закрыты сведения об играх."
        if not key:  # ключ не нужен: открытый профиль читается напрямую
            try:
                items = _community_achievements(steamid, appid)
                try:
                    percents = {a["name"].lower(): float(a["percent"]) for a in _http_json(
                        "ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/", {"gameid": appid}
                    ).get("achievementpercentages", {}).get("achievements", [])}
                except (urllib.error.URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError):
                    percents = {}
            except (urllib.error.URLError, TimeoutError):
                return {"ok": False, "error": "Нет связи со Steam. Проверьте интернет."}
            if not items:
                return {"ok": False, "error": no_stats}
            for item in items:
                item["percent"] = round(percents.get(item["id"].lower(), -1), 1)
            result = {"ok": True, "items": items, "unlocked": sum(i["achieved"] for i in items), "total": len(items)}
            _ach_cache[appid] = (time.time(), result)
            return result
        try:
            player = _http_json("ISteamUserStats/GetPlayerAchievements/v1/",
                                {"key": key, "steamid": steamid, "appid": appid, "l": "russian"}).get("playerstats", {})
            if not player.get("success") or not player.get("achievements"):
                return {"ok": False, "error": no_stats}
            schema = _http_json("ISteamUserStats/GetSchemaForGame/v2/", {"key": key, "appid": appid, "l": "russian"}
                                ).get("game", {}).get("availableGameStats", {}).get("achievements", [])
            try:
                percents = {a["name"]: float(a["percent"]) for a in _http_json(
                    "ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/", {"gameid": appid}
                ).get("achievementpercentages", {}).get("achievements", [])}
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError):
                percents = {}
        except urllib.error.HTTPError as error:
            if error.code in (400, 403):
                return {"ok": False, "error": no_stats}
            return {"ok": False, "error": f"Ошибка Steam: HTTP {error.code}."}
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return {"ok": False, "error": "Нет связи со Steam. Проверьте интернет."}

        meta = {a["name"]: a for a in schema}
        items = []
        for a in player["achievements"]:
            info = meta.get(a["apiname"], {})
            items.append({
                "id": a["apiname"], "name": a.get("name") or info.get("displayName") or a["apiname"],
                "desc": a.get("description") or info.get("description", ""), "achieved": bool(a.get("achieved")),
                "time": a.get("unlocktime", 0), "icon": info.get("icon", ""), "icon_gray": info.get("icongray", ""),
                "percent": round(percents.get(a["apiname"], -1), 1), "hidden": bool(info.get("hidden")),
            })
        result = {"ok": True, "items": items, "unlocked": sum(i["achieved"] for i in items), "total": len(items)}
        _ach_cache[appid] = (time.time(), result)
        return result

    # ---- автоматический скилл ----
    def skill_fetch(self, kind, arg):
        """Значения для трекера скилла без ручного ввода и без ключей: профиль osu! и достижения Steam."""
        if kind == "osu":
            name = (arg or "").strip()
            if not name:
                return {"ok": False, "error": "Укажите ник в osu!."}
            try:
                request = urllib.request.Request(f"https://osu.ppy.sh/users/{urllib.parse.quote(name)}/osu",
                                                 headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(request, timeout=25) as response:
                    page = response.read().decode("utf-8", "ignore")
                found = re.search(r'data-initial-data="([^"]+)"', page)
                stats = json.loads(html.unescape(found.group(1))).get("user", {}).get("statistics", {}) if found else {}
            except urllib.error.HTTPError as error:
                return {"ok": False, "error": "Игрок не найден: проверьте ник." if error.code == 404 else f"osu!: HTTP {error.code}."}
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                return {"ok": False, "error": "Нет связи с osu!. Проверьте интернет."}
            values = {}
            if stats.get("pp"):
                values["PP"] = round(float(stats["pp"]), 2)
            if stats.get("global_rank"):
                values["Глобальный ранг"] = int(stats["global_rank"])
            if stats.get("hit_accuracy"):
                values["Точность, %"] = round(float(stats["hit_accuracy"]), 2)
            if not values:
                return {"ok": False, "error": "У игрока пока нет статистики (мало сыгранных карт)."}
            return {"ok": True, "values": values}
        if kind == "steam_ach":
            result = self.steam_achievements(arg)
            if not result["ok"]:
                return {"ok": False, "error": result["error"]}
            items = result["items"]
            done = sum(1 for i in items if i["achieved"])
            rare = sum(1 for i in items if i["achieved"] and 0 <= i["percent"] < 10)
            return {"ok": True, "values": {"Достижения, %": round(done / len(items) * 100, 1), "Редкие достижения": rare}}
        return {"ok": False, "error": "Неизвестный источник."}

    # ---- проекты: анализ папки, git, редактор, терминал ----
    def project_scan(self, path):
        folder = Path(path or "")
        if not path or not folder.is_dir():
            return {"ok": False}
        counts, newest, total = {}, 0.0, 0
        markers = []
        for root, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if d not in SCAN_IGNORE]
            for name in files:
                total += 1
                if total > 6000:
                    break
                ext = Path(name).suffix.lower()
                if ext in EXT_LANG:
                    counts[EXT_LANG[ext]] = counts.get(EXT_LANG[ext], 0) + 1
                if ext == ".uproject":
                    markers.append("Unreal")
                try:
                    newest = max(newest, (Path(root) / name).stat().st_mtime)
                except OSError:
                    pass
            if total > 6000:
                break
        for marker, label in TECH_MARKERS:
            if (folder / marker).exists():
                markers.append(label)
        if (folder / "Assets").is_dir() and (folder / "ProjectSettings").is_dir():
            markers.append("Unity")
        top_langs = [lang for lang, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:3]]
        tech = list(dict.fromkeys(markers + top_langs))[:6]

        description = ""
        for readme in ("README.md", "readme.md", "README.txt", "README"):
            try:
                text = (folder / readme).read_text(encoding="utf-8", errors="ignore")[:4000]
            except OSError:
                continue
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            plain = [ln for ln in lines if not ln.startswith(("#", "[", "!", "<", "=", "-", "*", "`"))]
            description = ((plain or [ln.lstrip("# ") for ln in lines] or [""])[0])[:200]
            break

        info = {"ok": True, "name": folder.name, "tech": tech, "description": description, "files": min(total, 6000),
                "modified": datetime.datetime.fromtimestamp(newest).isoformat(timespec="seconds") if newest else "",
                "git": None}
        if shutil.which("git") and _git(folder, "rev-parse", "--is-inside-work-tree") == "true":
            last = _git(folder, "log", "-1", "--format=%s%x1f%ct").split("\x1f")
            remote = _git(folder, "remote", "get-url", "origin")
            remote = re.sub(r"^git@([^:]+):", r"https://\1/", remote)
            remote = re.sub(r"\.git$", "", remote)
            info["git"] = {
                "branch": _git(folder, "rev-parse", "--abbrev-ref", "HEAD"),
                "dirty": len([ln for ln in _git(folder, "status", "--porcelain").splitlines() if ln.strip()]),
                "commits": int(_git(folder, "rev-list", "--count", "HEAD") or 0),
                "last_message": last[0] if last else "",
                "last_time": int(last[1]) if len(last) > 1 and last[1].isdigit() else 0,
                "remote": remote if remote.startswith("http") else "",
            }
        return info

    def open_in_code(self, path):
        code = shutil.which("code")
        if code and Path(path or "").is_dir():
            subprocess.Popen([code, str(path)], creationflags=NOWIN_FLAG)
            return True
        return False

    def open_terminal(self, path):
        if not Path(path or "").is_dir():
            return False
        if shutil.which("wt"):
            subprocess.Popen(["wt", "-d", str(path)], creationflags=NOWIN_FLAG)
        else:
            subprocess.Popen(["cmd", "/k"], cwd=str(path), creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0))
        return True

    # ---- резервная копия ----
    def export_backup(self):
        window = webview.windows[0]
        name = f"hub-backup-{datetime.date.today().isoformat()}.zip"
        picked = window.create_file_dialog(webview.FileDialog.SAVE, save_filename=name,
                                           file_types=("Архив ZIP (*.zip)",))
        path = picked if isinstance(picked, str) else (picked[0] if picked else "")
        if not path:
            return {"ok": False, "cancelled": True}
        path = path if path.lower().endswith(".zip") else path + ".zip"
        with _track_lock, zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for file in (DATA_FILE, TRACK_FILE):  # Steam-ключ (settings.json) в копию не кладём
                if file.exists():
                    archive.write(file, file.name)
        return {"ok": True, "path": path}

    def import_backup(self):
        window = webview.windows[0]
        picked = window.create_file_dialog(webview.FileDialog.OPEN, file_types=("Архив ZIP (*.zip)",))
        if not picked:
            return {"ok": False, "cancelled": True}
        try:
            with zipfile.ZipFile(picked[0]) as archive:
                data = json.loads(archive.read("data.json").decode("utf-8"))
                names = archive.namelist()
                tracking = json.loads(archive.read("tracking.json").decode("utf-8")) if "tracking.json" in names else None
            if not isinstance(data.get("games"), list) or not isinstance(data.get("projects", []), list):
                raise ValueError("bad structure")
        except (OSError, KeyError, ValueError, zipfile.BadZipFile):
            return {"ok": False, "error": "Это не резервная копия Game & Project Hub."}
        for file in (DATA_FILE, TRACK_FILE):  # страховка: прежние данные остаются рядом с суффиксом .bak
            if file.exists():
                shutil.copy2(file, file.with_suffix(file.suffix + ".bak"))
        data.setdefault("projects", [])
        _write_json(DATA_FILE, data)
        if tracking is not None:
            with _track_lock:
                _write_json(TRACK_FILE, tracking)
        return {"ok": True, "data": _load_data()}

    # ---- авто-учёт времени ----
    def get_tracking(self):
        with _track_lock:
            tracking = _read_json(TRACK_FILE, {})
        return {"tracking": tracking, "running": sorted(_running_ids)}

    # ---- особые игры (не Steam) ----
    def get_catalog(self):
        epic_names = {item["name"].lower() for item in _epic_items()}
        icons = _catalog_icons()
        result = []
        for entry in CATALOG:
            found = any(Path(os.path.expandvars(p)).exists() for p in entry["detect"])
            found = found or entry["name"].lower() in epic_names
            result.append({**{k: v for k, v in entry.items() if k != "detect"}, "installed": found,
                           "icon": icons.get(entry["key"], "")})
        return result

    def epic_import(self):
        items = _epic_items()
        if not items:
            return {"ok": False, "error": "Игры Epic Games не найдены (лаунчер не установлен или пуст)."}
        data = _load_data()
        known = {g.get("name", "").lower() for g in data["games"]}
        added = 0
        for item in items:
            if item["name"].lower() in known:
                continue
            data["games"].append({
                "id": _new_id(), "name": item["name"], "genre": "Epic Games", "status": "В библиотеке",
                "hours": 0, "rating": 0, "notes": "", "source": "epic", "installed": True,
                "process": item["process"],
            })
            added += 1
        _write_json(DATA_FILE, data)
        return {"ok": True, "data": data, "added": added}

    def minecraft_info(self, edition):
        """Миры Minecraft и (для Java) время игры из их статистики."""
        worlds = []
        if edition == "bedrock":
            root = (Path(os.environ.get("LOCALAPPDATA", "")) / "Packages" / "Microsoft.MinecraftUWP_8wekyb3d8bbwe"
                    / "LocalState" / "games" / "com.mojang" / "minecraftWorlds")
        else:
            root = Path(os.environ.get("APPDATA", "")) / ".minecraft" / "saves"
        if not root.is_dir():
            return {"found": False, "worlds": [], "total_hours": 0}

        total_ticks = 0
        for folder in root.iterdir():
            if not folder.is_dir():
                continue
            try:
                name = folder.name
                level_dat = folder / "level.dat"
                stamp = (level_dat if level_dat.exists() else folder).stat().st_mtime
                hours = None
                if edition == "bedrock":
                    name_file = folder / "levelname.txt"
                    if name_file.exists():
                        name = name_file.read_text(encoding="utf-8", errors="ignore").strip() or name
                else:
                    ticks = 0
                    for stats_file in (folder / "stats").glob("*.json"):
                        stats = json.loads(stats_file.read_text(encoding="utf-8"))
                        custom = stats.get("stats", {}).get("minecraft:custom", {})
                        ticks += custom.get("minecraft:play_time", custom.get("minecraft:play_one_minute", 0))
                        ticks += stats.get("stat.playOneMinute", 0)  # формат до 1.12
                    total_ticks += ticks
                    hours = round(ticks / 20 / 3600, 1)
                worlds.append({
                    "name": name,
                    "last": datetime.datetime.fromtimestamp(stamp).strftime("%Y-%m-%d %H:%M"),
                    "hours": hours, "_stamp": stamp,
                })
            except (OSError, ValueError):
                continue
        worlds.sort(key=lambda w: w["_stamp"], reverse=True)
        for world in worlds:
            del world["_stamp"]
        return {"found": True, "worlds": worlds, "total_hours": round(total_ticks / 20 / 3600, 1)}


_instance_mutex = None


def _already_running():
    """Вторая копия удвоила бы авто-учёт времени, поэтому запускаем только одну."""
    global _instance_mutex
    import ctypes

    # по одному окну на папку данных: версия из исходников и установленная (у них разные данные) не мешают друг другу
    suffix = hashlib.md5(str(DATA_DIR).lower().encode("utf-8")).hexdigest()[:12]
    _instance_mutex = ctypes.windll.kernel32.CreateMutexW(None, False, f"GameProjectHub.SingleInstance.{suffix}")
    return ctypes.windll.kernel32.GetLastError() == 183  # ERROR_ALREADY_EXISTS


def main():
    if _already_running():
        return
    threading.Thread(target=_tracker_loop, daemon=True).start()
    threading.Thread(target=_meta_loop, daemon=True).start()
    webview.create_window(
        "Game & Project Hub",
        url=str(RESOURCES / "web" / "index.html"),
        js_api=Api(),
        width=1320,
        height=820,
        min_size=(1040, 660),
        background_color="#0c0c0e",
        minimized="--minimized" in sys.argv,  # автозапуск с Windows: свёрнуто на панель задач
    )
    webview.start()


if __name__ == "__main__":
    main()
