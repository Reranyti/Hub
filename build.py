"""Сборка: приложение (.exe) -> архив -> установщик (Setup.exe).

Запуск:  python build.py
Результат: dist\\GameProjectHub-Setup.exe (отдаёте друзьям) и dist\\GameProjectHub\\GameProjectHub.exe (без установки).
Нужно один раз:  python -m pip install pyinstaller pillow pywebview psutil
"""
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


if __name__ == "__main__":
    main()
