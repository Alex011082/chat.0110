#!/usr/bin/env python3
"""Проверяем раздаваемый ZIP после сборки, а не только исходный manifest."""
import hashlib
import json
import pathlib
import re
import struct
import shutil
import sys
import zipfile

downloads = pathlib.Path(sys.argv[1])
index = json.loads((downloads / "plugins.json").read_text())
entry = next(p for p in index["plugins"] if p["id"] == "codex")
archive = downloads / pathlib.PurePosixPath(entry["url"]).name
assert hashlib.sha256(archive.read_bytes()).hexdigest() == entry["sha256"]
assert archive.stat().st_size == entry["bytes"]
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    names = z.namelist()
    assert len(names) == len(set(names))
    assert not any(".." in pathlib.PurePosixPath(n).parts or n.startswith("/") for n in names)
    assert not any(n.startswith(("server/", "hooks/", "state/", "node_modules/")) or n.endswith((".mjs", ".key", ".pem", ".env")) for n in names)
    root = json.loads(z.read("plugin.json"))
    compat = json.loads(z.read(".codex-plugin/plugin.json"))
    status = json.loads(z.read("review-status.json"))
    assert root["version"] == compat["version"] == status["version"] == index["version"] == entry["version"]
    assert status["status"] == entry["status"] == "not-submitted"
    assert status["official"] is False and entry["official"] is False
    assert "hooks" not in root and "hooks" not in compat
    a = root["extensions"]["com.openai"]
    b = compat["extensions"]["com.openai"]
    assert a["interface"] == compat["interface"]
    for interface in [a["interface"], compat["interface"]]:
        assert 0 < len(interface["displayName"]) <= 30
        assert 0 < len(interface["shortDescription"]) <= 30
        assert 0 < len(interface["longDescription"]) <= 4000
        for key in ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]:
            assert interface[key].startswith("https://") and "example.com" not in interface[key]
        assert interface["privacyPolicyURL"] == "https://chat.0110.digital/privacy"
        assert interface["termsOfServiceURL"] == "https://chat.0110.digital/terms"
        for key in ["logo", "composerIcon"]:
            asset = z.read(interface[key].removeprefix("./"))
            assert asset.startswith(b"\x89PNG\r\n\x1a\n")
            width,height=struct.unpack(">II",asset[16:24])
            assert width==height and 48<=width<=4096 and len(asset)<=5*1024*1024
    assert a["review"] == b["review"]
    assert a["publication"] == b["publication"]
    assert "translations" not in a["publication"], "Public ZIP must use the English base listing only"
    # Проверяем распакованный результат: генератор тоже может добавить русский документ.
    for name in names:
        if name.endswith((".json", ".md", ".txt", ".yaml", ".yml")):
            text = z.read(name).decode("utf-8")
            assert not re.search(r"[\u0400-\u04ff]", text), f"Non-English Cyrillic text in public ZIP: {name}"
    review = a["review"]
    assert "test_credentials" not in review and "reviewer_instructions" not in review
    for kind, count in [("positive", 5), ("negative", 3)]:
        cases = review["test_cases"][kind]
        assert len(cases) == count
        for case in cases:
            assert case["description"] and case["prompt"] and case["expected_behavior"]
            if kind == "positive":
                assert case["tools_triggered"]
    for file in ["mcp.json", ".mcp.json"]:
        servers = json.loads(z.read(file))["mcpServers"]
        assert list(servers) == ["chat0110"]
        server = servers["chat0110"]
        assert server["url"] == "https://chat.0110.digital/mcp"
        assert "command" not in server and "args" not in server
        assert server.get("type", "streamable-http") == "streamable-http"
    assert compat["mcpServers"] == "./.mcp.json"
    assert a["onboardingSkill"] == b["onboardingSkill"]
    assert a["onboardingSkill"].removeprefix("./") in names
receipt={"archive": archive.name, "version": root["version"], "sha256": entry["sha256"], "remote_only": True, "manifest_versions_match": True, "english_base_listing_only": True, "no_cyrillic_packaged_text": True, "listing_lengths": {"subtitle":len(a["interface"]["shortDescription"]),"description":len(a["interface"]["longDescription"])}, "review_cases": {"positive": 5, "negative": 3}, "submitted": False, "review_prerequisites":status["reviewPrerequisites"]}
if len(sys.argv)>2:
    output=pathlib.Path(sys.argv[2]);output.mkdir(parents=True,exist_ok=True)
    shutil.copy2(archive,output/archive.name)
    shutil.copy2(str(archive)+".sha256",output/(archive.name+".sha256"))
    (output/"technical-checks.json").write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n")
    dossier=pathlib.Path(__file__).resolve().parents[1]/"docs/publication"
    for document in dossier.glob("*.md"):
        shutil.copy2(document,output/document.name)
print(json.dumps(receipt))
