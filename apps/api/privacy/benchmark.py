"""Только искусственные примеры; отчёт не содержит исходников и заменяемых значений."""
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import time

cases = [
    ("ru", "Позвони Ивану Петрову, он живёт по адресу: Москва, улица Ленина, дом 12, квартира 5.", ["Ивану Петрову", "Ленина", "12", "5"]),
    ("en", "Contact John Smith at 123 Main Street, London SW1A 1AA.", ["John Smith", "123 Main Street", "SW1A 1AA"]),
    ("unicode", "👋 John Smith lives at 42 Baker Street, London.", ["John Smith", "42 Baker Street"]),
]
if "--long" in sys.argv:
    long_text = (("A synthetic example without private details. " * 100) + "Contact John Smith at 123 Main Street, London SW1A 1AA.\n") * 14
    cases.append(("long-59000", long_text[:59000], ["John Smith", "123 Main Street", "SW1A 1AA"]))
env = dict(os.environ, HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", PYTHONDONTWRITEBYTECODE="1", TOKENIZERS_PARALLELISM="false")
started = time.monotonic()
worker = subprocess.Popen([sys.executable, str(Path(__file__).with_name("worker.py"))], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env)
try:
    assert json.loads(worker.stdout.readline()).get("ready") is True
    cold_ms = round((time.monotonic() - started) * 1000)
    measured = []
    for label, text, expected in cases:
        before = time.monotonic()
        worker.stdin.write(json.dumps({"text": text}) + "\n")
        worker.stdin.flush()
        result = json.loads(worker.stdout.readline())
        spans = result["spans"]
        chars = text.encode("utf-16-le")
        for span in sorted(spans, key=lambda s: s["start"], reverse=True):
            # Маркируем диапазоны, не печатая сами значения в отчёт.
            a, b = span["start"] * 2, span["end"] * 2
            chars = chars[:a] + ("*" * ((b - a) // 2)).encode("utf-16-le") + chars[b:]
        safe = chars.decode("utf-16-le")
        assert all(value not in safe for value in expected), "Неполная очистка тестового примера: " + label
        measured.append({"case": label, "ms": round((time.monotonic() - before) * 1000), "entities": len(spans)})
    print(json.dumps({"ok": True, "startup_ms": cold_ms, "cases": measured}))
finally:
    worker.terminate()
    worker.wait(timeout=10)
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    print(json.dumps({"max_rss_mib": round(rss / (1024 if sys.platform != "darwin" else 1024 * 1024))}))
