"""Check local Markdown links in the intended source handoff; no network calls."""
from pathlib import Path
import re
from urllib.parse import unquote
from prepare_handoff import source_files


def main():
    root = Path(__file__).resolve().parents[1]
    broken = []
    checked = 0
    for path in source_files(root):
        if path.suffix.lower() != '.md':
            continue
        for raw in re.findall(r'\[[^\]]*\]\(([^)]+)\)', path.read_text(encoding='utf-8')):
            target = raw.split(' "', 1)[0].strip('<>')
            if not target or re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            target = unquote(target.split('#', 1)[0])
            checked += 1
            if not (path.parent / target).exists():
                broken.append(f'{path.relative_to(root)} -> {target}')
    print(f'Checked {checked} local documentation links; {len(broken)} broken')
    for value in broken:
        print(value)
    return int(bool(broken))


if __name__ == '__main__':
    raise SystemExit(main())
