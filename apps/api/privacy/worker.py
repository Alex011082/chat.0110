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

for line in sys.stdin:
    try:
        text = json.loads(line)["text"]
        spans = []
        # Проверяем настоящий размер токенизации, а не предполагаем, что число
        # символов помещается в окно. Иначе код/emoji оставляют непрочитанные хвосты.
        start = 0
        while start < len(text):
            end = min(len(text), start + 1200)
            while len(model.data_processor.transformer_tokenizer(text[start:end], add_special_tokens=False)["input_ids"]) > 240:
                end = start + max(1, (end - start) * 2 // 3)
            chunk = text[start:end]
            for entity in model.predict_entities(chunk, labels, threshold=0.55):
                a, b = start + entity["start"], start + entity["end"]
                # JS использует UTF-16: emoji перед сущностью не сдвигает замену.
                a16 = len(text[:a].encode("utf-16-le")) // 2
                b16 = len(text[:b].encode("utf-16-le")) // 2
                spans.append({"start": a16, "end": b16, "category": "PERSON" if entity["label"] in people else "ADDRESS"})
            if end == len(text):
                break
            start = max(start + 1, end - min(180, (end - start) // 3))
        print(json.dumps({"spans": spans}), flush=True)
    except Exception:
        # Ошибка делает всю проверку неуспешной, частичный результат не выдаётся.
        print(json.dumps({"error": "scanner unavailable"}), flush=True)
