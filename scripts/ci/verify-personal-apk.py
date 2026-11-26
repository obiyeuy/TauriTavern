#!/usr/bin/env python3
"""Verify the signed ARM64 personal APK before making release assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CERTIFICATE = "bf70926990809b5983eae24be032109ece7d7f5346945c5747a5ce9ba4be5383"


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(apk, output, release_id, channel, source_revision, repository):
    version = json.loads((ROOT / "package.json").read_text())["version"]
    major, minor, patch = (int(part) for part in version.split("."))
    version_code = major * 1_000_000 + minor * 1_000 + patch
    if not re.fullmatch(r"[0-9a-f]{40}", source_revision):
        raise RuntimeError("The release source revision must be a full Git SHA")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", release_id):
        raise RuntimeError("The release ID must be a single asset-name component")
    if not re.fullmatch(r"[A-Za-z0-9-]+/[A-Za-z0-9_.-]+", repository):
        raise RuntimeError("The update repository must be owner/repository")
    if channel == "stable" and release_id != version:
        raise RuntimeError("Stable release ID must match the project version")
    sdk = os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
    if not sdk:
        raise RuntimeError("ANDROID_SDK_ROOT or ANDROID_HOME is required")
    tools = Path(sdk) / "build-tools/36.0.0"
    output.mkdir(parents=True, exist_ok=True)

    def run_tool(name, *arguments):
        result = subprocess.run(
            [str(tools / name), *map(str, arguments)],
            capture_output=True, text=True, timeout=120,
        )
        (output / f"{name}.log").write_text(result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError(f"{name} failed; see {output / (name + '.log')}")
        return result.stdout

    signature = run_tool("apksigner", "verify", "--verbose", "--print-certs", apk)
    certificate = re.search(r"Signer #1 certificate SHA-256 digest: (\w+)", signature)
    if not certificate or certificate[1].lower() != CERTIFICATE:
        raise RuntimeError("The APK does not use the existing personal certificate")
    for scheme in (2, 3):
        if not re.search(rf"Verified using v{scheme} scheme .*: true", signature):
            raise RuntimeError(f"APK v{scheme} signature is not verified")
    run_tool("zipalign", "-c", "-P", "16", "-v", "4", apk)
    badging = run_tool("aapt2", "dump", "badging", apk)
    package = re.search(
        r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'",
        badging,
    )
    if not package or package[1] != "com.tauritavern.personal":
        raise RuntimeError("Unexpected Android application ID")
    if int(package[2]) != version_code or package[3] != version:
        raise RuntimeError("APK version does not match the source project")
    if "application-debuggable" in badging:
        raise RuntimeError("The APK is debuggable")
    for key, expected in [("minSdkVersion", 26), ("targetSdkVersion", 36)]:
        match = re.search(rf"{key}:'(\d+)'", badging)
        if not match or int(match[1]) != expected:
            raise RuntimeError(f"Unexpected {key}")

    target = Path(os.environ.get("CARGO_TARGET_DIR", ROOT / "src-tauri/target"))
    native_library = target / "aarch64-linux-android/release/libtauritavern_lib.so"
    native_digest = digest_file(native_library)
    libraries = []
    main_verified = False
    with zipfile.ZipFile(apk) as archive, apk.open("rb") as raw:
        if archive.testzip() is not None:
            raise RuntimeError("APK ZIP checksum failed")
        for info in archive.infolist():
            if not info.filename.startswith("lib/") or not info.filename.endswith(".so"):
                continue
            if not info.filename.startswith("lib/arm64-v8a/"):
                raise RuntimeError(f"Unexpected ABI: {info.filename}")
            binary = archive.read(info)
            if binary[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", binary, 18)[0] != 183:
                raise RuntimeError(f"Not an AArch64 ELF library: {info.filename}")
            offset = struct.unpack_from("<Q", binary, 32)[0]
            size = struct.unpack_from("<H", binary, 54)[0]
            count = struct.unpack_from("<H", binary, 56)[0]
            alignments = []
            for index in range(count):
                fields = struct.unpack_from("<IIQQQQQQ", binary, offset + index * size)
                if fields[0] == 1:
                    if fields[7] < 16384 or (fields[2] - fields[3]) % 16384:
                        raise RuntimeError(f"ELF is not 16 KiB aligned: {info.filename}")
                    alignments.append(fields[7])
            if not alignments:
                raise RuntimeError(f"No ELF load segment: {info.filename}")
            raw.seek(info.header_offset)
            header = raw.read(30)
            name_size, extra_size = struct.unpack_from("<HH", header, 26)
            data_offset = info.header_offset + 30 + name_size + extra_size
            if info.compress_type != zipfile.ZIP_STORED or data_offset % 16384:
                raise RuntimeError(f"ZIP library is not 16 KiB aligned: {info.filename}")
            digest = hashlib.sha256(binary).hexdigest()
            if info.filename.endswith("/libtauritavern_lib.so"):
                if digest != native_digest:
                    raise RuntimeError("APK native library differs from the fresh Rust build")
                if b"tauri-pilot-" in binary:
                    raise RuntimeError("The release contains the Pilot socket marker")
                endpoint = f"https://api.github.com/repos/{repository}".encode()
                if endpoint not in binary or source_revision[:12].encode() not in binary:
                    raise RuntimeError("APK update repository or source revision is stale")
                main_verified = True
            libraries.append({
                "path": info.filename, "sha256": digest,
                "sizeBytes": len(binary), "loadAlignments": alignments,
                "zipDataOffset": data_offset,
            })
    if not main_verified:
        raise RuntimeError("The main native library was not verified")

    name = f"TauriTavern-{release_id}-android-arm64-v8a.apk"
    destination = output / name
    if apk.resolve() != destination.resolve():
        shutil.copyfile(apk, destination)
    digest = digest_file(destination)
    report = {
        "file": name, "sha256": digest, "sizeBytes": destination.stat().st_size,
        "applicationId": package[1], "versionName": version, "versionCode": version_code,
        "minSdk": 26, "targetSdk": 36, "debuggable": False,
        "channel": channel, "sourceRevision": source_revision,
        "updateRepository": repository, "signingCertificateSha256": CERTIFICATE,
        "signatureSchemesVerified": ["v2", "v3"],
        "nativeLibraries": libraries, "nativeLibraryMatchesBuild": True,
        "nativeLibraryAlignment16KiBVerified": True, "zipAlignment16KiBVerified": True,
        "zipCrcVerified": True,
    }
    (output / f"{name}.manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    (output / f"{name}.sha256").write_text(f"{digest}  {name}\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--channel", required=True, choices=["stable", "canary"])
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--repository", required=True)
    options = parser.parse_args()
    verify(options.apk.resolve(strict=True), options.output.resolve(),
           options.release_id, options.channel, options.source_revision, options.repository)
