"""Copy the intended source tree to a fresh directory, without local envs or build output."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil

EXCLUDED = {'.git', '.checkpoints', '.verification', '.venv', '.venv-migrate', 'node_modules',
            '.expo', '.test-artifacts', '.npm-cache', '.pip-cache', '.pytest_cache', '.pytest_tmp',
            '.tools', 'cache', '__pycache__', 'uploads', '.backups', 'dist', 'build-admin',
            'build-android', 'build-ios', '.e2e-web', '.map-baseline-web', 'test-results',
            'playwright-report', '.wrangler', '.claude', '.vscode'}


def source_files(root):
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in EXCLUDED]
        for name in sorted(names):
            path = Path(base) / name
            if name.startswith('.env') and not name.endswith('.example'):
                continue
            if path.suffix in {'.tgz', '.pyc', '.db', '.sqlite', '.log'} or name.endswith('.tsbuildinfo'):
                continue
            yield path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', help='A new directory under workspace/.verification')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    destination = Path(args.destination).resolve()
    if not destination.is_relative_to((root / '.verification').resolve()) or destination.exists():
        raise SystemExit('Choose a NEW destination under this workspace/.verification; existing files are preserved')
    files = list(source_files(root))
    destination.mkdir(parents=True)
    manifest = []
    for path in files:
        relative = path.relative_to(root)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        manifest.append({'path': relative.as_posix(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    (destination / 'handoff-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Copied {len(manifest)} source files; no installed dependencies, personal .env or generated output')


if __name__ == '__main__':
    main()
