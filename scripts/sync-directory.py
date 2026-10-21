#!/usr/bin/env python3
"""Mirror a prepared directory while preserving unchanged build-input mtimes."""

import argparse
import filecmp
import os
from pathlib import Path
import shutil
import stat


def remove(path: Path) -> None:
    if path.is_symlink() or not path.is_dir():
        path.unlink(missing_ok=True)
    else:
        shutil.rmtree(path)


def sync_directory(source: Path, destination: Path) -> None:
    if not source.is_dir():
        raise ValueError(f"source directory does not exist: {source}")
    if destination.is_symlink() or (
        destination.exists() and not destination.is_dir()
    ):
        remove(destination)
    destination.mkdir(parents=True, exist_ok=True)

    children = {child.name: child for child in source.iterdir()}
    for child in destination.iterdir():
        if child.name not in children:
            remove(child)

    for name, child in children.items():
        target = destination / name
        if child.is_symlink():
            link = os.readlink(child)
            if target.is_symlink() and os.readlink(target) == link:
                continue
            remove(target)
            target.symlink_to(link)
        elif child.is_dir():
            sync_directory(child, target)
        elif child.is_file():
            if target.is_symlink() or target.is_dir():
                remove(target)
            if not target.is_file() or not filecmp.cmp(child, target, shallow=False):
                # Changed inputs need a fresh mtime even when the deterministic
                # contracts archive timestamps all source files at the epoch.
                shutil.copyfile(child, target)
            if stat.S_IMODE(child.stat().st_mode) != stat.S_IMODE(target.stat().st_mode):
                shutil.copymode(child, target)
        else:
            raise ValueError(f"unsupported source entry: {child}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    sync_directory(args.source, args.destination)
