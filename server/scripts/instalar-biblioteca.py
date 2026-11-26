#!/usr/bin/env python3
"""Configure a primeira instalação do Obsidian Library com Docker Compose."""

import importlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit


# O assistente de troca de pasta usa a mesma configuração e resolução Samba.
config = importlib.import_module("configurar-biblioteca")


def https_origin(value: str) -> str:
    value = value.strip()
    if re.fullmatch(r"https://(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]+)?/?", value, re.IGNORECASE):
        url = urlsplit(value)
        if url.hostname and url.port != 0:
            return value.rstrip("/").lower()
    raise ValueError("Informe uma URL HTTPS privada sem caminho, parâmetros ou credenciais.")


def install() -> int:
    env_file = config.PROJECT / ".env"
    created = []
    step = "verificar os pré-requisitos"
    try:
        if env_file.exists() or env_file.is_symlink():
            print(f"Já existe {env_file}. Para trocar a pasta dos PDFs, use configurar-biblioteca.py.", file=sys.stderr)
            return 1
        if sys.platform != "linux":
            raise ValueError("Execute o assistente no servidor Linux.")
        config.docker("compose", "version")
        config.docker("version", "--format", "{{.Server.Version}}")

        step = "ler a configuração"
        books = config.local_directory(input("Pasta dos PDFs (caminho absoluto ou Samba local): "))
        state_input = Path(input("Pasta de estado (caminho absoluto): ").strip())
        if not state_input.is_absolute():
            raise ValueError("Informe um caminho absoluto para a pasta de estado.")
        state = state_input.resolve()
        if state == Path("/") or state.is_relative_to(books) or (state.exists() and not state.is_dir()):
            raise ValueError("Escolha uma pasta de estado fora da biblioteca de PDFs.")
        if not state.exists() and not state.parent.is_dir():
            raise ValueError("Escolha uma pasta cujo diretório pai já exista.")
        if any(char in str(state) for char in ("'", "\r", "\n")):
            raise ValueError("Use um caminho de estado sem apóstrofos ou quebras de linha.")
        print("Configure o Tailscale Serve ou seu proxy HTTPS privado conforme docs/server-setup.md.")
        origin = https_origin(input("URL HTTPS privada: "))
        uid, gid = (os.getuid(), os.getgid()) if os.getuid() else (10001, 10001)
        contents = config.env_with_directory(
            f"LIBRARY_STATE_DIR='{state}'\nLIBRARY_PUBLIC_URL={origin}\nLIBRARY_UID={uid}\nLIBRARY_GID={gid}",
            books,
        )
        marker = books / ".obsidian-library"
        print(f"\nPDFs: {books}\nEstado: {state}\nHTTPS: {origin}\n"
              f"Usuário do contêiner: {uid}:{gid}\nMarcador: {marker}\nConfiguração: {env_file}")
        if input("Aplicar esta configuração e iniciar o serviço? [s/N] ").strip().lower() not in {"s", "sim"}:
            print("Instalação cancelada.")
            return 0

        step = "preparar o marcador da biblioteca"
        if marker.is_symlink() or (marker.exists() and not marker.is_file()):
            raise ValueError("O marcador precisa ser um arquivo normal.")
        if not marker.exists():
            with marker.open("xb") as marker_file:
                created.append(marker)
                os.fchmod(marker_file.fileno(), 0o644)

        step = "preparar a pasta de estado"
        if not state.exists():
            state.mkdir(mode=0o750)
            created.append(state)
            if os.getuid() == 0:
                os.chown(state, uid, gid)

        step = "validar o Docker Compose"
        with tempfile.TemporaryDirectory(dir=config.PROJECT, prefix=".install-") as staging:
            staged_path = Path(staging) / "library.env"
            with os.fdopen(os.open(staged_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w", encoding="utf-8") as staged:
                staged.write(contents)
            config.compose(staged_path, "config", "--quiet")
            step = "construir a imagem do servidor"
            config.compose(staged_path, "build", "obsidian-library")
            step = "verificar o acesso do contêiner aos PDFs, ao marcador e ao estado"
            config.compose(staged_path, "run", "--rm", "--no-deps", "--entrypoint", "/bin/sh",
                           "obsidian-library", "-ec", "test -r /books/.obsidian-library\n"
                           "test -w /state && test -x /state\n" + config.CHECK_PDFS)
            step = "gravar o .env"
            os.link(staged_path, env_file)
            created.append(env_file)
        step = "iniciar o serviço"
        config.compose(env_file, "up", "-d", "--no-build", "--wait")
    except (OSError, ValueError, subprocess.CalledProcessError, EOFError, KeyboardInterrupt) as error:
        print(f"Falha ao {step}: {error}", file=sys.stderr)
        print("Arquivos e pastas criados: " + (", ".join(map(str, created)) or "nenhum"), file=sys.stderr)
        if env_file in created:
            print("Consulte os logs do Docker Compose, corrija o problema e execute docker compose up -d.", file=sys.stderr)
        return 1

    print(f"\nRemote server no Obsidian: {origin}\nTeste no dispositivo que usa o Obsidian: {origin}/health\n"
          "Quando catalogReady for true, selecione Test connection no Obsidian.")
    return 0


if __name__ == "__main__":
    sys.exit(install())
