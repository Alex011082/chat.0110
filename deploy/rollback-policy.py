#!/usr/bin/env python3
"""Старый API допустим только до появления нового состояния доступа/публикаций."""
import pathlib
import sqlite3
import sys

try:
    path = pathlib.Path(sys.argv[1]).resolve(strict=True)
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("Не подтверждена целостность очереди")
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {
            "sessions": {"id", "uid", "repo", "chat", "external", "alias", "author"},
            "chains": {"id", "uid", "repo", "chat", "route", "step", "status"},
            "tasks": {"id", "chain_id", "session_id", "step", "status", "claim", "answer_id"},
            "agent_pulls": {"session_id", "request_id", "task_id"},
        }
        for table, columns in required.items():
            if table not in tables or not columns.issubset({r[1] for r in db.execute(f"PRAGMA table_info({table})")}):
                raise ValueError("Не подтверждена схема очереди")
        for table in ("channel_bindings", "channel_publications"):
            if table in tables and db.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                print("Нужен проверенный совместимый API; иначе доставка остаётся закрытой", file=sys.stderr)
                sys.exit(2)
except (OSError, sqlite3.Error, IndexError, ValueError):
    print("Состояние очереди не подтверждено; небезопасный откат запрещён", file=sys.stderr)
    sys.exit(3)
