#!/usr/bin/env python3
"""Selecione a pasta de PDFs de uma instalação local do Obsidian Library."""

import argparse
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import subprocess
import tempfile
from datetime import datetime


PROJECT = Path(__file__).resolve().parent


def local_directory(value: str) -> Path:
    value = value.strip().replace("\\", "/")
    if any(ord(char) < 32 for char in value):
        raise ValueError("O caminho contém caracteres de controle.")
    if value.startswith("//"):
        host, separator, remainder = value[2:].partition("/")
        share, _, subdirectory = remainder.partition("/")
        if not separator or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", share):
            raise ValueError("Informe o compartilhamento no formato //servidor/pasta.")
        local_ips = set(subprocess.check_output(["hostname", "-I"], text=True).split())
        resolved_ips = {entry[4][0] for entry in socket.getaddrinfo(host, None)}
        if not (resolved_ips & local_ips) and host.lower() not in {socket.gethostname().lower(), "localhost"}:
            raise ValueError("O compartilhamento precisa estar no mesmo Raspberry Pi.")
        share_directory = subprocess.check_output([
            "testparm", "-s", "--section-name=" + share, "--parameter-name=path",
        ], text=True, stderr=subprocess.DEVNULL).strip()
        if not share_directory.startswith("/"):
            raise ValueError("O compartilhamento Samba não tem um caminho local fixo.")
        root = Path(share_directory).resolve(strict=True)
        target = (root / subdirectory.lstrip("/")).resolve(strict=True)
        if not target.is_relative_to(root):
            raise ValueError("A pasta está fora do compartilhamento Samba.")
    elif value.startswith("/"):
        target = Path(value).resolve(strict=True)
    else:
        raise ValueError("Informe um caminho absoluto no Pi ou um compartilhamento Samba.")
    if target == Path("/") or not target.is_dir():
        raise ValueError("Escolha uma pasta existente dedicada aos livros.")
    return target


def compose(env_file: Path, *args: str) -> None:
    command = ["docker", "compose", "-f", str(PROJECT / "docker-compose.yml"), "--env-file", str(env_file), *args]
    if os.geteuid() != 0:
        command.insert(0, "sudo")
    environment = dict(os.environ)
    for key in ("LIBRARY_BOOKS_DIR", "LIBRARY_BOOKS_GID", "COMPOSE_PROJECT_NAME"):
        environment.pop(key, None)
    subprocess.run(command, cwd=PROJECT, env=environment, check=True)


def env_with_directory(contents: str, target: Path) -> str:
    path = str(target)
    if any(char in path for char in ("'", "\r", "\n")):
        raise ValueError("Use um caminho sem apóstrofos ou quebras de linha.")
    settings = {
        "LIBRARY_BOOKS_DIR": "'" + path + "'",
        "LIBRARY_BOOKS_GID": str(target.stat().st_gid),
    }
    lines = [line for line in contents.splitlines()
             if not any(re.match(r"^\s*(?:export\s+)?" + key + r"\s*=", line) for key in settings)]
    return "\n".join(lines + [f"{key}={value}" for key, value in settings.items()]) + "\n"


def configure(target: Path) -> None:
    env_file = PROJECT / ".env"
    original = env_file.read_text(encoding="utf-8")
    contents = env_with_directory(original, target)
    marker = target / ".obsidian-library"
    if marker.is_symlink() or (marker.exists() and not marker.is_file()):
        raise ValueError("O marcador .obsidian-library precisa ser um arquivo normal.")
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=PROJECT, prefix=".books-", delete=False) as temp:
        temp.write(contents)
        staged = Path(temp.name)
    try:
        compose(staged, "config", "--quiet")
        compose(staged, "run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "obsidian-library", "-ec",
                """test -r /books && test -x /books
unreadable=$(find /books -type f -iname '*.pdf' -exec sh -c 'for pdf do test -r "$pdf" || printf "."; done' sh {} +)
test -z "$unreadable" || { echo "O container não consegue ler todos os PDFs." >&2; exit 1; }""")
        if not marker.exists():
            try:
                with marker.open("xb") as marker_file:
                    os.fchmod(marker_file.fileno(), 0o644)
            except FileExistsError:
                if marker.is_symlink() or not marker.is_file():
                    raise ValueError("O marcador criado simultaneamente é inválido.")
        backup = PROJECT / (".env.backup-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
        shutil.copy2(env_file, backup)
        os.chmod(staged, stat.S_IMODE(env_file.stat().st_mode))
        os.replace(staged, env_file)
        try:
            compose(env_file, "up", "-d", "--no-build")
        except subprocess.CalledProcessError:
            os.replace(backup, env_file)
            compose(env_file, "up", "-d", "--no-build")
            raise
    finally:
        staged.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pasta", nargs="?", help="Caminho local ou compartilhamento Samba")
    args = parser.parse_args()
    try:
        target = local_directory(args.pasta if args.pasta is not None else input("Pasta dos PDFs: "))
        print(f"Pasta no Raspberry Pi: {target}", flush=True)
        configure(target)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Não foi possível configurar a pasta: {error}\n")
    print("Pasta configurada. Aguarde a indexação e clique em Atualizar no Obsidian.")


if __name__ == "__main__":
    main()
