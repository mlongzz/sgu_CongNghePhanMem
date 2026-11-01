"""Apply two reviewed demo-guide repairs with strict preconditions.

Preview is the default. --apply requires a fully restored and fingerprinted
backup of the same local development database. No existing guide text is
overwritten and any unexpected state aborts the entire transaction.
"""
import argparse
import hashlib
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import engine
from app.models.guide_content import GuideContent
from app.models.place import Place
from scripts.verify_database_backup import snapshot

CU_CHI_SOURCE = 'https://baotanglichsu.vn/vi/Articles/2001/66910/djia-djao-cu-chi-djiem-hen-tim-ve-lich-su.html'
BEN_THANH_SOURCE = 'https://visithcmc.vn/vi/kham-pha-cho-ben-thanh-tphcm-tu-a-z-5-phut-doc/'
CU_CHI_TEXT = {
    'vi': 'Địa đạo Củ Chi là hệ thống phòng thủ dưới lòng đất tại Củ Chi, Thành phố Hồ Chí Minh, hình thành trong thời kỳ kháng chiến chống Pháp. Bên cạnh các đường hầm, hệ thống có những không gian phục vụ sinh hoạt và chiến đấu như phòng ở, bếp, kho và bệnh xá. Ngày nay, khu di tích giúp du khách tìm hiểu đời sống và điều kiện chiến đấu của quân dân Củ Chi trong thời chiến.',
    'en': 'The Cu Chi Tunnels are an underground defence system in Cu Chi, Ho Chi Minh City, formed during the resistance against French colonial rule. Alongside the tunnels were spaces for daily life and defence, including living quarters, kitchens, stores and medical facilities. Today, the historic site helps visitors learn about the lives and wartime conditions of the people and forces of Cu Chi.',
}
BEN_THANH_TEXT = {
    'vi': 'Chợ Bến Thành là một điểm đến quen thuộc ở trung tâm thành phố. Tháp đồng hồ và các dãy hàng tạo nên hình ảnh đặc trưng của khu chợ đô thị lâu đời.',
    'en': 'Ben Thanh Market is a well-known destination in the city centre. Its clock tower and market halls form the familiar image of a longstanding urban market.',
}
OLD_VI_SOURCE = 'https://share.google/pjDT4EA91PR02ttwn'


def apply_reviewed_guides(session: Session, *, mutate: bool = True) -> list[str]:
    """Mutate the caller's transaction or raise; never commit internally."""
    places = {}
    for name, latitude, longitude in [('Địa đạo Củ Chi', 11.1415, 106.4635), ('Chợ Bến Thành', 10.772521, 106.698019)]:
        matches = session.scalars(select(Place).where(Place.name == name).with_for_update()).all()
        if len(matches) != 1:
            raise ValueError(f'Expected exactly one place: {name}')
        place = matches[0]
        if place.deleted_at is not None or place.publication_status != 'published' or abs(place.latitude-latitude) > .001 or abs(place.longitude-longitude) > .001:
            raise ValueError(f'Place identity or publication changed: {name}')
        places[name] = place
    actions = []
    cu = places['Địa đạo Củ Chi']
    for language, content in CU_CHI_TEXT.items():
        rows = session.scalars(select(GuideContent).where(GuideContent.place_id == cu.id, GuideContent.language_code == language).with_for_update()).all()
        if not rows:
            if mutate:
                session.add(GuideContent(place_id=cu.id, language_code=language, title=cu.name, content=content, publication_status='published', source_url=CU_CHI_SOURCE))
            actions.append(f'add Cu Chi {language}')
        elif len(rows) != 1 or (rows[0].title, rows[0].content, rows[0].publication_status, rows[0].source_url, rows[0].source_license) != (cu.name, content, 'published', CU_CHI_SOURCE, None):
            raise ValueError(f'Existing Cu Chi {language} guide differs; review it manually')
    market = places['Chợ Bến Thành']
    for language, content in BEN_THANH_TEXT.items():
        rows = session.scalars(select(GuideContent).where(GuideContent.place_id == market.id, GuideContent.language_code == language).with_for_update()).all()
        if len(rows) != 1:
            raise ValueError(f'Expected one Ben Thanh {language} guide')
        row = rows[0]
        allowed_sources = {BEN_THANH_SOURCE, OLD_VI_SOURCE} if language == 'vi' else {BEN_THANH_SOURCE, None}
        allowed_status = {'draft', 'published'} if language == 'vi' else {'published'}
        if row.title != market.name or row.content != content or row.source_url not in allowed_sources or row.source_license is not None or row.publication_status not in allowed_status:
            raise ValueError(f'Ben Thanh {language} guide changed; review it manually')
        if row.source_url != BEN_THANH_SOURCE or row.publication_status != 'published':
            if mutate:
                row.source_url = BEN_THANH_SOURCE
                row.publication_status = 'published'
            actions.append(f'verify Ben Thanh {language}')
    if mutate:
        session.flush()
    return actions


def verify_backup(backup: Path) -> None:
    project = Path(__file__).resolve().parents[2]
    roots = ((project / '.verification').resolve(), (project / 'backend' / '.backups').resolve())
    backup = backup.resolve(strict=True)
    if not any(backup.is_relative_to(root) for root in roots) or not backup.is_file():
        raise ValueError('Backup must be an existing file in this workspace’s .verification or backend/.backups directory')
    report = json.loads(backup.with_suffix('.verification.json').read_text(encoding='utf-8'))
    if any(report.get(key) != 'PASS' for key in ('restore', 'migration_transaction_rollback', 'migration_schema', 'source_unchanged')):
        raise ValueError('Backup lacks a successful restore verification')
    if hashlib.sha256(backup.read_bytes()).hexdigest() != report.get('backup_sha256'):
        raise ValueError('Backup checksum mismatch')
    current = snapshot(engine, report['original_columns'])
    if current['tables'] != report['tables']:
        raise ValueError('Database changed since backup verification; make and verify a new backup')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--verified-backup', type=Path)
    args = parser.parse_args()
    url = engine.url
    if url.get_backend_name() != 'postgresql' or url.host not in ('127.0.0.1', 'localhost', '::1') or url.database != 'multilingual_guide':
        raise SystemExit('Refusing: target must be local PostgreSQL multilingual_guide')
    if args.apply:
        if not args.verified_backup:
            raise SystemExit('Provide --verified-backup for --apply')
        verify_backup(args.verified_backup)
    with Session(engine) as session:
        try:
            with session.begin():
                actions = apply_reviewed_guides(session, mutate=args.apply)
            print(json.dumps({'applied': args.apply, 'actions': actions}, ensure_ascii=False))
        except Exception:
            session.rollback()
            raise


if __name__ == '__main__':
    main()
