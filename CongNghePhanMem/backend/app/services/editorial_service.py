"""Content edits always return to review, including clients echoing old status."""


def reviewed_changes(row, changes: dict) -> dict:
    result = dict(changes)
    if 'image_url' in result and result['image_url'] != getattr(row, 'image_url', None):
        for key in ('image_thumbnail_url', 'image_source_url', 'image_attribution', 'image_license'):
            if hasattr(row, key) and key not in result:
                result[key] = None
    if getattr(row, "publication_status", None) == "published" and any(
        key != "publication_status" and hasattr(row, key) and getattr(row, key) != value
        for key, value in result.items()
    ):
        result["publication_status"] = "draft"
    return result
