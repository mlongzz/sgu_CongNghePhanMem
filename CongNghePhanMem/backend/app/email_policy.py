"""The same indexed email expression on SQLite and PostgreSQL."""
from sqlalchemy import String
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement


class canonical_email(FunctionElement):
    type = String()
    inherit_cache = True


@compiles(canonical_email)
def default_email(element, compiler, **kw):
    return 'lower(trim(' + compiler.process(list(element.clauses)[0], **kw) + '))'


@compiles(canonical_email, 'postgresql')
def postgres_email(element, compiler, **kw):
    # btrim avoids the PostgreSQL TRIM(BOTH FROM ...) rewrite during reflection.
    return 'lower(btrim(' + compiler.process(list(element.clauses)[0], **kw) + '))'
