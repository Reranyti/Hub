"""Сборка: приложение (.exe) -> архив -> установщик (Setup.exe).

Запуск:  python build.py
Результат: dist\\GameProjectHub-Setup.exe (отдаёте друзьям) и dist\\GameProjectHub\\GameProjectHub.exe (без установки).
Нужно один раз:  python -m pip install pyinstaller pillow pywebview psutil
"""
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST, WORK = ROOT / "dist", ROOT / "build"
ICON = ROOT / "assets" / "icon.ico"
SEP = ";"  # разделитель путей для --add-data в Windows


def run(*args):
    print(">", " ".join(map(str, args)))
    subprocess.run([sys.executable, "-m", *map(str, args)], check=True, cwd=ROOT)


def pyinstaller(*args):
    run("PyInstaller", "--noconfirm", "--clean", "--distpath", DIST, "--workpath", WORK / "pyi",
        "--specpath", WORK, *args)


def main():
    shutil.rmtree(DIST, ignore_errors=True)
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)

    subprocess.run([sys.executable, ROOT / "assets" / "make_icon.py"], check=True)

    print("\n[1/3] Приложение")
    pyinstaller("--windowed", "--name", "GameProjectHub", "--icon", ICON,
                "--add-data", f"{ROOT / 'web'}{SEP}web", "--paths", ROOT,
                "--exclude-module", "tkinter", "--exclude-module", "customtkinter", ROOT / "app.py")

    print("\n[2/3] Архив с приложением")
    payload = WORK / "payload.zip"
    app_dir = DIST / "GameProjectHub"
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(app_dir.rglob("*")):
            if file.is_file():
                archive.write(file, file.relative_to(app_dir).as_posix())
    print(f"  {payload.stat().st_size / 1048576:.1f} МБ")

    print("\n[3/3] Установщик")
    pyinstaller("--windowed", "--onefile", "--name", "GameProjectHub-Setup", "--icon", ICON,
                "--add-data", f"{ROOT / 'installer_web'}{SEP}installer_web",
                "--add-data", f"{payload}{SEP}.", "--paths", ROOT,
                "--exclude-module", "tkinter", "--exclude-module", "customtkinter", "--exclude-module", "psutil",
                ROOT / "installer.py")

    setup = DIST / "GameProjectHub-Setup.exe"
    print(f"\nГотово: {setup} ({setup.stat().st_size / 1048576:.1f} МБ)")

    exclusive = ROOT / "exclusive"
    if exclusive.is_dir() and any(exclusive.rglob("*.*")):
        build_full(payload, exclusive)
    else:
        print("\nПапки exclusive нет: полный установщик не собирается.")


# ---------- Полная версия: эксклюзивные версии зашиты в установщик ----------
COMPONENT_INFO = {
    ("Lotos-Outer", False): ("Lotos-Outer {tag} (эксклюзив)", "Мод и обязательные зависимости"),
    ("Lotos-Outer", True): ("Сборка разработчика (Эксклюзивно)", "Полная тестовая сборка: моды, конфиги, шейдеры, install.bat"),
    ("DeltaKind", False): ("DeltaKind (эксклюзив)", "Новейшая сборка из рабочей копии"),
}


def build_full(payload, exclusive):
    """GameProjectHub-Setup-Full.exe: обычный установщик + exclusive.zip + components.json (с SHA-256 каждого файла)."""
    print("\n[4/4] Полный установщик (с эксклюзивными версиями)")
    components, archive_path = [], WORK / "exclusive.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_STORED) as archive:  # файлы уже сжаты (jar, zip), повторно не жмём
        for repo in sorted(p for p in exclusive.iterdir() if p.is_dir()):
            for version in sorted(p for p in repo.iterdir() if p.is_dir()):
                files = {}
                for file in sorted(f for f in version.rglob("*") if f.is_file()):
                    member = f"{repo.name}/{version.name}/{file.relative_to(version).as_posix()}"
                    archive.write(file, member)
                    files[member] = hashlib.sha256(file.read_bytes()).hexdigest()
                if not files:
                    continue
                special = version.name.lower().endswith(("-full", "-dev"))
                title, desc = COMPONENT_INFO.get((repo.name, special), (f"{repo.name} {version.name}", "Эксклюзивная версия"))
                components.append({"id": f"{repo.name}/{version.name}", "name": title.format(tag=version.name.lstrip("v")), "desc": desc,
                                   "size_mb": max(1, round(sum(f.stat().st_size for f in version.rglob("*") if f.is_file()) / 1048576)),
                                   "files": files})
    manifest = WORK / "components.json"
    manifest.write_text(json.dumps({"components": components}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("  компоненты:", ", ".join(c["id"] for c in components), f"| {archive_path.stat().st_size / 1048576:.0f} МБ")
    pyinstaller("--windowed", "--onefile", "--name", "GameProjectHub-Setup-Full", "--icon", ICON,
                "--add-data", f"{ROOT / 'installer_web'}{SEP}installer_web",
                "--add-data", f"{payload}{SEP}.", "--add-data", f"{archive_path}{SEP}.", "--add-data", f"{manifest}{SEP}.",
                "--paths", ROOT, "--exclude-module", "tkinter", "--exclude-module", "customtkinter", "--exclude-module", "psutil",
                ROOT / "installer.py")
    full = DIST / "GameProjectHub-Setup-Full.exe"
    print(f"Готово: {full} ({full.stat().st_size / 1048576:.1f} МБ). Раздавать только лично: внутри эксклюзив.")


if __name__ == "__main__":
    main()
