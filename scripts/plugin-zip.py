"""Воспроизводимый ZIP без локальных времён, путей пользователя и скрытого состояния."""
import pathlib, sys, zipfile

root = pathlib.Path(sys.argv[1]).resolve()
target = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("Symlinks are not allowed in plugin packages")
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        if any(p in {".git", "node_modules", "state", ".env"} for p in path.relative_to(root).parts) or path.suffix in {".pem", ".key", ".log"}:
            raise ValueError("Private or unnecessary file in plugin package")
        info = zipfile.ZipInfo(relative, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
