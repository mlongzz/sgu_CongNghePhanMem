from sqlalchemy.sql.elements import ColumnElement

LIKE_ESCAPE = "\\"


def escape_like(value: str) -> str:
    return (
        value.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
        .replace("%", LIKE_ESCAPE + "%")
        .replace("_", LIKE_ESCAPE + "_")
    )


def contains(column, value: str) -> ColumnElement[bool]:
    return column.ilike(f"%{escape_like(value)}%", escape=LIKE_ESCAPE)
