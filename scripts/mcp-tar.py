"""Пакет npx воспроизводим: никаких времён сборки или локальных путей."""
import gzip
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1])
with open(sys.argv[2], "wb") as target:
    with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0) as gz:
        with tarfile.open(mode="w", fileobj=gz, format=tarfile.PAX_FORMAT) as archive:
            for path in sorted((root / "package").iterdir()):
                if not path.is_file() or path.is_symlink():
                    raise ValueError("Only package files are allowed")
                info = tarfile.TarInfo("package/" + path.name)
                info.size = path.stat().st_size
                info.mode = 0o755 if path.suffix == ".mjs" else 0o644
                info.mtime = 0
                with path.open("rb") as source:
                    archive.addfile(info, source)
