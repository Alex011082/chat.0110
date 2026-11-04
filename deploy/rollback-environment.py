#!/usr/bin/env python3
"""Fail-closed для нестандартного runtime: нельзя проверять постороннюю очередь."""
import pathlib
import shlex
import subprocess
import sys

try:
    file = pathlib.Path(sys.argv[1])
    def setting(name):
        return subprocess.run(["systemctl", "show", "chat0110", "--property=" + name, "--value"], check=True, capture_output=True, text=True).stdout.strip()
    if setting("EnvironmentFiles") != str(file) + " (ignore_errors=no)" or setting("PassEnvironment"):
        raise ValueError("Нестандартное окружение")
    direct = shlex.split(setting("Environment"))
    if any(value.startswith("CHAT0110_DISPATCH_DB=") for value in direct):
        raise ValueError("Путь очереди переопределён")
    if "CHAT0110_PUBLIC_URL=https://chat.0110.digital" not in direct:
        raise ValueError("Режим runtime не подтверждён")
    # Не интерпретируем произвольный systemd env: такой override требует отдельной сверки.
    content = file.read_text()
    if "CHAT0110_DISPATCH_DB" in content or "CHAT0110_PUBLIC_URL" in content:
        raise ValueError("Путь/режим runtime переопределён")
except (OSError, ValueError, IndexError, subprocess.SubprocessError):
    print("Рабочий путь очереди не подтверждён: откат запрещён, сервис остаётся остановленным", file=sys.stderr)
    sys.exit(3)
