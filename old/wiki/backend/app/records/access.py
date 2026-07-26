from app.core.security import CurrentUser


def can_view(user: CurrentUser, status: str, access_rows: list[dict]) -> bool:
    """A draft is only visible to admins, regardless of record_access.

    A published record with no record_access rows is public. Otherwise the
    user needs to belong to at least one (org, level) pair in access_rows
    at or above the required level - rows are OR'd, not AND'd, so a record
    can be opened up to several organizations independently.
    """
    if user.is_admin:
        return True
    if status == "draft":
        return False
    if not access_rows:
        return True
    return any(user.level_in(row["org"]) >= row["level"] for row in access_rows)
