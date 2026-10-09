#!/usr/bin/env bash
# Usage: sudo bash scripts/deploy-pi.sh ABS_RELEASE_DIR EXPECTED_COMMIT ABS_PROJECT_DIR
# The operator must first authenticate the successful main container and app workflows.
# This script validates their downloaded artifact; it cannot establish GitHub provenance.
# Repeating this command with a retained, verified earlier release promotes that release.
# current.json also records the previous image and Compose snapshot for manual recovery.
set -euo pipefail
exec python3 - "$@" <<'PY'
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import urllib.request

REPOSITORY = "Gavril242/Togaether-with-Weather"
SOURCE_URL = "https://github.com/" + REPOSITORY
DOCKER = ["/usr/bin/docker", "--host", "unix:///var/run/docker.sock"]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def inside(path, parent):
    return path != parent and path.is_relative_to(parent)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def read_json(path):
    require(path.stat().st_size <= 65536, "JSON metadata exceeds its size limit")
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON metadata key")
            result[key] = value
        return result
    value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=pairs)
    require(isinstance(value, dict), "Metadata must be a JSON object")
    return value


def environment(image):
    # Do not source .env or inherit Docker contexts, remote hosts or shell options.
    return {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/root",
            "FOURCAST_IMAGE": image, "COMPOSE_DISABLE_ENV_FILE": "true"}


def run(arguments, image, timeout=60):
    completed = subprocess.run(arguments, env=environment(image), text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               timeout=timeout)
    if completed.returncode:
        # These commands contain no provider keys or tunnel credentials.
        raise RuntimeError((completed.stderr or completed.stdout)[-8000:].strip()
                           or "Docker command failed")
    return completed.stdout


def compose(project, config, image, *arguments, timeout=60):
    return run(DOCKER + ["compose", "--project-name", "fourcast",
               "--project-directory", str(project), "--env-file", "/dev/null",
               "--file", str(config), *arguments], image, timeout)


def image_details(image):
    return json.loads(run(DOCKER + ["image", "inspect", image], image))[0]


def container(project, image):
    identifiers = run(DOCKER + ["ps", "-a", "--filter",
        "label=com.docker.compose.project=fourcast", "--format", "{{.ID}}"], image).split()
    require(len(identifiers) <= 1, "Fourcast contains unexpected additional containers")
    if not identifiers:
        return None
    value = json.loads(run(DOCKER + ["inspect", identifiers[0]], image))[0]
    labels = value["Config"].get("Labels") or {}
    require(labels.get("com.docker.compose.service") == "web",
            "Existing Fourcast container is not the weather web service")
    require(labels.get("com.docker.compose.project.working_dir") == str(project),
            "Existing Fourcast project belongs to another directory")
    return value


def verify_config(project, config, image):
    value = json.loads(compose(project, config, image, "config", "--format", "json"))
    require(set(value.get("services", {})) == {"web"},
            "Deployment Compose must contain only the weather web service")
    require(value["services"]["web"].get("image") == image,
            "Compose must use the explicitly verified image")


def check_health(project, config, image):
    compose(project, config, image, "up", "--detach", "--wait",
            "--wait-timeout", "120", "web", timeout=150)
    active = container(project, image)
    require(active is not None and active["Image"] == image_details(image)["Id"],
            "The running weather container does not use the verified image")
    require(active["State"].get("Health", {}).get("Status") == "healthy",
            "Weather container is not healthy")
    with urllib.request.urlopen("http://127.0.0.1:3102/api/health", timeout=5) as response:
        require(response.status == 200 and json.load(response).get("status") == "ok",
                "Weather origin liveness failed")


def save_state(path, state):
    descriptor, temporary = tempfile.mkstemp(prefix=".current-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(state, output, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    require(len(sys.argv) == 4,
            "Usage: deploy-pi.sh ABS_RELEASE_DIR EXPECTED_COMMIT ABS_PROJECT_DIR")
    require(os.geteuid() == 0, "Run this script through sudo")
    require(platform.system() == "Linux" and platform.machine() in ("aarch64", "arm64"),
            "Deployment requires the local ARM64 Linux host")
    require(Path(sys.argv[1]).is_absolute() and Path(sys.argv[3]).is_absolute(),
            "Release and project arguments must be absolute paths")
    commit = sys.argv[2]
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "Expected commit must be 40 lowercase hex characters")
    project = Path(sys.argv[3]).resolve(strict=True)
    releases = (project / "releases").resolve(strict=True)
    release = Path(sys.argv[1]).resolve(strict=True)
    require(project.is_dir() and releases.is_dir() and release.is_dir(), "Deployment paths must be directories")
    require(inside(releases, project) and inside(release, releases), "Release must be inside PROJECT/releases")
    config = (project / "compose.yaml").resolve(strict=True)
    require(inside(config, project) and config.is_file(), "Compose must remain inside the project directory")
    metadata = (release / "release.json").resolve(strict=True)
    require(inside(metadata, release), "Release metadata escapes its directory")
    manifest = read_json(metadata)
    require(manifest.get("schemaVersion") == 1 and manifest.get("repository") == REPOSITORY,
            "Unexpected release schema or repository")
    require(manifest.get("sourceRef") == "refs/heads/main" and manifest.get("promotionEligible") is True,
            "Only a verified main artifact can be promoted")
    require(manifest.get("sourceCommit") == commit and manifest.get("platform") == "linux/arm64",
            "Release commit or architecture differs from the expected release")
    image = "fourcast:" + commit
    require(manifest.get("image") == image, "Release image tag differs from its commit")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", manifest.get("imageId", "")), "Invalid image ID")
    require(manifest.get("archive") == "fourcast-arm64.tar.gz", "Unexpected archive filename")
    require(re.fullmatch(r"[0-9a-f]{64}", manifest.get("archiveSha256", "")), "Invalid archive hash")
    archive = (release / manifest["archive"]).resolve(strict=True)
    require(inside(archive, release) and archive.is_file(), "Archive escapes its release directory")
    require(digest(archive) == manifest["archiveSha256"], "Release archive SHA256 mismatch")

    # Everything below is restricted to the local Docker socket and project fourcast.
    lock_descriptor = os.open(project / ".deploy.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError("Another weather promotion is already running")
    verify_config(project, config, image)

    previous = None
    active = container(project, image)
    state_path = project / "current.json"
    if active:
        require(state_path.is_file() and not state_path.is_symlink(),
                "Existing weather container has no managed rollback record; inspect it manually")
        previous = read_json(state_path)
        require(previous.get("image") == active["Config"]["Image"]
                and previous.get("imageId") == active["Image"], "Rollback record differs from the running image")
        require(re.fullmatch(r"fourcast:[0-9a-f]{40}", previous.get("image", "")), "Invalid prior image tag")
        prior_config = Path(previous.get("composeSnapshot", "")).resolve(strict=True)
        require(inside(prior_config, project) and prior_config.is_file(), "Prior Compose snapshot escapes the project")
        require(digest(prior_config) == previous.get("composeSha256"), "Prior Compose snapshot hash mismatch")
        require(image_details(previous["image"])["Id"] == previous["imageId"], "Prior image is unavailable or changed")
        verify_config(project, prior_config, previous["image"])
        if previous["image"] == image:
            require(previous["imageId"] == manifest["imageId"],
                    "A different image already uses this commit tag; preserve the rollback image first")

    run(DOCKER + ["load", "--input", str(archive)], image, timeout=180)
    details = image_details(image)
    labels = details["Config"].get("Labels") or {}
    require(details["Id"] == manifest["imageId"] and details["Os"] == "linux"
            and details["Architecture"] == "arm64", "Loaded image identity or architecture differs")
    require(labels.get("org.opencontainers.image.revision") == commit
            and labels.get("org.opencontainers.image.source") == SOURCE_URL,
            "Loaded image source labels differ from the verified repository")

    deployments = project / "deployments"
    deployments.mkdir(mode=0o700, exist_ok=True)
    deployments = deployments.resolve(strict=True)
    require(inside(deployments, project), "Deployment snapshots escape the project")
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    attempt = deployments / (timestamp + "-" + commit[:12])
    attempt.mkdir(mode=0o700)
    snapshot = attempt / "compose.yaml"
    snapshot.write_bytes(config.read_bytes())
    snapshot.chmod(0o600)
    if previous:
        (attempt / "previous.json").write_text(json.dumps(previous, indent=2) + "\n", encoding="utf-8")
        (attempt / "previous.json").chmod(0o600)

    try:
        check_health(project, snapshot, image)
        prior_pointer = None if previous is None else {
            key: previous[key] for key in ("sourceCommit", "image", "imageId", "releaseDirectory", "composeSnapshot", "composeSha256")
        }
        save_state(state_path, {"schemaVersion": 1, "deployedAt": timestamp,
            "sourceCommit": commit, "image": image, "imageId": details["Id"],
            "releaseDirectory": str(release), "archiveSha256": manifest["archiveSha256"],
            "composeSnapshot": str(snapshot), "composeSha256": digest(snapshot), "previous": prior_pointer})
    except Exception as failure:
        print("Promotion failed: " + str(failure), file=sys.stderr)
        try:
            if previous:
                check_health(project, prior_config, previous["image"])
                print("Previous weather release restored and healthy.", file=sys.stderr)
            else:
                compose(project, snapshot, image, "down", "--timeout", "30")
                print("Failed first weather deployment removed.", file=sys.stderr)
        except Exception as rollback_failure:
            raise RuntimeError("Weather rollback needs attention: " + str(rollback_failure)) from failure
        raise RuntimeError("Promotion was not accepted; the previous deployment record is unchanged") from failure
    print("Weather release " + commit + " is healthy; current.json records its identity.")


try:
    main()
except Exception as error:
    print("Deployment refused: " + str(error), file=sys.stderr)
    sys.exit(1)
PY
