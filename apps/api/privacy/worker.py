"""Локальный сканер. stdout — только JSON, исходники и исключения не печатаются."""
import json
import os
import sys

import torch
from gliner import GLiNER

torch.set_num_threads(2)
model = GLiNER.from_pretrained(
    os.environ.get("CHAT0110_PRIVACY_MODEL", "/var/lib/chat0110/privacy-model"),
    local_files_only=True,
)
model.eval()
labels = ["person", "full name", "street address", "postal address", "имя человека", "фамилия", "почтовый адрес"]
people = {"person", "full name", "имя человека", "фамилия"}
print(json.dumps({"ready": True}), flush=True)

def scan(text):
    spans = []
    chunks = []
    # Проверяем настоящий размер токенизации, а не предполагаем, что число
    # символов помещается в окно. Иначе код/emoji оставляют непрочитанные хвосты.
    start = 0
    while start < len(text):
        end = min(len(text), start + 1200)
        while len(model.data_processor.transformer_tokenizer(text[start:end], add_special_tokens=False)["input_ids"]) > 240:
            end = start + max(1, (end - start) * 2 // 3)
        chunk = text[start:end]
        chunks.append((start, chunk))
        if end == len(text):
            break
        start = max(start + 1, end - min(180, (end - start) // 3))
    torch.set_num_threads(4 if len(chunks) > 4 else 2)
    predictions = model.inference([chunk for start, chunk in chunks], labels, threshold=0.55, batch_size=4)
    if len(predictions) != len(chunks):
        raise RuntimeError("Incomplete scan")
    for (start, chunk), entities in zip(chunks, predictions):
        for entity in entities:
            a, b = start + entity["start"], start + entity["end"]
            a16 = len(text[:a].encode("utf-16-le")) // 2
            b16 = len(text[:b].encode("utf-16-le")) // 2
            spans.append({"start": a16, "end": b16, "category": "PERSON" if entity["label"] in people else "ADDRESS"})
    return spans

for line in sys.stdin:
    try:
        print(json.dumps({"spans": scan(json.loads(line)["text"])}), flush=True)
    except Exception:
        print(json.dumps({"error": "scanner unavailable"}), flush=True)
    finally:
        # Между запросами не удерживаем исходную строку в глобальном цикле.
        line = None
