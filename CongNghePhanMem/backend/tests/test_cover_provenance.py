from test_media_and_account import client, headers, png  # noqa: F401


def test_cover_metadata_updates_and_removal_are_atomic(client, db_session):
    admin = headers(db_session, 'admin')
    place = client.post('/admin/places', headers=admin, json={
        'name': 'Cover provenance fixture', 'latitude': 1, 'longitude': 2,
    }).json()
    path = f'/admin/places/{place["id"]}'
    assert client.post(path + '/image', headers=admin, content=png()).status_code == 200
    row = client.get(path + '/images', headers=admin).json()[0]
    review_path = path + f'/images/{row["id"]}'
    metadata = {'status': 'approved', 'as_cover': True, 'attribution': 'First author',
                'license': 'CC0', 'source_url': 'https://example.org/fixture'}
    approved = client.put(review_path, headers=admin, json=metadata).json()
    assert approved['image_attribution'] == 'First author'
    assert approved['image_source_url'] == metadata['source_url']
    client.put(path, headers=admin, json={'publication_status': 'published'})
    unchanged = client.put(review_path, headers=admin, json=metadata).json()
    assert unchanged['publication_status'] == 'published'
    changed = client.put(review_path, headers=admin, json={
        'status': 'approved', 'attribution': 'Corrected author', 'license': 'CC BY 4.0',
    }).json()
    assert changed['image_attribution'] == 'Corrected author'
    assert changed['image_license'] == 'CC BY 4.0'
    assert changed['publication_status'] == 'published'
    assert client.get(path.replace('/admin', '')).json()['image_attribution'] == 'Corrected author'
    removed = client.delete(path + '/image', headers=admin).json()
    for field in ('image_url', 'image_attribution', 'image_source_url', 'image_license'):
        assert removed[field] is None
    assert removed['publication_status'] == 'published'
    assert client.get(path.replace('/admin', '')).status_code == 200
    assert client.get(path + '/images', headers=admin).json()[0]['status'] == 'rejected'


def test_adding_a_cover_does_not_publish_a_draft(client, db_session):
    admin = headers(db_session, 'admin')
    place = client.post('/admin/places', headers=admin, json={
        'name': 'Draft fixture', 'latitude': 1, 'longitude': 2,
    }).json()
    path = f'/admin/places/{place["id"]}'
    assert client.post(path + '/image', headers=admin, content=png()).status_code == 200
    image = client.get(path + '/images', headers=admin).json()[0]
    result = client.put(path + f'/images/{image["id"]}', headers=admin, json={
        'status': 'approved', 'as_cover': True, 'attribution': 'Fixture author', 'license': 'CC0',
    })
    assert result.status_code == 200 and result.json()['publication_status'] == 'draft'
    assert client.get(path.replace('/admin', '')).status_code == 404
