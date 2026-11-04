#!/usr/bin/env python3
"""Детерминированная упаковка и проверка полного состава rollback bundle."""
import gzip
import hashlib
import json
import pathlib
import sys
import tarfile

mode, source, target = sys.argv[1:]
source, target = pathlib.Path(source), pathlib.Path(target)
if mode == "pack":
    with target.open("wb") as stream, gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as zipped, tarfile.open(fileobj=zipped, mode="w") as archive:
        for path in sorted(source.rglob("*")):
            if not path.is_file() or path.is_symlink():
                if path.is_symlink():
                    raise ValueError("Ссылки в bundle запрещены")
                continue
            info = archive.gettarinfo(str(path), str(path.relative_to(source)))
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ""
            info.mode = 0o644
            with path.open("rb") as contents:
                archive.addfile(info, contents)
elif mode == "extract":
    with tarfile.open(source, "r:gz") as archive:
        members = archive.getmembers()
        names = [m.name for m in members]
        if len(names) != len(set(names)) or len(names) > 10000:
            raise ValueError("Неверный состав bundle")
        if any(not m.isfile() or pathlib.PurePosixPath(m.name).is_absolute() or ".." in pathlib.PurePosixPath(m.name).parts for m in members):
            raise ValueError("Небезопасный путь bundle")
        if sum(m.size for m in members) > 64 * 1024 * 1024:
            raise ValueError("Слишком большой bundle")
        manifest = json.load(archive.extractfile("rollback-manifest.json"))
        files = manifest["files"]
        if set(names) != set(files) | {"rollback-manifest.json"}:
            raise ValueError("Неполный manifest bundle")
        for name, digest in files.items():
            if hashlib.sha256(archive.extractfile(name).read()).hexdigest() != digest:
                raise ValueError("Повреждённый файл bundle")
        target.mkdir(parents=True, exist_ok=True)
        archive.extractall(target, filter="data")
else:
    raise ValueError("Неизвестная операция")
