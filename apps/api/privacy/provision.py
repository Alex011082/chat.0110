"""Загрузка только открытых весов; пользовательские тексты здесь не используются."""
import os
from huggingface_hub import snapshot_download
from gliner import GLiNER

target = os.environ.get("CHAT0110_PRIVACY_MODEL", "/var/lib/chat0110/privacy-model")
snapshot_download("urchade/gliner_multi-v2.1", revision="443d26d654e0324125a96bebd8e796c14ff2efe6", local_dir=target, allow_patterns=["*.json", "*.safetensors", "*.model"])
# Кешируем также токенизатор и конфигурацию базовой модели до offline-запуска.
GLiNER.from_pretrained(target)
print("Локальная модель готова")
