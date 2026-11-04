"""Версионированная команда установки должна переживать следующий выпуск сайта."""
import hashlib
import pathlib
import re
import shutil
import sys

source, target = map(pathlib.Path, sys.argv[1:3])
pattern = re.compile(r"chat0110-(?:mcp|codex|claude-code)-\d+\.\d+\.\d+\.(?:tgz|zip)(?:\.sha256)?")
if source.is_dir():
    target.mkdir(parents=True, exist_ok=True)
    files = [p for p in source.iterdir() if pattern.fullmatch(p.name)]
    # Сначала проверяем весь набор: ни одна старая версия не перезаписывается.
    for path in files:
        dest = target / path.name
        if path.is_symlink() or not path.is_file() or dest.is_symlink():
            raise ValueError("Недопустимый файл архива установки")
        if dest.exists() and hashlib.sha256(dest.read_bytes()).digest() != hashlib.sha256(path.read_bytes()).digest():
            raise ValueError("Изменился опубликованный архив: " + path.name + ". Подними версию пакета.")
    for path in files:
        dest = target / path.name
        if not dest.exists():
            shutil.copyfile(path, dest)
